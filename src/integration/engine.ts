import { D6 } from '../core/dice/d6';
import { D20 } from '../core/dice/platonic';
import { createStandardRegistry } from '../core/dice/standard';
import type { DieDefinition, DieRegistry } from '../core/die-definition';
import { DiceError, isDiceError } from '../core/errors';
import {
  TypedEmitter,
  type DiceEventMap,
  type DiceEventName,
  type Listener,
  type Unsubscribe,
} from '../core/events';
import { isFlat, readFace } from '../core/face-reading';
import { quatMultiply, type Quat, type Vec3 } from '../core/math';
import {
  createCryptoRandomSource,
  createSeededRandomSource,
  randomInt,
  type RandomSource,
} from '../core/random';
import { generateRollId, planRoll, type RollPlan } from '../core/roll-plan';
import { acceptableLandings, findReorientations } from '../core/symmetry';
import { finalRotation, sampleTrajectory, type SimulationRecording } from '../core/trajectory';
import { validateDieDefinition } from '../core/validate-die';
import type {
  DieId,
  DieResult,
  DieType,
  RollCancelReason,
  RollId,
  RollMetadata,
  RollOutcome,
  RollRequest,
} from '../core/types';
import {
  DEFAULT_THEME,
  materialPhysics,
  parseTheme,
  resolveAppearance,
  type ResolvedAppearance,
  type ThemeConfig,
} from '../customization';
import type { PhysicsConfig } from '../physics/config';
import {
  createPhysicsSimulator,
  type SimulationRequest,
  type SimulationResult,
} from '../physics/simulator';
import {
  DiceRenderer,
  type Presentation,
  type QualitySetting,
  type RenderQuality,
} from '../renderer/dice-renderer';

export interface DiceEngineOptions {
  /** Tamanho aproximado de um dado na tela, em pixels CSS. Padrão: 72. */
  diceSizePx?: number;
  /** Teto para a densidade de pixels do canvas. Padrão: 2. */
  maxPixelRatio?: number;
  /** Ajustes da simulação física. */
  physics?: Partial<PhysicsConfig>;
  /** Fonte dos valores no modo autônomo. Padrão: `crypto.getRandomValues`. */
  rng?: RandomSource;
  /** `overlay` (padrão): canvas transparente. `tray`: bandeja visível. */
  presentation?: Presentation;
  /**
   * Custo de GPU. `auto` (padrão) usa `high`, ou `low` quando o WebGL é por
   * software. Só `high` usa transmissão em vidro e cristal.
   */
  quality?: QualitySetting;
  /** Tema padrão. É registrado e passa a valer para dados sem `theme`. */
  theme?: ThemeConfig;
}

/** Controle de uma rolagem em andamento. */
export interface RollHandle {
  readonly id: RollId;
  /** Resolve com o desfecho. Nunca rejeita: cancelamento e falha são desfechos. */
  readonly result: Promise<RollOutcome>;
  /** Cancela a rolagem. Sem efeito se ela já terminou. */
  cancel(): void;
}

/** O que o motor precisa de um renderer. Implementado por `DiceRenderer`. */
export interface EngineRenderer {
  readonly area: { width: number; depth: number };
  /** Qualidade efetiva do render. */
  readonly quality: RenderQuality;
  /** Carrega o que as aparências precisam (fontes) antes de os dados aparecerem. */
  prepare(appearances: readonly ResolvedAppearance[]): Promise<void>;
  addDie(dieId: DieId, definition: DieDefinition, appearance: ResolvedAppearance): void;
  setDieAppearance(dieId: DieId, definition: DieDefinition, appearance: ResolvedAppearance): void;
  removeDie(dieId: DieId): void;
  setDieTransform(dieId: DieId, position: Vec3, rotation: Quat): void;
  getDieRotation(dieId: DieId): Quat;
  getDiePosition(dieId: DieId): Vec3;
  startLoop(onFrame: () => void): void;
  stopLoop(): void;
  render(): void;
  dispose(): void;
}

/** Um dado físico presente na mesa, como está desenhado neste instante. */
export interface TableDie {
  dieId: DieId;
  /** Tipo do dado físico. Em dados compostos, o da parte (ex.: `d100:tens`). */
  type: DieType;
  /** Centro do dado, em unidades (1 unidade = aresta de um d6); a mesa é o plano y = 0. */
  position: Vec3;
  /** Orientação real da malha na cena. */
  rotation: Quat;
}

/** O que o motor precisa da física. Implementado por `PhysicsSimulator`. */
export interface EngineSimulator {
  simulate(request: SimulationRequest): Promise<SimulationResult>;
}

/** Um dado na mesa, com o que é preciso para redesenhá-lo se o tema mudar. */
interface TableEntry {
  type: DieType;
  definition: DieDefinition;
  /** Tema pedido no `DieSpec`; ausente usa o padrão do motor. */
  themeId: string | undefined;
}

/** Dependências do motor. Uso interno e em testes; aplicações usam `DiceEngine.create`. */
export interface EngineDependencies {
  renderer: EngineRenderer;
  simulator: EngineSimulator;
  rng: RandomSource;
  registry: DieRegistry;
  /** Relógio em milissegundos. */
  now: () => number;
}

interface Playback {
  recording: SimulationRecording;
  /** Rotação de simetria aplicada à malha de cada dado, na ordem do plano. */
  offsets: readonly Quat[];
  /** Por dado físico, se recebeu empurrão corretivo na simulação. */
  recovered: readonly boolean[];
  startedAt: number;
  collisionCursor: number;
  settled: boolean[];
}

interface ActiveRoll {
  plan: RollPlan;
  requestedAt: number;
  resolve: (outcome: RollOutcome) => void;
  finished: boolean;
  playback?: Playback;
}

function toDiceError(error: unknown): DiceError {
  if (isDiceError(error)) return error;
  return new DiceError('INTERNAL_ERROR', 'Falha inesperada durante a rolagem.', { cause: error });
}

/**
 * Roda algumas simulações descartáveis. A primeira execução do WASM e do código
 * de simulação é muito mais lenta que as seguintes; fazer isso na criação do
 * motor evita que a primeira rolagem do usuário pague esse custo.
 */
async function warmUp(simulator: EngineSimulator): Promise<void> {
  const dice = [D6, D20, D6, D20].map((definition, i) => ({ dieId: `warm-${i}`, definition }));
  for (let seed = 1; seed <= 3; seed++) {
    try {
      await simulator.simulate({ dice, area: { width: 12, depth: 12 }, seed });
    } catch {
      // É só aquecimento: uma simulação que não converge não importa aqui.
    }
  }
}

function metadataOf(metadata: RollMetadata | undefined): { metadata?: RollMetadata } {
  return metadata === undefined ? {} : { metadata };
}

/**
 * Motor de rolagem. Decide os valores, pré-simula a física, reorienta os dados
 * para exibir os valores decididos, anima e verifica o que ficou na tela.
 */
export class DiceEngine {
  private readonly deps: EngineDependencies;
  private readonly emitter = new TypedEmitter<DiceEventMap>();
  /** Dados atualmente na cena, da rolagem ativa ou da última concluída. */
  private readonly tableDice = new Map<DieId, TableEntry>();
  private readonly themes = new Map<string, ThemeConfig>([[DEFAULT_THEME.id, DEFAULT_THEME]]);
  private defaultThemeId = DEFAULT_THEME.id;
  /** Temas pedidos e não registrados, já avisados no console. */
  private readonly warnedThemes = new Set<string>();
  private active: ActiveRoll | undefined;
  private destroyed = false;

  /** Uso interno e em testes. Aplicações devem usar {@link DiceEngine.create}. */
  constructor(deps: EngineDependencies) {
    this.deps = deps;
  }

  /** Cria um motor dentro de `container`, desenhando em um canvas transparente. */
  static async create(
    container: HTMLElement,
    options: DiceEngineOptions = {},
  ): Promise<DiceEngine> {
    // Valida o tema antes de criar o contexto WebGL.
    const theme = options.theme === undefined ? undefined : parseTheme(options.theme);
    const renderer = new DiceRenderer(container, {
      diceSizePx: options.diceSizePx ?? 72,
      maxPixelRatio: options.maxPixelRatio ?? 2,
      quality: options.quality ?? 'auto',
      presentation: options.presentation ?? 'overlay',
    });
    try {
      const simulator = await createPhysicsSimulator(options.physics);
      await warmUp(simulator);
      const engine = new DiceEngine({
        renderer,
        simulator,
        rng: options.rng ?? createCryptoRandomSource(),
        registry: createStandardRegistry(),
        now: () => performance.now(),
      });
      if (theme) {
        engine.registerTheme(theme);
        engine.setDefaultTheme(theme.id);
      }
      await renderer.prepare([resolveAppearance(engine.defaultTheme)]);
      return engine;
    } catch (error) {
      renderer.dispose();
      throw error;
    }
  }

  /**
   * Inicia uma rolagem. Uma rolagem em andamento é cancelada (`superseded`) e
   * os dados que estavam na mesa são removidos.
   */
  roll(request: RollRequest): RollHandle {
    const raw = request as { id?: unknown; metadata?: unknown } | null | undefined;
    const rollId =
      typeof raw?.id === 'string' && raw.id.length > 0 ? raw.id : generateRollId(this.deps.rng);
    const rawMetadata =
      typeof raw?.metadata === 'object' && raw.metadata !== null
        ? (raw.metadata as RollMetadata)
        : undefined;

    if (this.destroyed) {
      return this.rejected(
        rollId,
        new DiceError('ENGINE_DESTROYED', 'O motor já foi destruído.'),
        rawMetadata,
      );
    }

    let plan: RollPlan;
    try {
      plan = planRoll({ ...request, id: rollId }, this.deps.registry, this.deps.rng);
    } catch (error) {
      // Pedido inválido não interfere na rolagem em andamento.
      return this.rejected(rollId, toDiceError(error), rawMetadata);
    }

    if (this.active) this.finishCancelled(this.active, 'superseded');
    this.removeTableDice();

    let resolve!: (outcome: RollOutcome) => void;
    const result = new Promise<RollOutcome>((r) => {
      resolve = r;
    });
    const active: ActiveRoll = { plan, requestedAt: this.deps.now(), resolve, finished: false };
    this.active = active;
    void this.run(active);

    return {
      id: rollId,
      result,
      cancel: () => {
        this.finishCancelled(active, 'caller');
      },
    };
  }

  /**
   * Cancela a rolagem em andamento. Com `rollId`, só cancela se for essa.
   * Devolve `true` se algo foi cancelado.
   */
  cancel(rollId?: RollId): boolean {
    const active = this.active;
    if (!active || (rollId !== undefined && active.plan.rollId !== rollId)) return false;
    this.finishCancelled(active, 'caller');
    return true;
  }

  /** Cancela a rolagem em andamento e remove todos os dados da mesa. */
  clear(): void {
    if (this.destroyed) return;
    if (this.active) this.finishCancelled(this.active, 'cleared');
    this.removeTableDice();
    this.deps.renderer.render();
  }

  /**
   * Registra um dado personalizado, que passa a poder ser pedido pelo seu
   * `type`. Lança `DiceError` `INVALID_DIE_DEFINITION` se a geometria ou as
   * faces forem inválidas, ou se o tipo já existir.
   */
  registerDie(definition: DieDefinition): void {
    if (this.destroyed) throw new DiceError('ENGINE_DESTROYED', 'O motor já foi destruído.');
    const validated = validateDieDefinition(definition);
    if (this.deps.registry.has(validated.type)) {
      throw new DiceError(
        'INVALID_DIE_DEFINITION',
        `Já existe um dado do tipo "${validated.type}".`,
        {
          details: { type: validated.type },
        },
      );
    }
    this.deps.registry.register(validated);
  }

  /**
   * Registra um tema, que passa a poder ser pedido em `DieSpec.theme`. Um `id`
   * já registrado é substituído, e os dados na mesa que o usam são
   * redesenhados. Lança `DiceError` `INVALID_THEME` se o tema for inválido.
   *
   * O tema muda a aparência e a trajetória; nunca o valor de uma rolagem.
   */
  registerTheme(theme: ThemeConfig): void {
    if (this.destroyed) throw new DiceError('ENGINE_DESTROYED', 'O motor já foi destruído.');
    const parsed = parseTheme(theme);
    this.themes.set(parsed.id, parsed);
    this.warnedThemes.delete(parsed.id);
    this.refreshTable();
  }

  /**
   * Define o tema dos dados sem `theme` e dos que pedem um tema não
   * registrado. Lança `DiceError` `INVALID_ARGUMENT` se o tema não existir.
   */
  setDefaultTheme(id: string): void {
    if (this.destroyed) throw new DiceError('ENGINE_DESTROYED', 'O motor já foi destruído.');
    if (!this.themes.has(id)) {
      throw new DiceError('INVALID_ARGUMENT', `Tema não registrado: "${id}".`, {
        details: { id, known: [...this.themes.keys()] },
      });
    }
    this.defaultThemeId = id;
    this.refreshTable();
  }

  /** Cópia de um tema registrado, ou `undefined`. */
  getTheme(id: string): ThemeConfig | undefined {
    const theme = this.themes.get(id);
    return theme === undefined ? undefined : parseTheme(theme);
  }

  /** Qualidade efetiva do render, depois de resolver `auto`. */
  get quality(): RenderQuality {
    return this.deps.renderer.quality;
  }

  /**
   * Dados físicos presentes na mesa, com a posição e a orientação reais das
   * malhas neste instante. Serve para posicionar elementos da aplicação junto
   * aos dados e para conferir, de fora, o que está sendo exibido.
   */
  getDiceOnTable(): TableDie[] {
    if (this.destroyed) return [];
    return [...this.tableDice].map(([dieId, { type }]) => ({
      dieId,
      type,
      position: this.deps.renderer.getDiePosition(dieId),
      rotation: this.deps.renderer.getDieRotation(dieId),
    }));
  }

  on<K extends DiceEventName>(eventName: K, listener: Listener<DiceEventMap[K]>): Unsubscribe {
    return this.emitter.on(eventName, listener);
  }

  /** Cancela o que estiver em andamento e libera todos os recursos. */
  destroy(): void {
    if (this.destroyed) return;
    if (this.active) this.finishCancelled(this.active, 'destroyed');
    this.removeTableDice();
    this.destroyed = true;
    this.deps.renderer.dispose();
    this.emitter.clear();
  }

  private rejected(
    rollId: RollId,
    error: DiceError,
    metadata: RollMetadata | undefined,
  ): RollHandle {
    const outcome = { status: 'failed', rollId, error, ...metadataOf(metadata) } as const;
    this.emitter.emit('rollFailed', outcome);
    return { id: rollId, result: Promise.resolve(outcome), cancel: () => undefined };
  }

  private async run(active: ActiveRoll): Promise<void> {
    const { plan } = active;
    const { renderer, simulator } = this.deps;
    try {
      // Dados sem simetria entre todas as faces só exibem o valor pedido se o
      // corpo cair em certas faces; a simulação repete até acertar.
      const acceptableFaces = plan.dice.map((die) =>
        acceptableLandings(die.definition, die.targetFace),
      );
      // O tema entra só depois de os valores estarem decididos (em `planRoll`):
      // muda a aparência e a resposta física do material, nunca o resultado.
      const themeIds = this.themeIdsOf(plan);
      const themes = themeIds.map((id) => this.themeFor(id));
      const appearances = themes.map(resolveAppearance);
      const [simulation] = await Promise.all([
        simulator.simulate({
          dice: plan.dice.map(({ dieId, definition }, i) => ({
            dieId,
            definition,
            material: materialPhysics(themes[i]!),
          })),
          area: renderer.area,
          seed: plan.seed,
          ...(acceptableFaces.some((faces) => faces !== undefined) ? { acceptableFaces } : {}),
        }),
        renderer.prepare(appearances),
      ]);
      if (active.finished) return;

      const offsets = this.reorient(plan, simulation);
      const { recording } = simulation;

      plan.dice.forEach((die, i) => {
        renderer.addDie(die.dieId, die.definition, appearances[i]!);
        this.tableDice.set(die.dieId, {
          type: die.type,
          definition: die.definition,
          themeId: themeIds[i],
        });
        const start = sampleTrajectory(recording.dice[i]!, 0);
        renderer.setDieTransform(
          die.dieId,
          start.position,
          quatMultiply(start.rotation, offsets[i]!),
        );
      });

      active.playback = {
        recording,
        offsets,
        recovered: simulation.recovered,
        startedAt: this.deps.now(),
        collisionCursor: 0,
        settled: plan.dice.map(() => false),
      };
      this.emitter.emit('rollStarted', {
        rollId: plan.rollId,
        dice: plan.results.flatMap(({ parts, role }) =>
          parts.map((index) => {
            const { dieId, type } = plan.dice[index]!;
            return { dieId, type, ...(role === undefined ? {} : { role }) };
          }),
        ),
        simulation: { attempts: simulation.attempts, cpuTimeMs: simulation.cpuTimeMs },
        ...metadataOf(plan.metadata),
      });
      if (active.finished) return;
      renderer.startLoop(() => {
        this.onFrame(active);
      });
    } catch (error) {
      this.finishFailed(active, toDiceError(error));
    }
  }

  /**
   * Escolhe, para cada dado, a rotação de simetria que faz a face-alvo terminar
   * onde a simulação termina com uma face para cima, e confere o resultado
   * antes de qualquer quadro ser exibido.
   */
  private reorient(plan: RollPlan, simulation: SimulationResult): Quat[] {
    const pick = createSeededRandomSource(plan.seed ^ 0x5bd1e995);
    return plan.dice.map((die, i) => {
      const landed = simulation.landedFaces[i];
      const trajectory = simulation.recording.dice[i];
      if (!landed || trajectory?.dieId !== die.dieId) {
        throw new DiceError('INTERNAL_ERROR', 'A simulação não corresponde aos dados pedidos.', {
          details: { dieId: die.dieId },
        });
      }
      const options = findReorientations(die.definition, die.targetFace, landed);
      if (options.length === 0) {
        throw new DiceError(
          'SIMULATION_FAILED',
          `O dado "${die.type}" não tem simetria que leve a face "${die.targetFace.id}" à face "${landed.id}".`,
          { details: { dieId: die.dieId, target: die.targetFace.id, landed: landed.id } },
        );
      }
      const offset = options[randomInt(pick, options.length)]!;
      const predicted = readFace(die.definition, quatMultiply(finalRotation(trajectory), offset));
      if (predicted.face.id !== die.targetFace.id || !isFlat(predicted)) {
        throw new DiceError('RESULT_MISMATCH', 'A reorientação não produziu o valor oficial.', {
          details: {
            dieId: die.dieId,
            expected: die.targetFace.value,
            predicted: predicted.face.value,
          },
        });
      }
      return offset;
    });
  }

  private onFrame(active: ActiveRoll): void {
    const playback = active.playback;
    if (active.finished || !playback) return;
    const { plan } = active;
    const { recording } = playback;
    const elapsedSeconds = (this.deps.now() - playback.startedAt) / 1000;
    const step = Math.min(elapsedSeconds / recording.timestep, recording.stepCount);

    try {
      plan.dice.forEach((die, i) => {
        const sample = sampleTrajectory(recording.dice[i]!, step);
        this.deps.renderer.setDieTransform(
          die.dieId,
          sample.position,
          quatMultiply(sample.rotation, playback.offsets[i]!),
        );
      });

      // Ouvintes podem cancelar ou iniciar outra rolagem: a cada evento, confere.
      while (playback.collisionCursor < recording.collisions.length) {
        const collision = recording.collisions[playback.collisionCursor]!;
        if (collision.step > step) break;
        playback.collisionCursor++;
        this.emitter.emit('diceCollided', {
          rollId: plan.rollId,
          dieId: collision.dieId,
          other:
            collision.otherDieId === null
              ? { kind: 'surface' }
              : { kind: 'die', dieId: collision.otherDieId },
          intensity: collision.intensity,
          timeMs: collision.step * recording.timestep * 1000,
        });
        if (active.finished) return;
      }

      for (let i = 0; i < plan.dice.length; i++) {
        if (playback.settled[i] || recording.dice[i]!.settledStep > step) continue;
        const die = plan.dice[i]!;
        playback.settled[i] = true;
        this.emitter.emit('diceSettled', {
          rollId: plan.rollId,
          dieId: die.dieId,
          value: die.targetFace.value,
          faceId: die.targetFace.id,
        });
        if (active.finished) return;
      }

      if (step >= recording.stepCount) this.finishCompleted(active);
    } catch (error) {
      this.finishFailed(active, toDiceError(error));
    }
  }

  /** Só conclui depois de ler, na cena, o valor que cada malha realmente exibe. */
  private finishCompleted(active: ActiveRoll): void {
    const { plan } = active;
    for (const die of plan.dice) {
      const displayed = readFace(die.definition, this.deps.renderer.getDieRotation(die.dieId));
      if (displayed.face.id !== die.targetFace.id || !isFlat(displayed)) {
        throw new DiceError('RESULT_MISMATCH', 'O valor exibido diverge do valor oficial.', {
          details: {
            dieId: die.dieId,
            expected: die.targetFace.value,
            displayed: displayed.face.value,
            alignment: displayed.alignment,
          },
        });
      }
    }

    const recovered = active.playback?.recovered ?? [];
    const dice: DieResult[] = plan.results.map((result) => {
      const parts = result.parts.map((index) => plan.dice[index]!);
      return {
        dieId: result.dieId,
        type: result.type,
        value: result.value,
        faceId: parts.map((part) => part.targetFace.id).join('+'),
        source: result.source,
        recovered: result.parts.some((index) => recovered[index] === true),
        ...(result.role === undefined ? {} : { role: result.role }),
        // Dados compostos (d100) expõem o resultado de cada dado físico.
        ...(parts.length === 1
          ? {}
          : {
              components: parts.map((part) => ({
                dieId: part.dieId,
                type: part.type,
                value: part.targetFace.value,
                faceId: part.targetFace.id,
              })),
            }),
      };
    });

    // Os dados ficam na mesa até a próxima rolagem ou `clear()`.
    this.settle(active);
    const outcome = {
      status: 'completed',
      rollId: plan.rollId,
      dice,
      total: dice.reduce((sum, die) => sum + die.value, 0),
      durationMs: this.deps.now() - active.requestedAt,
      ...metadataOf(plan.metadata),
    } as const;
    this.emitter.emit('rollCompleted', outcome);
    active.resolve(outcome);
  }

  private finishCancelled(active: ActiveRoll, reason: RollCancelReason): void {
    if (active.finished) return;
    this.settle(active);
    this.removeTableDice();
    this.deps.renderer.render();
    const outcome = {
      status: 'cancelled',
      rollId: active.plan.rollId,
      reason,
      ...metadataOf(active.plan.metadata),
    } as const;
    this.emitter.emit('rollCancelled', outcome);
    active.resolve(outcome);
  }

  private finishFailed(active: ActiveRoll, error: DiceError): void {
    if (active.finished) return;
    this.settle(active);
    // Nunca deixa na tela um dado cujo valor não pôde ser garantido.
    this.removeTableDice();
    this.deps.renderer.render();
    const outcome = {
      status: 'failed',
      rollId: active.plan.rollId,
      error,
      ...metadataOf(active.plan.metadata),
    } as const;
    this.emitter.emit('rollFailed', outcome);
    active.resolve(outcome);
  }

  /** Marca a rolagem como encerrada e para a animação. */
  private settle(active: ActiveRoll): void {
    active.finished = true;
    if (this.active === active) {
      this.active = undefined;
      this.deps.renderer.stopLoop();
    }
  }

  private get defaultTheme(): ThemeConfig {
    return this.themes.get(this.defaultThemeId) ?? DEFAULT_THEME;
  }

  /** Tema pedido por cada dado físico, na ordem do plano. */
  private themeIdsOf(plan: RollPlan): (string | undefined)[] {
    const ids: (string | undefined)[] = plan.dice.map(() => undefined);
    for (const result of plan.results) {
      for (const index of result.parts) ids[index] = result.theme;
    }
    return ids;
  }

  /**
   * Tema de um dado. Um tema não registrado cai no padrão, com aviso: a
   * aparência nunca pode fazer uma rolagem falhar (um cliente remoto pode não
   * ter o tema que outro jogador usa).
   */
  private themeFor(id: string | undefined): ThemeConfig {
    if (id === undefined) return this.defaultTheme;
    const theme = this.themes.get(id);
    if (theme) return theme;
    if (!this.warnedThemes.has(id)) {
      this.warnedThemes.add(id);
      console.warn(
        `[3dados] Tema "${id}" não registrado; usando o tema padrão "${this.defaultThemeId}".`,
      );
    }
    return this.defaultTheme;
  }

  /** Redesenha os dados na mesa com os temas atuais. Só aparência: nada se move. */
  private refreshTable(): void {
    if (this.tableDice.size === 0) return;
    const { renderer } = this.deps;
    const pending = [...this.tableDice].map(([dieId, entry]) => ({
      dieId,
      entry,
      appearance: resolveAppearance(this.themeFor(entry.themeId)),
    }));
    void renderer.prepare(pending.map(({ appearance }) => appearance)).then(() => {
      if (this.destroyed) return;
      for (const { dieId, entry, appearance } of pending) {
        // O dado pode ter saído da mesa enquanto as fontes carregavam.
        if (this.tableDice.get(dieId) !== entry) continue;
        renderer.setDieAppearance(dieId, entry.definition, appearance);
      }
      renderer.render();
    });
  }

  private removeTableDice(): void {
    for (const dieId of this.tableDice.keys()) this.deps.renderer.removeDie(dieId);
    this.tableDice.clear();
  }
}
