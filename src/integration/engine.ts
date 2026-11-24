import {
  DiceAudio,
  browserAudioEnvironment,
  isSoundProfile,
  parseAudioOptions,
  planRollSounds,
  type AudioOptions,
  type DiceAudioControls,
  type SoundProfile,
} from '../audio';
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
  MATERIAL_PRESETS,
  materialPhysics,
  parseTheme,
  resolveAppearance,
  type ResolvedAppearance,
  type ThemeConfig,
} from '../customization';
import {
  DiceEffects,
  browserEffectsEnvironment,
  parseEffectsOptions,
  planEffectTriggers,
  type EffectsHost,
  type PlannedEffect,
} from '../effects';
// Tipos das assinaturas públicas vêm de arquivos sem three nem Rapier: assim
// os `.d.ts` publicados não exigem `@types/three` nem os tipos do Rapier.
import type { DiceEffectsControls, EffectsEnvironment, EffectsOptions } from '../effects/types';
import { DEFAULT_PHYSICS_CONFIG, parsePhysicsConfig, type PhysicsConfig } from '../physics/config';
import { createPhysicsSimulator } from '../physics/simulator';
import type { SimulationRequest, SimulationResult } from '../physics/types';
import { DiceRenderer } from '../renderer/dice-renderer';
import type {
  Presentation,
  QualitySetting,
  RenderQuality,
  RenderStats,
  RendererEvent,
  SceneObject,
} from '../renderer/types';
import {
  parseMaxFps,
  parseRollOptions,
  type ParsedRollOptions,
  type RemoteOptions,
  type RollConcurrency,
  type RollQueueOptions,
} from './options';
import { RemoteChannel, type DiceRemoteControls } from './remote';
import type { EngineState, EngineStats, PendingRoll } from './state';

export interface DiceEngineOptions {
  /** Tamanho aproximado de um dado na tela, em pixels CSS. Padrão: 72. */
  diceSizePx?: number;
  /** Teto para a densidade de pixels do canvas. Padrão: 2. */
  maxPixelRatio?: number;
  /**
   * Teto de quadros por segundo, de 10 a 240. Padrão: sem teto (a taxa do
   * monitor). Reduz o uso de GPU e de bateria; a animação dura o mesmo tempo.
   */
  maxFps?: number;
  /** Ajustes da simulação física. Podem mudar depois com `setPhysics`. */
  physics?: Partial<PhysicsConfig>;
  /** Fonte dos valores no modo autônomo. Padrão: `crypto.getRandomValues`. */
  rng?: RandomSource;
  /** `overlay` (padrão): canvas transparente. `tray`: bandeja visível. */
  presentation?: Presentation;
  /**
   * Custo de GPU. `auto` (padrão) começa em `high`, ou em `low` quando o
   * WebGL é por software, e desce um nível se duas animações seguidas ficarem
   * abaixo de 25 quadros por segundo (evento `qualityChanged`). Um nível fixo nunca muda. Só `high` usa
   * transmissão em vidro e cristal.
   */
  quality?: QualitySetting;
  /** Tema padrão. É registrado e passa a valer para dados sem `theme`. */
  theme?: ThemeConfig;
  /** Sons. Ligado por padrão; nada toca antes de um gesto do usuário. */
  audio?: AudioOptions;
  /**
   * Efeitos visuais. Padrão: nível `auto` (`full`, ou `reduced` quando o
   * sistema pede menos movimento).
   */
  effects?: EffectsOptions;
  /**
   * Rolagem que chega com outra em andamento. `queue` (padrão): espera a vez.
   * `replace`: cancela a anterior.
   */
  concurrency?: RollConcurrency;
  /** Tamanho da fila e tempo mínimo dos dados na mesa. Ver `RollQueueOptions`. */
  queue?: RollQueueOptions;
  /** Mensagens de um servidor externo (`engine.remote`). */
  remote?: RemoteOptions;
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
  /** Qualidade efetiva do render. Pode descer quando a pedida é `auto`. */
  readonly quality: RenderQuality;
  readonly presentation: Presentation;
  /** Recebe os avisos de contexto perdido ou restaurado e de mudança de qualidade. */
  setListener(listener: (event: RendererEvent) => void): void;
  /** Medições do render neste instante. */
  getStats(): RenderStats;
  /** Carrega o que as aparências precisam (fontes) antes de os dados aparecerem. */
  prepare(appearances: readonly ResolvedAppearance[]): Promise<void>;
  addDie(dieId: DieId, definition: DieDefinition, appearance: ResolvedAppearance): void;
  setDieAppearance(dieId: DieId, definition: DieDefinition, appearance: ResolvedAppearance): void;
  removeDie(dieId: DieId): void;
  setDieTransform(dieId: DieId, position: Vec3, rotation: Quat): void;
  getDieRotation(dieId: DieId): Quat;
  getDiePosition(dieId: DieId): Vec3;
  /** Coloca na cena o grupo dos efeitos. */
  addObject(object: SceneObject): void;
  removeObject(object: SceneObject): void;
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
  /** Ajusta os parâmetros das próximas simulações. Ausente: o simulador não é ajustável. */
  configure?(config: Partial<PhysicsConfig>): unknown;
}

/** Fração do teto de partículas dos efeitos em cada qualidade de render. */
const PARTICLE_SCALE: Readonly<Record<RenderQuality, number>> = { high: 1, medium: 0.6, low: 0.3 };

/** Um dado na mesa, com o que é preciso para redesenhá-lo se o tema mudar. */
interface TableEntry {
  type: DieType;
  definition: DieDefinition;
  /** Tema pedido no `DieSpec`; ausente usa o padrão do motor. */
  themeId: string | undefined;
  /** Dado pedido de que este dado físico faz parte (o d100, para as suas partes). */
  resultId: DieId;
}

/** Agenda `callback` daqui a `ms`; devolve o cancelamento. */
export type SetTimer = (callback: () => void, ms: number) => () => void;

const defaultSetTimer: SetTimer = (callback, ms) => {
  const handle = setTimeout(callback, ms);
  return () => {
    clearTimeout(handle);
  };
};

/** Sem preferência de movimento: usado quando o motor não recebe um ambiente. */
const NO_MOTION_PREFERENCE: EffectsEnvironment = {
  prefersReducedMotion: () => false,
  onReducedMotionChange: () => () => undefined,
};

/** Mistura a semente da rolagem para as partículas: nunca o RNG dos valores. */
const EFFECT_SEED_SALT = 0x2c1b3c6d;

/** Raio da esfera que envolve o dado, a partir dos vértices. */
function boundingRadius(definition: DieDefinition): number {
  return Math.max(...definition.vertices.map(({ x, y, z }) => Math.hypot(x, y, z)));
}

/** Dependências do motor. Uso interno e em testes; aplicações usam `DiceEngine.create`. */
export interface EngineDependencies {
  renderer: EngineRenderer;
  simulator: EngineSimulator;
  rng: RandomSource;
  registry: DieRegistry;
  /** Relógio em milissegundos. */
  now: () => number;
  /** Áudio. Ausente: desligado. */
  audio?: DiceAudio;
  /** Opções dos efeitos. Ausente: nível `off`. */
  effects?: EffectsOptions;
  /** Parâmetros da física em vigor no simulador, já validados. Padrão: os do motor. */
  physics?: PhysicsConfig;
  /** Preferência de movimento do sistema. Ausente: nenhuma. */
  effectsEnvironment?: EffectsEnvironment;
  /** Temporizador para remover efeitos parados e para a fila. Padrão: `setTimeout`. */
  setTimer?: SetTimer;
  /** Fila e mensagens remotas, já validadas. Padrão: `parseRollOptions({})`. */
  rolls?: ParsedRollOptions;
  /** Relógio de parede, em ms desde a época, para `remote.maxAgeMs`. Padrão: `Date.now`. */
  clock?: () => number;
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
  /** Efeitos decididos antes do primeiro quadro, com a semente de cada um. */
  effects: { planned: PlannedEffect; seed: number; fired: boolean }[];
}

interface ActiveRoll {
  plan: RollPlan;
  requestedAt: number;
  resolve: (outcome: RollOutcome) => void;
  finished: boolean;
  /** `queued` até sair da fila; `simulating` até o primeiro quadro. */
  phase: 'queued' | 'simulating' | 'animating';
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
  /** Perfis sonoros pedidos por temas e desconhecidos, já avisados no console. */
  private readonly warnedProfiles = new Set<string>();
  private readonly audioPlayer: DiceAudio;
  private readonly effectsLayer: DiceEffects;
  private readonly setTimer: SetTimer;
  /** Raio de cada tipo de dado, para dimensionar os efeitos. */
  private readonly radii = new Map<string, number>();
  private active: ActiveRoll | undefined;
  /** Rolagens esperando a vez (`concurrency: 'queue'`), na ordem de chegada. */
  private readonly queue: ActiveRoll[] = [];
  private readonly rollOptions: ParsedRollOptions;
  /** Antes deste instante, a próxima da fila espera: os dados concluídos ficam à vista. */
  private holdUntil = -Infinity;
  /** Cancela o temporizador que tira a próxima rolagem da fila. */
  private cancelHold: (() => void) | undefined;
  /** Rolagem cujos dados estão na mesa. */
  private tableRollId: RollId | undefined;
  private readonly remoteChannel: RemoteChannel;
  private readonly counters = {
    requested: 0,
    completed: 0,
    cancelled: 0,
    failed: 0,
    recovered: 0,
    queuePeak: 0,
    lastSimulation: null as {
      attempts: number;
      cpuTimeMs: number;
      longestTaskMs: number;
    } | null,
    totalAttempts: 0,
    totalCpuTimeMs: 0,
    longestTaskMs: 0,
  };
  private physics: PhysicsConfig;
  /** O laço de render está ligado (rolagem animando ou efeito em movimento). */
  private looping = false;
  /** Cancela a remoção agendada do próximo efeito parado. */
  private cancelExpiry: (() => void) | undefined;
  private destroyed = false;

  /** Uso interno e em testes. Aplicações devem usar {@link DiceEngine.create}. */
  constructor(deps: EngineDependencies) {
    this.deps = deps;
    this.setTimer = deps.setTimer ?? defaultSetTimer;
    this.rollOptions = deps.rolls ?? parseRollOptions({});
    this.physics = { ...(deps.physics ?? DEFAULT_PHYSICS_CONFIG) };
    const clock = deps.clock ?? (() => Date.now());
    this.remoteChannel = new RemoteChannel(
      {
        submit: (request) => this.submit(request),
        cancelRemote: (rollId) => this.cancelById(rollId, 'remote'),
        clearRemote: () => {
          this.clear();
        },
        clock,
        destroyedError: () =>
          this.destroyed
            ? new DiceError('ENGINE_DESTROYED', 'O motor já foi destruído.')
            : undefined,
      },
      this.rollOptions.maxAgeMs,
    );
    this.audioPlayer =
      deps.audio ??
      new DiceAudio({ enabled: false }, browserAudioEnvironment(), { surface: 'wood' });
    this.effectsLayer = new DiceEffects(
      deps.effects ?? { level: 'off' },
      deps.effectsEnvironment ?? NO_MOTION_PREFERENCE,
      this.effectsHost(),
    );
    this.effectsLayer.setParticleScale(PARTICLE_SCALE[deps.renderer.quality]);
    deps.renderer.setListener((event) => {
      this.onRendererEvent(event);
    });
  }

  /** Cria um motor dentro de `container`, desenhando em um canvas transparente. */
  static async create(
    container: HTMLElement,
    options: DiceEngineOptions = {},
  ): Promise<DiceEngine> {
    // Valida o tema e o áudio antes de criar o contexto WebGL.
    const theme = options.theme === undefined ? undefined : parseTheme(options.theme);
    const audioOptions = parseAudioOptions(options.audio);
    const effectsOptions = parseEffectsOptions(options.effects);
    const rollOptions = parseRollOptions(options);
    const maxFps = parseMaxFps(options.maxFps);
    const physics = { ...DEFAULT_PHYSICS_CONFIG, ...parsePhysicsConfig(options.physics) };
    const presentation = options.presentation ?? 'overlay';
    const renderer = new DiceRenderer(container, {
      diceSizePx: options.diceSizePx ?? 72,
      maxPixelRatio: options.maxPixelRatio ?? 2,
      quality: options.quality ?? 'auto',
      presentation,
      ...(maxFps === undefined ? {} : { maxFps }),
    });
    try {
      const simulator = await createPhysicsSimulator(physics);
      await warmUp(simulator);
      const engine = new DiceEngine({
        renderer,
        simulator,
        rng: options.rng ?? createCryptoRandomSource(),
        registry: createStandardRegistry(),
        now: () => performance.now(),
        // Overlay: os dados caem sobre a mesa do VTT (madeira). Bandeja: feltro.
        audio: new DiceAudio(audioOptions, browserAudioEnvironment(), {
          surface: presentation === 'tray' ? 'felt' : 'wood',
        }),
        effects: effectsOptions,
        effectsEnvironment: browserEffectsEnvironment(),
        rolls: rollOptions,
        physics,
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
   * Pede uma rolagem. Com `concurrency: 'queue'` (padrão), ela espera a vez se
   * houver outra na mesa ou na fila; com `replace`, a anterior é cancelada
   * (`superseded`). Os valores são decididos aqui, mesmo que a rolagem espere.
   * Nunca lança: um pedido inválido resolve com `failed`.
   */
  roll(request: RollRequest): RollHandle {
    return this.submit(request).handle;
  }

  /**
   * Cancela uma rolagem. Sem `rollId`, a que está sendo simulada ou animada;
   * com `rollId`, essa, esteja na mesa ou na fila. Devolve `true` se algo foi
   * cancelado.
   */
  cancel(rollId?: RollId): boolean {
    if (rollId !== undefined) return this.cancelById(rollId, 'caller');
    if (!this.active) return false;
    this.finishCancelled(this.active, 'caller');
    return true;
  }

  /** Cancela a rolagem em andamento e as da fila e remove todos os dados da mesa. */
  clear(): void {
    if (this.destroyed) return;
    this.cancelQueue('cleared');
    if (this.active) this.finishCancelled(this.active, 'cleared');
    this.removeTableDice();
    this.audioPlayer.stopAll();
    this.effectsLayer.stopAll();
    this.holdUntil = -Infinity;
    this.cancelHold?.();
    this.cancelHold = undefined;
    this.deps.renderer.render();
  }

  /**
   * Mensagens de um servidor externo: pedidos, cancelamentos e limpezas, com
   * tratamento de repetidas, fora de ordem e cancelamentos antecipados.
   */
  get remote(): DiceRemoteControls {
    return this.remoteChannel;
  }

  /** Retrato do motor neste instante. Ver `EngineState`. */
  getState(): EngineState {
    const pending = (entry: ActiveRoll): PendingRoll => ({
      rollId: entry.plan.rollId,
      phase: entry.phase,
      ...metadataOf(entry.plan.metadata),
    });
    const audio = this.audioPlayer;
    return {
      status: this.destroyed
        ? 'destroyed'
        : this.active || this.queue.length > 0
          ? 'rolling'
          : 'idle',
      activeRoll: this.active ? pending(this.active) : null,
      queue: this.queue.map(pending),
      tableRollId: this.tableDice.size > 0 ? (this.tableRollId ?? null) : null,
      diceOnTable: this.tableDice.size,
      concurrency: this.rollOptions.concurrency,
      presentation: this.deps.renderer.presentation,
      quality: this.deps.renderer.quality,
      context: this.deps.renderer.getStats().context,
      defaultTheme: this.defaultThemeId,
      themes: [...this.themes.keys()],
      dieTypes: this.deps.registry.types(),
      audio: {
        enabled: audio.enabled,
        state: audio.state,
        volume: audio.volume,
        surface: audio.surface,
      },
      effects: { level: this.effectsLayer.level, levelSetting: this.effectsLayer.levelSetting },
    };
  }

  /** Contadores medidos desde a criação. Ver `EngineStats`. */
  getStats(): EngineStats {
    const c = this.counters;
    return {
      rolls: {
        requested: c.requested,
        completed: c.completed,
        cancelled: c.cancelled,
        failed: c.failed,
        recovered: c.recovered,
        queuePeak: c.queuePeak,
      },
      simulation: {
        last: c.lastSimulation ? { ...c.lastSimulation } : null,
        totalAttempts: c.totalAttempts,
        totalCpuTimeMs: c.totalCpuTimeMs,
        longestTaskMs: c.longestTaskMs,
      },
      render: this.deps.renderer.getStats(),
      remote: this.remoteChannel.getStats(),
      audio: this.audioPlayer.getStats(),
      effects: this.effectsLayer.getStats(),
    };
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

  /**
   * Controles do áudio: ligar e desligar, volume, superfície, desbloqueio e
   * sons especiais. O áudio nunca muda um resultado.
   */
  get audio(): DiceAudioControls {
    return this.audioPlayer;
  }

  /**
   * Controles dos efeitos visuais: nível, disparo direto, presets e
   * estatísticas. Um efeito nunca muda um resultado nem toca nos dados.
   */
  get effects(): DiceEffectsControls {
    return this.effectsLayer;
  }

  /** Qualidade efetiva do render, depois de resolver `auto`. Pode descer durante o uso. */
  get quality(): RenderQuality {
    return this.deps.renderer.quality;
  }

  /** Cópia dos parâmetros da física em vigor. */
  getPhysics(): PhysicsConfig {
    return { ...this.physics };
  }

  /**
   * Ajusta parâmetros da física; os ausentes ficam como estão. Vale para as
   * rolagens seguintes: a que estiver sendo simulada termina com os anteriores.
   * Devolve os parâmetros em vigor. Lança `DiceError` `INVALID_ARGUMENT`, com
   * o campo em `details.path`, se algum valor estiver fora da faixa
   * (`PHYSICS_LIMITS`).
   *
   * A física muda a trajetória e a duração; nunca o valor de uma rolagem.
   */
  setPhysics(config: Partial<PhysicsConfig>): PhysicsConfig {
    if (this.destroyed) throw new DiceError('ENGINE_DESTROYED', 'O motor já foi destruído.');
    const next = { ...this.physics, ...parsePhysicsConfig(config) };
    this.deps.simulator.configure?.(next);
    this.physics = next;
    return this.getPhysics();
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
    this.cancelQueue('destroyed');
    if (this.active) this.finishCancelled(this.active, 'destroyed');
    this.removeTableDice();
    this.destroyed = true;
    this.cancelHold?.();
    this.cancelHold = undefined;
    this.remoteChannel.reset();
    this.cancelExpiry?.();
    this.cancelExpiry = undefined;
    this.looping = false;
    this.audioPlayer.dispose();
    this.effectsLayer.dispose();
    this.deps.renderer.dispose();
    this.emitter.clear();
  }

  /**
   * Valida o pedido, decide os valores e inicia ou enfileira a rolagem.
   * `error` vem preenchido quando o pedido foi recusado (para `remote`).
   */
  private submit(request: RollRequest): { handle: RollHandle; error?: DiceError } {
    this.counters.requested++;
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
      // Pedido inválido não interfere na rolagem em andamento nem na fila.
      return this.rejected(rollId, toDiceError(error), rawMetadata);
    }

    // Rolar costuma ser um clique: aproveita o gesto para liberar o áudio.
    this.audioPlayer.unlockIfGesture();

    let resolve!: (outcome: RollOutcome) => void;
    const result = new Promise<RollOutcome>((r) => {
      resolve = r;
    });
    const entry: ActiveRoll = {
      plan,
      requestedAt: this.deps.now(),
      resolve,
      finished: false,
      phase: 'queued',
    };

    if (this.rollOptions.concurrency === 'replace') {
      if (this.active) this.finishCancelled(this.active, 'superseded');
      this.start(entry);
    } else {
      this.queue.push(entry);
      this.counters.queuePeak = Math.max(this.counters.queuePeak, this.queue.length);
      // Fila cheia: a mais antiga que ainda espera dá lugar à nova.
      while (this.queue.length > this.rollOptions.maxPending) {
        this.finishCancelled(this.queue[0]!, 'superseded');
      }
      this.pump();
    }

    return {
      handle: {
        id: rollId,
        result,
        cancel: () => {
          this.finishCancelled(entry, 'caller');
        },
      },
    };
  }

  private rejected(
    rollId: RollId,
    error: DiceError,
    metadata: RollMetadata | undefined,
  ): { handle: RollHandle; error: DiceError } {
    this.counters.failed++;
    const outcome = { status: 'failed', rollId, error, ...metadataOf(metadata) } as const;
    this.emitter.emit('rollFailed', outcome);
    return {
      handle: { id: rollId, result: Promise.resolve(outcome), cancel: () => undefined },
      error,
    };
  }

  /** Cancela a rolagem `rollId`, na mesa ou na fila. */
  private cancelById(rollId: RollId, reason: RollCancelReason): boolean {
    const entry =
      this.active?.plan.rollId === rollId
        ? this.active
        : this.queue.find((queued) => queued.plan.rollId === rollId);
    if (!entry) return false;
    this.finishCancelled(entry, reason);
    return true;
  }

  private cancelQueue(reason: RollCancelReason): void {
    while (this.queue.length > 0) this.finishCancelled(this.queue[0]!, reason);
  }

  /**
   * Tira da fila a próxima rolagem, se a mesa estiver livre e os dados da
   * anterior já tiverem ficado à vista o tempo mínimo.
   */
  private pump(): void {
    if (this.destroyed || this.active || this.queue.length === 0) return;
    const wait = this.holdUntil - this.deps.now();
    if (wait > 0) {
      this.cancelHold ??= this.setTimer(() => {
        this.cancelHold = undefined;
        this.pump();
      }, wait);
      return;
    }
    this.cancelHold?.();
    this.cancelHold = undefined;
    this.start(this.queue.shift()!);
  }

  /** Limpa a mesa e começa a simular `entry`. */
  private start(entry: ActiveRoll): void {
    this.removeTableDice();
    this.audioPlayer.stopAll();
    entry.phase = 'simulating';
    this.active = entry;
    void this.run(entry);
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
          // Rolagem cancelada no meio de uma simulação longa: não segue gastando CPU.
          aborted: () => active.finished,
        }),
        renderer.prepare(appearances),
      ]);
      if (active.finished) return;
      const measured = {
        attempts: simulation.attempts,
        cpuTimeMs: simulation.cpuTimeMs,
        longestTaskMs: simulation.longestTaskMs,
      };
      this.counters.lastSimulation = measured;
      this.counters.totalAttempts += simulation.attempts;
      this.counters.totalCpuTimeMs += simulation.cpuTimeMs;
      this.counters.longestTaskMs = Math.max(this.counters.longestTaskMs, simulation.longestTaskMs);

      const offsets = this.reorient(plan, simulation);
      const { recording } = simulation;
      const resultIds = plan.dice.map(() => '');
      for (const result of plan.results) {
        for (const index of result.parts) resultIds[index] = result.dieId;
      }

      this.tableRollId = plan.rollId;
      plan.dice.forEach((die, i) => {
        renderer.addDie(die.dieId, die.definition, appearances[i]!);
        this.tableDice.set(die.dieId, {
          type: die.type,
          definition: die.definition,
          themeId: themeIds[i],
          resultId: resultIds[i]!,
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
        effects: this.planEffects(plan, themes),
      };
      active.phase = 'animating';
      this.emitter.emit('rollStarted', {
        rollId: plan.rollId,
        dice: plan.results.flatMap(({ parts, role }) =>
          parts.map((index) => {
            const { dieId, type } = plan.dice[index]!;
            return { dieId, type, ...(role === undefined ? {} : { role }) };
          }),
        ),
        simulation: { ...measured },
        ...metadataOf(plan.metadata),
      });
      if (active.finished) return;
      this.scheduleSounds(plan, recording, themes);
      this.fireEffects(active.playback, (effect) => effect.on === 'start');
      this.syncLoop();
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

      // Efeitos de "parou": quando todos os dados físicos do alvo pararam.
      if (playback.effects.some(({ fired, planned }) => !fired && planned.on === 'settled')) {
        const settledIds = new Set(
          plan.dice.filter((_, i) => playback.settled[i]).map(({ dieId }) => dieId),
        );
        this.fireEffects(
          playback,
          ({ on, dieIds }) => on === 'settled' && dieIds.every((id) => settledIds.has(id)),
        );
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
    // Só depois da verificação: o efeito de "concluída" nunca aparece num valor não conferido.
    if (active.playback) this.fireEffects(active.playback, ({ on }) => on === 'completed');
    const outcome = {
      status: 'completed',
      rollId: plan.rollId,
      dice,
      total: dice.reduce((sum, die) => sum + die.value, 0),
      durationMs: this.deps.now() - active.requestedAt,
      ...metadataOf(plan.metadata),
    } as const;
    this.counters.completed++;
    if (dice.some((die) => die.recovered)) this.counters.recovered++;
    // A próxima da fila espera os dados desta ficarem à vista o tempo mínimo.
    this.holdUntil = this.deps.now() + this.rollOptions.holdMs;
    this.emitter.emit('rollCompleted', outcome);
    active.resolve(outcome);
    this.pump();
    this.syncLoop();
  }

  private finishCancelled(active: ActiveRoll, reason: RollCancelReason): void {
    if (active.finished) return;
    this.counters.cancelled++;
    const outcome = {
      status: 'cancelled',
      rollId: active.plan.rollId,
      reason,
      ...metadataOf(active.plan.metadata),
    } as const;
    if (active.phase === 'queued') {
      // Ainda na fila: nada na mesa, nada tocando.
      active.finished = true;
      this.queue.splice(this.queue.indexOf(active), 1);
      this.emitter.emit('rollCancelled', outcome);
      active.resolve(outcome);
      return;
    }
    this.settle(active);
    this.audioPlayer.stopAll();
    this.removeTableDice();
    this.deps.renderer.render();
    this.holdUntil = -Infinity;
    this.emitter.emit('rollCancelled', outcome);
    active.resolve(outcome);
    this.pump();
    this.syncLoop();
  }

  private finishFailed(active: ActiveRoll, error: DiceError): void {
    if (active.finished) return;
    this.counters.failed++;
    this.holdUntil = -Infinity;
    this.settle(active);
    this.audioPlayer.stopAll();
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
    this.pump();
    this.syncLoop();
  }

  /**
   * Marca a rolagem como encerrada. O laço de render é conferido depois
   * (`syncLoop`): ele continua se ainda houver efeito em movimento.
   */
  private settle(active: ActiveRoll): void {
    active.finished = true;
    if (this.active === active) this.active = undefined;
  }

  /**
   * Avisos do renderer. Sem contexto gráfico, a rolagem em andamento segue até
   * o fim: o valor já está decidido e é conferido na cena, não na GPU. Os dados
   * reaparecem quando o contexto volta.
   */
  private onRendererEvent(event: RendererEvent): void {
    if (this.destroyed) return;
    switch (event.type) {
      case 'contextLost':
        // Os efeitos em andamento viviam na GPU que se perdeu.
        this.effectsLayer.stopAll();
        this.emitter.emit('contextLost', { activeRollId: this.active?.plan.rollId ?? null });
        break;
      case 'contextRestored':
        this.emitter.emit('contextRestored', { lostForMs: event.lostForMs });
        break;
      case 'qualityChanged':
        this.effectsLayer.setParticleScale(PARTICLE_SCALE[event.to]);
        this.emitter.emit('qualityChanged', {
          from: event.from,
          to: event.to,
          fps: event.fps,
          frameMs: { ...event.frameMs },
        });
        break;
    }
  }

  /** Um quadro: avança a rolagem ativa, depois os efeitos. */
  private readonly frame = (): void => {
    const active = this.active;
    if (active) this.onFrame(active);
    this.effectsLayer.update();
    this.syncLoop();
  };

  /**
   * Liga o laço de render enquanto há rolagem animando ou efeito em
   * movimento, e o desliga quando não há nenhum dos dois. Efeitos parados não
   * precisam do laço: são desenhados uma vez e removidos por temporizador.
   */
  private syncLoop(): void {
    if (this.destroyed) return;
    const rolling = this.active?.playback !== undefined && !this.active.finished;
    const needed = rolling || this.effectsLayer.needsFrames;
    if (needed && !this.looping) {
      this.looping = true;
      this.deps.renderer.startLoop(this.frame);
    } else if (!needed && this.looping) {
      this.looping = false;
      this.deps.renderer.stopLoop();
    }
    this.cancelExpiry?.();
    this.cancelExpiry = undefined;
    const expiry = needed ? undefined : this.effectsLayer.nextExpiry;
    if (expiry === undefined) return;
    this.cancelExpiry = this.setTimer(
      () => {
        this.cancelExpiry = undefined;
        if (this.destroyed) return;
        this.effectsLayer.update();
        this.deps.renderer.render();
        this.syncLoop();
      },
      Math.max(expiry - this.deps.now(), 0) + 1,
    );
  }

  /** A camada de efeitos mudou fora do laço (disparo direto, nível, parada). */
  private onEffectsChanged(): void {
    if (this.destroyed) return;
    this.syncLoop();
    if (!this.looping) this.deps.renderer.render();
  }

  private effectsHost(): EffectsHost {
    return {
      attach: (object) => {
        this.deps.renderer.addObject(object);
      },
      detach: (object) => {
        this.deps.renderer.removeObject(object);
      },
      resolveDice: (ids) =>
        [...this.tableDice]
          .filter(([dieId, { resultId }]) => !ids || ids.includes(dieId) || ids.includes(resultId))
          .map(([dieId]) => dieId),
      dieInfo: (dieId) => {
        const entry = this.tableDice.get(dieId);
        if (!entry || this.destroyed) return undefined;
        return {
          position: this.deps.renderer.getDiePosition(dieId),
          radius: this.radiusOf(entry.definition),
        };
      },
      now: () => this.deps.now(),
      changed: () => {
        this.onEffectsChanged();
      },
    };
  }

  private radiusOf(definition: DieDefinition): number {
    let radius = this.radii.get(definition.type);
    if (radius === undefined) {
      radius = boundingRadius(definition);
      this.radii.set(definition.type, radius);
    }
    return radius;
  }

  /**
   * Efeitos desta rolagem: os gatilhos do pedido, comparados com os valores
   * já decididos, e os efeitos dos temas de cada dado. Os de tema acompanham o
   * movimento (`start`) ou o repouso (`settled`), conforme o efeito.
   */
  private planEffects(plan: RollPlan, themes: readonly ThemeConfig[]): Playback['effects'] {
    if (this.effectsLayer.level === 'off') return [];
    const subjects = plan.results.map((result) => ({
      dieId: result.dieId,
      type: result.type,
      value: result.value,
      parts: result.parts.map((index) => plan.dice[index]!.dieId),
      ...(result.role === undefined ? {} : { role: result.role }),
    }));
    const planned = planEffectTriggers(subjects, plan.effects);
    plan.results.forEach((result, r) => {
      const theme = themes[result.parts[0]!];
      for (const effect of theme?.effects ?? []) {
        planned.push({
          effect,
          on: this.effectsLayer.phaseOf(effect) === 'motion' ? 'start' : 'settled',
          options: {},
          dieIds: subjects[r]!.parts,
          subject: result.dieId,
        });
      }
    });
    return planned.map((effect, i) => ({
      planned: effect,
      seed: ((plan.seed ^ EFFECT_SEED_SALT) + i) >>> 0,
      fired: false,
    }));
  }

  /** Mostra os efeitos planejados que satisfazem `when`. Uma falha vira aviso. */
  private fireEffects(playback: Playback, when: (effect: PlannedEffect) => boolean): void {
    for (const entry of playback.effects) {
      if (entry.fired || !when(entry.planned)) continue;
      entry.fired = true;
      try {
        const { effect, dieIds, options } = entry.planned;
        this.effectsLayer.spawnOnDice(effect, dieIds, options, entry.seed);
      } catch (error) {
        console.warn('[3dados] Falha ao mostrar um efeito:', error);
      }
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

  /**
   * Agenda os sons da rolagem a partir da gravação. Só roda com o áudio
   * tocando, e uma falha aqui nunca derruba a rolagem: o som é acessório.
   */
  private scheduleSounds(
    plan: RollPlan,
    recording: SimulationRecording,
    themes: readonly ThemeConfig[],
  ): void {
    if (!this.audioPlayer.running) return;
    try {
      const events = planRollSounds({
        recording,
        dice: plan.dice.map((die, i) => ({
          dieId: die.dieId,
          definition: die.definition,
          profile: this.soundProfileOf(themes[i]!),
        })),
        surface: this.audioPlayer.surface,
        seed: plan.seed,
      });
      this.audioPlayer.scheduleRoll(events);
    } catch (error) {
      console.warn('[3dados] Falha ao agendar os sons da rolagem:', error);
    }
  }

  /** Perfil sonoro de um tema: o do tema, ou o do material. */
  private soundProfileOf(theme: ThemeConfig): SoundProfile {
    const fallback = MATERIAL_PRESETS[theme.material].soundProfile;
    const requested = theme.soundProfile ?? fallback;
    if (isSoundProfile(requested)) return requested;
    if (!this.warnedProfiles.has(requested)) {
      this.warnedProfiles.add(requested);
      console.warn(
        `[3dados] Perfil sonoro "${requested}" desconhecido; usando o do material ("${fallback}").`,
      );
    }
    return isSoundProfile(fallback) ? fallback : 'plastic';
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
    // Efeitos presos a estes dados saem com eles; os presos a um ponto continuam.
    this.effectsLayer.stopForDice(this.tableDice.keys());
    for (const dieId of this.tableDice.keys()) this.deps.renderer.removeDie(dieId);
    this.tableDice.clear();
  }
}
