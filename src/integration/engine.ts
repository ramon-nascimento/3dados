import { D6 } from '../core/dice/d6';
import { DieRegistry, type DieDefinition } from '../core/die-definition';
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
import { findReorientations } from '../core/symmetry';
import { finalRotation, sampleTrajectory, type SimulationRecording } from '../core/trajectory';
import type {
  DieId,
  DieResult,
  RollCancelReason,
  RollId,
  RollMetadata,
  RollOutcome,
  RollRequest,
} from '../core/types';
import type { PhysicsConfig } from '../physics/config';
import {
  createPhysicsSimulator,
  type SimulationRequest,
  type SimulationResult,
} from '../physics/simulator';
import { DiceRenderer } from '../renderer/dice-renderer';

export interface DiceEngineOptions {
  /** Tamanho aproximado de um dado na tela, em pixels CSS. Padrão: 72. */
  diceSizePx?: number;
  /** Teto para a densidade de pixels do canvas. Padrão: 2. */
  maxPixelRatio?: number;
  /** Ajustes da simulação física. */
  physics?: Partial<PhysicsConfig>;
  /** Fonte dos valores no modo autônomo. Padrão: `crypto.getRandomValues`. */
  rng?: RandomSource;
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
  addDie(dieId: DieId, definition: DieDefinition): void;
  removeDie(dieId: DieId): void;
  setDieTransform(dieId: DieId, position: Vec3, rotation: Quat): void;
  getDieRotation(dieId: DieId): Quat;
  startLoop(onFrame: () => void): void;
  stopLoop(): void;
  render(): void;
  dispose(): void;
}

/** O que o motor precisa da física. Implementado por `PhysicsSimulator`. */
export interface EngineSimulator {
  simulate(request: SimulationRequest): Promise<SimulationResult>;
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
  private readonly tableDice = new Set<DieId>();
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
    const renderer = new DiceRenderer(container, {
      diceSizePx: options.diceSizePx ?? 72,
      maxPixelRatio: options.maxPixelRatio ?? 2,
    });
    try {
      return new DiceEngine({
        renderer,
        simulator: await createPhysicsSimulator(options.physics),
        rng: options.rng ?? createCryptoRandomSource(),
        registry: new DieRegistry([D6]),
        now: () => performance.now(),
      });
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
      const simulation = await simulator.simulate({
        dice: plan.dice.map(({ dieId, definition }) => ({ dieId, definition })),
        area: renderer.area,
        seed: plan.seed,
      });
      if (active.finished) return;

      const offsets = this.reorient(plan, simulation);
      const { recording } = simulation;

      plan.dice.forEach((die, i) => {
        renderer.addDie(die.dieId, die.definition);
        this.tableDice.add(die.dieId);
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
        startedAt: this.deps.now(),
        collisionCursor: 0,
        settled: plan.dice.map(() => false),
      };
      this.emitter.emit('rollStarted', {
        rollId: plan.rollId,
        dice: plan.dice.map(({ dieId, type, role }) => ({
          dieId,
          type,
          ...(role === undefined ? {} : { role }),
        })),
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
    const dice: DieResult[] = plan.dice.map((die) => {
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
      return {
        dieId: die.dieId,
        type: die.type,
        value: die.targetFace.value,
        faceId: die.targetFace.id,
        source: die.source,
        recovered: false,
        ...(die.role === undefined ? {} : { role: die.role }),
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

  private removeTableDice(): void {
    for (const dieId of this.tableDice) this.deps.renderer.removeDie(dieId);
    this.tableDice.clear();
  }
}
