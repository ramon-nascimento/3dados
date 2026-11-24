import { dieRadius, type DieDefinition, type DieFace } from '../core/die-definition';
import { DiceError } from '../core/errors';
import { isFlat, readFace } from '../core/face-reading';
import {
  WORLD_UP,
  quatFromUnitVectors,
  quatMultiply,
  rotateVector,
  vecNormalize,
  type Quat,
  type Vec3,
} from '../core/math';
import { createSeededRandomSource, randomFloat, type RandomSource } from '../core/random';
import type { CollisionRecord, DieTrajectory, SimulationRecording } from '../core/trajectory';
import { DEFAULT_PHYSICS_CONFIG, parsePhysicsConfig, type PhysicsConfig } from './config';
import { loadRapier, type RapierModule } from './rapier';
import type { RejectionReason, SimulationRequest, SimulationResult } from './types';

export type {
  DieMaterialResponse,
  RejectionReason,
  SimulationArea,
  SimulationDie,
  SimulationRequest,
  SimulationResult,
} from './types';

type Attempt =
  | { ok: true; recording: SimulationRecording; landedFaces: DieFace[]; recovered: boolean[] }
  | { ok: false; reason: RejectionReason };

/** Quantas tentativas de busca usam lançamentos comuns antes dos dirigidos. */
const NATURAL_SEARCH_ATTEMPTS = 6;
/** Fração do giro e da velocidade de um lançamento comum usada no lançamento dirigido. */
const DIRECTED_SPIN_SCALE = 0.12;
const DIRECTED_SPEED_SCALE = 0.45;
/** Dados a até esta distância influenciam a direção do empurrão corretivo. */
const NUDGE_NEIGHBOR_RANGE = 2.6;

const WALL_HALF_THICKNESS = 2;
const WALL_HALF_HEIGHT = 30;
/** Velocidades abaixo das quais um dado é considerado parado. */
const REST_LINEAR_SPEED = 0.05;
const REST_ANGULAR_SPEED = 0.15;
/** Tempo que o dado precisa ficar parado para ser considerado estabilizado. */
const REST_SECONDS = 0.25;
/** Distância máxima entre o ponto mais baixo do dado e a mesa para considerar que ele a toca. */
const SURFACE_TOLERANCE = 0.03;
/** Variação aleatória da posição inicial de cada dado. */
const SPAWN_JITTER = 0.07;
/**
 * Folga somada ao diâmetro do maior dado para obter o espaçamento inicial. Já
 * descontada a variação aleatória, as esferas que contêm dois dados vizinhos
 * não se tocam: os dados nunca começam sobrepostos, em nenhuma orientação.
 */
const SPAWN_CLEARANCE = 0.22;
/** Folga entre a esfera de um dado e a parede no início. */
const SPAWN_WALL_CLEARANCE = 0.034 + SPAWN_JITTER;
/** Até este número, os dados saem em uma única fileira. */
const SPAWN_MIN_COLUMNS = 4;
const SPAWN_HEIGHT = 2;
/** Distância do centro à parede a partir da qual o lançamento usa a velocidade cheia. */
const REFERENCE_REACH = 13;
const MIN_REPORTED_INTENSITY = 0.01;
/** Teto da restituição de um dado: acima de 1 ele ganharia energia a cada quique. */
const MAX_RESTITUTION = 0.95;

/**
 * Tempo máximo de trabalho seguido, em milissegundos, antes de devolver o
 * controle ao hospedeiro. Meio quadro a 60 Hz: a aplicação continua
 * respondendo e desenhando enquanto uma pré-simulação longa roda.
 */
export const SLICE_BUDGET_MS = 8;

type Yield = () => Promise<void>;

/**
 * Devolve o controle ao hospedeiro e retoma logo em seguida, sem o atraso
 * mínimo do `setTimeout` (4 ms depois de alguns encadeamentos).
 */
function createYield(): Yield {
  const host = globalThis as {
    setImmediate?: (callback: () => void) => unknown;
    scheduler?: { yield?: () => Promise<void> };
    MessageChannel?: new () => {
      port1: { onmessage: (() => void) | null };
      port2: { postMessage(message: unknown): void };
    };
  };
  // Node (testes e medições).
  if (typeof host.setImmediate === 'function') {
    const { setImmediate } = host;
    return () => new Promise<void>((resolve) => void setImmediate(resolve));
  }
  const { scheduler } = host;
  if (typeof scheduler?.yield === 'function') return () => scheduler.yield!();
  if (typeof host.MessageChannel === 'function') {
    const { port1, port2 } = new host.MessageChannel();
    const waiting: (() => void)[] = [];
    port1.onmessage = () => waiting.shift()?.();
    return () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
        port2.postMessage(null);
      });
  }
  return () => new Promise<void>((resolve) => void setTimeout(resolve, 0));
}

let sharedYield: Yield | undefined;

/**
 * Fatia uma simulação em trechos de até `SLICE_BUDGET_MS`. Mede só o tempo
 * trabalhado: as pausas não contam como CPU.
 */
class Slicer {
  /** Soma dos trechos já encerrados, em milissegundos. */
  private worked = 0;
  private longest = 0;
  private sliceStart = performance.now();
  private readonly budgetMs: number;
  private readonly aborted: (() => boolean) | undefined;

  constructor(budgetMs: number, aborted: (() => boolean) | undefined) {
    this.budgetMs = budgetMs;
    this.aborted = aborted;
  }

  /** O trecho atual já passou do orçamento. */
  due(): boolean {
    return performance.now() - this.sliceStart >= this.budgetMs;
  }

  /** Devolve o controle ao hospedeiro e abre outro trecho. Lança se a simulação foi abandonada. */
  async pause(): Promise<void> {
    this.closeSlice();
    sharedYield ??= createYield();
    await sharedYield();
    this.sliceStart = performance.now();
    if (this.aborted?.()) {
      throw new DiceError('SIMULATION_FAILED', 'A simulação foi abandonada.', {
        details: { aborted: true },
      });
    }
  }

  /** Encerra a medição: tempo trabalhado e o maior trecho sem pausa. */
  finish(): { cpuTimeMs: number; longestTaskMs: number } {
    this.closeSlice();
    this.sliceStart = performance.now();
    return { cpuTimeMs: this.worked, longestTaskMs: this.longest };
  }

  private closeSlice(): void {
    const length = performance.now() - this.sliceStart;
    this.worked += length;
    this.longest = Math.max(this.longest, length);
  }
}

function randomUnitQuat(rng: RandomSource): Quat {
  const u1 = randomFloat(rng);
  const a = 2 * Math.PI * randomFloat(rng);
  const b = 2 * Math.PI * randomFloat(rng);
  const r1 = Math.sqrt(1 - u1);
  const r2 = Math.sqrt(u1);
  return { x: r1 * Math.sin(a), y: r1 * Math.cos(a), z: r2 * Math.sin(b), w: r2 * Math.cos(b) };
}

function randomUnitVector(rng: RandomSource): Vec3 {
  const y = 2 * randomFloat(rng) - 1;
  const angle = 2 * Math.PI * randomFloat(rng);
  const r = Math.sqrt(1 - y * y);
  return { x: r * Math.cos(angle), y, z: r * Math.sin(angle) };
}

/** Limita `value` a ±limit. Se não há espaço (limite negativo), centraliza. */
function clampSymmetric(value: number, limit: number): number {
  return limit <= 0 ? 0 : Math.min(Math.max(value, -limit), limit);
}

export interface PhysicsSimulatorOptions {
  /**
   * Tempo de trabalho seguido, em milissegundos, antes de devolver o controle
   * ao hospedeiro. Padrão: `SLICE_BUDGET_MS`. `Infinity` nunca pausa.
   */
  sliceBudgetMs?: number;
}

/**
 * Pré-simulação: roda a física inteira fora da tela e devolve a trajetória
 * gravada.
 *
 * Uma tentativa só é aceita se todos os dados terminam assentados, sobre a
 * mesa e dentro da área. As primeiras tentativas (`cleanAttempts`) são
 * descartadas ao menor problema, para que a rolagem saia sem nenhuma
 * intervenção. A partir daí, um dado que para inclinado ou sobre outro recebe
 * um empurrão corretivo dentro da própria simulação: é um movimento físico,
 * gravado como o resto, e o dado fica marcado como recuperado.
 *
 * Dados sem simetria entre todas as faces podem precisar terminar em faces
 * específicas (`acceptableFaces`). As primeiras tentativas usam lançamentos
 * comuns; se a face é rara demais para sair por acaso, as seguintes usam um
 * lançamento dirigido, com o dado já voltado para ela e pouco giro.
 *
 * A simulação roda na thread principal, fatiada: a cada `SLICE_BUDGET_MS` de
 * trabalho ela devolve o controle ao navegador e retoma em seguida. Rolagens
 * comuns terminam antes da primeira pausa.
 */
export class PhysicsSimulator {
  private readonly rapier: RapierModule;
  /** Substituído inteiro a cada ajuste: uma simulação em curso segue com o que começou. */
  private config: Readonly<PhysicsConfig>;
  private readonly hullPoints = new WeakMap<DieDefinition, Float32Array>();
  private readonly sliceBudgetMs: number;

  /**
   * Orçamento de tempo de quem não informa o seu. Os testes de integração o
   * trocam por `Infinity`: eles avançam o motor quadro a quadro e precisam que
   * a simulação não dependa da velocidade da máquina.
   */
  static defaultSliceBudgetMs = SLICE_BUDGET_MS;

  constructor(
    rapier: RapierModule,
    config: Partial<PhysicsConfig> = {},
    options: PhysicsSimulatorOptions = {},
  ) {
    this.rapier = rapier;
    this.sliceBudgetMs = options.sliceBudgetMs ?? PhysicsSimulator.defaultSliceBudgetMs;
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...parsePhysicsConfig(config) };
  }

  /** Cópia dos parâmetros em vigor. */
  getConfig(): PhysicsConfig {
    return { ...this.config };
  }

  /**
   * Ajusta parâmetros; os ausentes ficam como estão. Vale para as simulações
   * seguintes. Lança `INVALID_ARGUMENT` se algum valor estiver fora da faixa.
   */
  configure(config: Partial<PhysicsConfig>): PhysicsConfig {
    this.config = { ...this.config, ...parsePhysicsConfig(config) };
    return this.getConfig();
  }

  /**
   * Assíncrono: devolve o controle ao hospedeiro entre trechos de trabalho, e
   * pode passar a rodar em um Web Worker sem alterar quem a chama.
   */
  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    const config = this.config;
    const slicer = new Slicer(this.sliceBudgetMs, request.aborted);
    const rejections: RejectionReason[] = [];
    // Acertar uma face específica de um dado sem simetria é questão de sorte:
    // o orçamento de tentativas é maior quando há essa restrição.
    const searching = request.acceptableFaces?.some((faces) => faces !== undefined) ?? false;
    const budget = searching
      ? Math.max(config.maxAttempts, config.searchAttempts)
      : config.maxAttempts;

    for (let attempt = 0; attempt < budget; attempt++) {
      const seed = (request.seed + Math.imul(attempt, 0x9e3779b9)) >>> 0;
      const nudgesPerDie = attempt < config.cleanAttempts ? 0 : config.maxNudges;
      const directed = searching && attempt >= NATURAL_SEARCH_ATTEMPTS;
      if (attempt > 0 && slicer.due()) await slicer.pause();
      const outcome = await this.runAttempt(request, config, seed, nudgesPerDie, directed, slicer);
      if (outcome.ok) {
        return {
          recording: outcome.recording,
          landedFaces: outcome.landedFaces,
          recovered: outcome.recovered,
          attempts: attempt + 1,
          rejections,
          ...slicer.finish(),
        };
      }
      rejections.push(outcome.reason);
    }

    throw new DiceError('SIMULATION_FAILED', `A simulação não convergiu em ${budget} tentativas.`, {
      details: { rejections, dice: request.dice.length, area: { ...request.area } },
    });
  }

  private pointsOf(definition: DieDefinition): Float32Array {
    let points = this.hullPoints.get(definition);
    if (!points) {
      points = new Float32Array(definition.vertices.flatMap((v) => [v.x, v.y, v.z]));
      this.hullPoints.set(definition, points);
    }
    return points;
  }

  private async runAttempt(
    request: SimulationRequest,
    config: Readonly<PhysicsConfig>,
    seed: number,
    nudgesPerDie: number,
    directed: boolean,
    slicer: Slicer,
  ): Promise<Attempt> {
    const R = this.rapier;
    const rng = createSeededRandomSource(seed);
    const halfWidth = request.area.width / 2;
    const halfDepth = request.area.depth / 2;
    const dieCount = request.dice.length;
    const maxSteps = Math.ceil(config.maxDuration / config.timestep);
    const restSteps = Math.ceil(REST_SECONDS / config.timestep);

    const largestRadius = Math.max(...request.dice.map(({ definition }) => dieRadius(definition)));
    const spawnSpacing = 2 * largestRadius + SPAWN_CLEARANCE;
    const wallMargin = largestRadius + SPAWN_WALL_CLEARANCE;

    const world = new R.World({ x: 0, y: -config.gravity, z: 0 });
    const events = new R.EventQueue(true);
    try {
      world.timestep = config.timestep;

      // Mesa (superfície em y = 0) e quatro paredes invisíveis nas bordas da área.
      const surface = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
        world.createCollider(
          R.ColliderDesc.cuboid(hx, hy, hz)
            .setTranslation(x, y, z)
            .setFriction(config.surfaceFriction)
            .setRestitution(config.surfaceRestitution),
        );
      const t = WALL_HALF_THICKNESS;
      const wallY = WALL_HALF_HEIGHT - t;
      surface(halfWidth + 2 * t, t, halfDepth + 2 * t, 0, -t, 0);
      surface(t, WALL_HALF_HEIGHT, halfDepth + 2 * t, halfWidth + t, wallY, 0);
      surface(t, WALL_HALF_HEIGHT, halfDepth + 2 * t, -halfWidth - t, wallY, 0);
      surface(halfWidth + 2 * t, WALL_HALF_HEIGHT, t, 0, wallY, halfDepth + t);
      surface(halfWidth + 2 * t, WALL_HALF_HEIGHT, t, 0, wallY, -halfDepth - t);

      // Lançamento: os dados partem juntos de perto de uma borda, rumo ao centro.
      const heading = 2 * Math.PI * randomFloat(rng);
      const dirX = Math.cos(heading);
      const dirZ = Math.sin(heading);
      const reach = Math.min(
        Math.abs(dirX) > 1e-9 ? halfWidth / Math.abs(dirX) : Infinity,
        Math.abs(dirZ) > 1e-9 ? halfDepth / Math.abs(dirZ) : Infinity,
      );
      const startDistance = Math.max(reach - 2, 0);
      // Em áreas pequenas o lançamento é mais lento: na velocidade cheia os dados
      // cruzam a mesa várias vezes e se amontoam nos cantos.
      const areaSpeed = config.throwSpeed * Math.min(Math.max(reach / REFERENCE_REACH, 0.4), 1);
      // Quantos dados cabem lado a lado, perpendicularmente ao lançamento. Com
      // muitos dados a fileira se alarga em vez de empilhar: dados que caem uns
      // sobre os outros tendem a parar inclinados e a invalidar a tentativa.
      const rowReach = Math.min(
        Math.abs(dirZ) > 1e-9 ? (halfWidth - wallMargin) / Math.abs(dirZ) : Infinity,
        Math.abs(dirX) > 1e-9 ? (halfDepth - wallMargin) / Math.abs(dirX) : Infinity,
      );
      const fitting = Math.floor((2 * Math.max(rowReach, 0)) / spawnSpacing) + 1;
      const columns = Math.min(dieCount, Math.max(fitting, SPAWN_MIN_COLUMNS));
      // A fileira de dados é perpendicular ao lançamento. O centro dela é
      // recuado o bastante para a fileira inteira caber dentro das paredes.
      const halfRow = ((columns - 1) / 2) * spawnSpacing;
      const centerX = clampSymmetric(
        -dirX * startDistance,
        halfWidth - wallMargin - Math.abs(dirZ) * halfRow,
      );
      const centerZ = clampSymmetric(
        -dirZ * startDistance,
        halfDepth - wallMargin - Math.abs(dirX) * halfRow,
      );

      const bodies = request.dice.map(({ definition, material }, index) => {
        const hull = R.ColliderDesc.convexHull(this.pointsOf(definition));
        if (!hull) {
          throw new DiceError(
            'INVALID_ARGUMENT',
            `Não foi possível criar o casco convexo do dado "${definition.type}".`,
            { details: { type: definition.type } },
          );
        }
        const column = index % columns;
        const layer = Math.floor(index / columns);
        const lateral = (column - (columns - 1) / 2) * spawnSpacing;
        const jitter = () => (randomFloat(rng) - 0.5) * 2 * SPAWN_JITTER;
        const x = centerX - dirZ * lateral + jitter();
        const z = centerZ + dirX * lateral + jitter();
        let speed = areaSpeed * (0.55 + 0.7 * randomFloat(rng));
        const angle = heading + (randomFloat(rng) - 0.5) * 0.5;
        let spinAxis = randomUnitVector(rng);
        let spin = config.throwSpin * (0.6 + 0.8 * randomFloat(rng));
        let rotation = randomUnitQuat(rng);
        let lift = (randomFloat(rng) - 0.3) * 6;

        // Lançamento dirigido: o dado sai já voltado para uma das faces em que
        // precisa terminar, mais devagar e girando quase só em torno do eixo
        // vertical, o que o mantém nessa face. Só é usado quando lançamentos
        // comuns não acertaram uma face rara de um dado sem simetria.
        const wanted = directed ? request.acceptableFaces?.[index] : undefined;
        const aimIds = wanted ? [...wanted] : [];
        const aim = definition.faces.find(
          (face) => face.id === aimIds[Math.floor(randomFloat(rng) * aimIds.length)],
        );
        if (aim) {
          const yaw = 2 * Math.PI * randomFloat(rng);
          rotation = quatMultiply(
            { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
            quatFromUnitVectors(aim.readDirection, WORLD_UP),
          );
          spinAxis = vecNormalize({ x: 0.1 * spinAxis.x, y: 1, z: 0.1 * spinAxis.z });
          spin *= DIRECTED_SPIN_SCALE;
          speed *= DIRECTED_SPEED_SCALE;
          lift = 0;
        }

        const body = world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(x, SPAWN_HEIGHT + layer * spawnSpacing + jitter(), z)
            .setRotation(rotation)
            .setLinvel(Math.cos(angle) * speed, lift, Math.sin(angle) * speed)
            .setAngvel({ x: spinAxis.x * spin, y: spinAxis.y * spin, z: spinAxis.z * spin })
            .setLinearDamping(config.linearDamping)
            .setAngularDamping(config.angularDamping)
            .setCcdEnabled(true),
        );
        const collider = world.createCollider(
          hull
            .setFriction(config.friction * (material?.frictionScale ?? 1))
            .setRestitution(
              Math.min(config.restitution * (material?.restitutionScale ?? 1), MAX_RESTITUTION),
            )
            .setDensity(material?.density ?? 1)
            .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
          body,
        );
        return { body, colliderHandle: collider.handle };
      });
      const dieByCollider = new Map(
        bodies.map(({ colliderHandle }, index) => [colliderHandle, index]),
      );

      const positions = bodies.map(() => new Float32Array((maxSteps + 1) * 3));
      const rotations = bodies.map(() => new Float32Array((maxSteps + 1) * 4));
      const restCount = new Array<number>(dieCount).fill(0);
      const previousVelocity = new Float32Array(dieCount * 3);
      const collisions: CollisionRecord[] = [];

      const record = (frame: number): boolean => {
        let inBounds = true;
        bodies.forEach(({ body }, i) => {
          const p = body.translation();
          const r = body.rotation();
          positions[i]!.set([p.x, p.y, p.z], frame * 3);
          rotations[i]!.set([r.x, r.y, r.z, r.w], frame * 4);
          if (
            Math.abs(p.x) > halfWidth + 0.5 ||
            Math.abs(p.z) > halfDepth + 0.5 ||
            p.y < -0.5 ||
            p.y > 2 * WALL_HALF_HEIGHT
          ) {
            inBounds = false;
          }
        });
        return inBounds;
      };

      const velocityChange = (i: number): number => {
        const v = bodies[i]!.body.linvel();
        return Math.hypot(
          v.x - previousVelocity[i * 3]!,
          v.y - previousVelocity[i * 3 + 1]!,
          v.z - previousVelocity[i * 3 + 2]!,
        );
      };

      /** Por que um dado parado não serve como resultado, ou `undefined` se serve. */
      const problemOf = (i: number): RejectionReason | undefined => {
        const { definition } = request.dice[i]!;
        const { body } = bodies[i]!;
        const rotation = body.rotation();
        if (!isFlat(readFace(definition, rotation))) return 'tilted';
        const centerY = body.translation().y;
        const lowest = Math.min(
          ...definition.vertices.map((v) => centerY + rotateVector(rotation, v).y),
        );
        return Math.abs(lowest) > SURFACE_TOLERANCE ? 'not-on-surface' : undefined;
      };

      /**
       * Empurrão corretivo: um pequeno salto com giro, para longe dos dados
       * vizinhos, que tira o dado de cima de outro ou do apoio em que encostou.
       */
      const nudge = (i: number): void => {
        const { body } = bodies[i]!;
        const p = body.translation();
        let awayX = 0;
        let awayZ = 0;
        bodies.forEach(({ body: other }, j) => {
          if (j === i) return;
          const q = other.translation();
          const dx = p.x - q.x;
          const dz = p.z - q.z;
          const distance = Math.hypot(dx, dz);
          if (distance > 1e-6 && distance < NUDGE_NEIGHBOR_RANGE) {
            awayX += dx / (distance * distance);
            awayZ += dz / (distance * distance);
          }
        });
        // Leve tendência para o centro, para não empurrar o dado contra a parede.
        const fromCenter = Math.hypot(p.x, p.z);
        if (fromCenter > 1) {
          awayX -= (0.25 * p.x) / fromCenter;
          awayZ -= (0.25 * p.z) / fromCenter;
        }
        let length = Math.hypot(awayX, awayZ);
        if (length < 1e-3) {
          const angle = 2 * Math.PI * randomFloat(rng);
          awayX = Math.cos(angle);
          awayZ = Math.sin(angle);
          length = 1;
        }
        const sideways = 3 + 3 * randomFloat(rng);
        const hop = Math.sqrt(2 * config.gravity * (0.45 + 0.35 * randomFloat(rng)));
        const axis = randomUnitVector(rng);
        const spin = 6 + 6 * randomFloat(rng);
        body.setLinvel(
          { x: (awayX / length) * sideways, y: hop, z: (awayZ / length) * sideways },
          true,
        );
        body.setAngvel({ x: axis.x * spin, y: axis.y * spin, z: axis.z * spin }, true);
      };

      const nudges = new Array<number>(dieCount).fill(0);
      record(0);
      // Montar o mundo e os cascos de todos os dados já é um trecho de trabalho.
      if (slicer.due()) await slicer.pause();
      let stepCount = 0;
      let allAtRest = false;

      for (let step = 1; step <= maxSteps && !allAtRest; step++) {
        bodies.forEach(({ body }, i) => {
          const v = body.linvel();
          previousVelocity.set([v.x, v.y, v.z], i * 3);
        });

        world.step(events);
        stepCount = step;
        if (!record(step)) return { ok: false, reason: 'out-of-bounds' };

        events.drainCollisionEvents((handle1, handle2, started) => {
          if (!started) return;
          const a = dieByCollider.get(handle1);
          const b = dieByCollider.get(handle2);
          const first = a ?? b;
          if (first === undefined) return;
          const second = a !== undefined && b !== undefined ? b : undefined;
          // Intensidade: variação de velocidade causada pelo impacto, relativa ao lançamento.
          const change = Math.max(
            velocityChange(first),
            second === undefined ? 0 : velocityChange(second),
          );
          const intensity = Math.min(change / config.throwSpeed, 1);
          if (intensity < MIN_REPORTED_INTENSITY) return;
          collisions.push({
            step,
            dieId: request.dice[first]!.dieId,
            otherDieId: second === undefined ? null : request.dice[second]!.dieId,
            intensity,
          });
        });

        allAtRest = true;
        bodies.forEach(({ body }, i) => {
          const v = body.linvel();
          const w = body.angvel();
          const resting =
            Math.hypot(v.x, v.y, v.z) < REST_LINEAR_SPEED &&
            Math.hypot(w.x, w.y, w.z) < REST_ANGULAR_SPEED;
          restCount[i] = resting ? restCount[i]! + 1 : 0;
          if (restCount[i] < restSteps) {
            allAtRest = false;
            return;
          }
          // Acabou de parar. Se parou mal e ainda pode ser empurrado, continua rolando.
          if (restCount[i] === restSteps && nudges[i]! < nudgesPerDie && problemOf(i)) {
            nudge(i);
            nudges[i]!++;
            restCount[i] = 0;
            allAtRest = false;
          }
        });

        // O relógio é consultado a cada passo: com a mesa cheia, um passo custa
        // décimos de milissegundo, e uma CPU lenta multiplica isso. O mundo é
        // local a esta tentativa: pausar aqui não muda a física.
        if (slicer.due()) await slicer.pause();
      }

      if (!allAtRest) return { ok: false, reason: 'timeout' };

      const landedFaces: DieFace[] = [];
      const trajectories: DieTrajectory[] = [];
      for (let i = 0; i < dieCount; i++) {
        const { dieId, definition } = request.dice[i]!;
        const problem = problemOf(i);
        if (problem) return { ok: false, reason: problem };

        const reading = readFace(definition, bodies[i]!.body.rotation());
        const acceptable = request.acceptableFaces?.[i];
        if (acceptable && !acceptable.has(reading.face.id)) {
          return { ok: false, reason: 'wrong-face' };
        }

        landedFaces.push(reading.face);
        trajectories.push({
          dieId,
          positions: positions[i]!.slice(0, (stepCount + 1) * 3),
          rotations: rotations[i]!.slice(0, (stepCount + 1) * 4),
          settledStep: stepCount - restCount[i]! + 1,
        });
      }

      return {
        ok: true,
        landedFaces,
        recovered: nudges.map((count) => count > 0),
        recording: { timestep: config.timestep, stepCount, dice: trajectories, collisions },
      };
    } finally {
      events.free();
      world.free();
    }
  }
}

/** Cria um simulador, carregando o Rapier se necessário. */
export async function createPhysicsSimulator(
  config: Partial<PhysicsConfig> = {},
  options: PhysicsSimulatorOptions = {},
): Promise<PhysicsSimulator> {
  return new PhysicsSimulator(await loadRapier(), config, options);
}
