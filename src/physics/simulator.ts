import { dieRadius, type DieDefinition, type DieFace } from '../core/die-definition';
import { DiceError } from '../core/errors';
import { isFlat, readFace } from '../core/face-reading';
import { rotateVector, type Quat, type Vec3 } from '../core/math';
import { createSeededRandomSource, randomFloat, type RandomSource } from '../core/random';
import type { CollisionRecord, DieTrajectory, SimulationRecording } from '../core/trajectory';
import type { DieId } from '../core/types';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './config';
import { loadRapier, type RapierModule } from './rapier';

/** Área da mesa, centrada na origem, em unidades (1 unidade = um dado). */
export interface SimulationArea {
  width: number;
  depth: number;
}

export interface SimulationDie {
  dieId: DieId;
  definition: DieDefinition;
}

export interface SimulationRequest {
  dice: readonly SimulationDie[];
  area: SimulationArea;
  /** Semente das condições iniciais. Cada tentativa deriva a sua. */
  seed: number;
}

/** Por que uma tentativa de simulação foi descartada. */
export type RejectionReason =
  /** Algum dado não parou dentro do tempo máximo. */
  | 'timeout'
  /** Algum dado saiu da área. */
  | 'out-of-bounds'
  /** Algum dado parou inclinado, sem uma face claramente para cima. */
  | 'tilted'
  /** Algum dado parou sem tocar a mesa (por exemplo, sobre outro dado). */
  | 'not-on-surface';

export interface SimulationResult {
  recording: SimulationRecording;
  /** Face física que terminou para cima, por dado, na ordem do pedido. */
  landedFaces: readonly DieFace[];
  /** Tentativas feitas, incluindo a aceita. */
  attempts: number;
  /** Motivo de descarte de cada tentativa anterior à aceita. */
  rejections: readonly RejectionReason[];
  /** Tempo de CPU gasto em todas as tentativas, em milissegundos. */
  cpuTimeMs: number;
}

type Attempt =
  | { ok: true; recording: SimulationRecording; landedFaces: DieFace[] }
  | { ok: false; reason: RejectionReason };

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

/**
 * Pré-simulação: roda a física inteira fora da tela e devolve a trajetória
 * gravada. Tentativas com dado que não estabiliza, sai da área, para inclinado
 * ou fora da mesa são descartadas e repetidas com outra semente.
 */
export class PhysicsSimulator {
  private readonly rapier: RapierModule;
  private readonly config: PhysicsConfig;
  private readonly hullPoints = new WeakMap<DieDefinition, Float32Array>();

  constructor(rapier: RapierModule, config: Partial<PhysicsConfig> = {}) {
    this.rapier = rapier;
    this.config = { ...DEFAULT_PHYSICS_CONFIG, ...config };
  }

  /**
   * Assíncrono por contrato: a simulação pode passar a rodar em um Web Worker
   * sem alterar quem a chama.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async simulate(request: SimulationRequest): Promise<SimulationResult> {
    const startedAt = performance.now();
    const rejections: RejectionReason[] = [];

    for (let attempt = 0; attempt < this.config.maxAttempts; attempt++) {
      const seed = (request.seed + Math.imul(attempt, 0x9e3779b9)) >>> 0;
      const outcome = this.runAttempt(request, seed);
      if (outcome.ok) {
        return {
          recording: outcome.recording,
          landedFaces: outcome.landedFaces,
          attempts: attempt + 1,
          rejections,
          cpuTimeMs: performance.now() - startedAt,
        };
      }
      rejections.push(outcome.reason);
    }

    throw new DiceError(
      'SIMULATION_FAILED',
      `A simulação não convergiu em ${this.config.maxAttempts} tentativas.`,
      { details: { rejections, dice: request.dice.length, area: { ...request.area } } },
    );
  }

  private pointsOf(definition: DieDefinition): Float32Array {
    let points = this.hullPoints.get(definition);
    if (!points) {
      points = new Float32Array(definition.vertices.flatMap((v) => [v.x, v.y, v.z]));
      this.hullPoints.set(definition, points);
    }
    return points;
  }

  private runAttempt(request: SimulationRequest, seed: number): Attempt {
    const R = this.rapier;
    const config = this.config;
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

      const bodies = request.dice.map(({ definition }, index) => {
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
        const speed = areaSpeed * (0.55 + 0.7 * randomFloat(rng));
        const angle = heading + (randomFloat(rng) - 0.5) * 0.5;
        const spinAxis = randomUnitVector(rng);
        const spin = config.throwSpin * (0.6 + 0.8 * randomFloat(rng));

        const body = world.createRigidBody(
          R.RigidBodyDesc.dynamic()
            .setTranslation(x, SPAWN_HEIGHT + layer * spawnSpacing + jitter(), z)
            .setRotation(randomUnitQuat(rng))
            .setLinvel(
              Math.cos(angle) * speed,
              (randomFloat(rng) - 0.3) * 6,
              Math.sin(angle) * speed,
            )
            .setAngvel({ x: spinAxis.x * spin, y: spinAxis.y * spin, z: spinAxis.z * spin })
            .setLinearDamping(config.linearDamping)
            .setAngularDamping(config.angularDamping)
            .setCcdEnabled(true),
        );
        const collider = world.createCollider(
          hull
            .setFriction(config.friction)
            .setRestitution(config.restitution)
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

      record(0);
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
          if (restCount[i] < restSteps) allAtRest = false;
        });
      }

      if (!allAtRest) return { ok: false, reason: 'timeout' };

      const landedFaces: DieFace[] = [];
      const trajectories: DieTrajectory[] = [];
      for (let i = 0; i < dieCount; i++) {
        const { dieId, definition } = request.dice[i]!;
        const { body } = bodies[i]!;
        const rotation = body.rotation();
        const reading = readFace(definition, rotation);
        if (!isFlat(reading)) return { ok: false, reason: 'tilted' };

        const centerY = body.translation().y;
        const lowest = Math.min(
          ...definition.vertices.map((v) => centerY + rotateVector(rotation, v).y),
        );
        if (Math.abs(lowest) > SURFACE_TOLERANCE) return { ok: false, reason: 'not-on-surface' };

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
): Promise<PhysicsSimulator> {
  return new PhysicsSimulator(await loadRapier(), config);
}
