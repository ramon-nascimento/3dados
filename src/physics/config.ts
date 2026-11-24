import { DiceError } from '../core/errors';

/**
 * Parâmetros da simulação. A unidade de comprimento é a aresta do d6 (1 unidade
 * = um dado); tempo em segundos.
 */
export interface PhysicsConfig {
  /** Aceleração da gravidade, em unidades/s². */
  gravity: number;
  /** Duração de um passo fixo de simulação, em segundos. */
  timestep: number;
  /** Tempo máximo simulado antes de desistir de uma tentativa, em segundos. */
  maxDuration: number;
  /** Atrito dos dados. */
  friction: number;
  /** Restituição (quique) dos dados. */
  restitution: number;
  /** Atrito da mesa e das paredes. */
  surfaceFriction: number;
  /** Restituição da mesa e das paredes. */
  surfaceRestitution: number;
  /** Velocidade típica de lançamento, em unidades/s. */
  throwSpeed: number;
  /** Velocidade angular típica de lançamento, em rad/s. */
  throwSpin: number;
  /** Amortecimento linear (resistência do ar). */
  linearDamping: number;
  /** Amortecimento angular. */
  angularDamping: number;
  /** Quantas sementes tentar antes de falhar com `SIMULATION_FAILED`. */
  maxAttempts: number;
  /**
   * Quantas das primeiras tentativas precisam terminar sem nenhuma
   * intervenção. Depois delas, dados que param inclinados ou sobre outros
   * recebem empurrões corretivos. Zero permite empurrões desde a primeira.
   */
  cleanAttempts: number;
  /** Máximo de empurrões corretivos por dado em uma tentativa. Zero desliga a recuperação. */
  maxNudges: number;
  /**
   * Orçamento de tentativas quando algum dado sem simetria precisa cair em
   * faces específicas para exibir o valor pedido.
   */
  searchAttempts: number;
}

/**
 * Valores calibrados por medição (`npm run bench`) para que uma rolagem dure
 * pouco mais de um segundo. A gravidade é menor que a real na escala de um dado
 * de 16 mm (≈613 unidades/s²): o movimento fica cerca de duas vezes mais lento,
 * o que deixa a rolagem legível na tela.
 */
export const DEFAULT_PHYSICS_CONFIG: Readonly<PhysicsConfig> = {
  gravity: 150,
  timestep: 1 / 120,
  maxDuration: 8,
  friction: 0.3,
  restitution: 0.45,
  surfaceFriction: 0.35,
  surfaceRestitution: 0.4,
  throwSpeed: 35,
  throwSpin: 25,
  linearDamping: 0.02,
  angularDamping: 0.02,
  maxAttempts: 12,
  cleanAttempts: 2,
  maxNudges: 6,
  searchAttempts: 60,
};

/** Faixa aceita de cada parâmetro. `integer` marca os que são contagens. */
export const PHYSICS_LIMITS: Readonly<
  Record<keyof PhysicsConfig, { min: number; max: number; integer?: true }>
> = {
  gravity: { min: 1, max: 2000 },
  timestep: { min: 1 / 480, max: 1 / 30 },
  maxDuration: { min: 0.05, max: 30 },
  friction: { min: 0, max: 2 },
  restitution: { min: 0, max: 0.95 },
  surfaceFriction: { min: 0, max: 2 },
  surfaceRestitution: { min: 0, max: 0.95 },
  throwSpeed: { min: 1, max: 200 },
  throwSpin: { min: 0, max: 100 },
  linearDamping: { min: 0, max: 5 },
  angularDamping: { min: 0, max: 5 },
  maxAttempts: { min: 1, max: 100, integer: true },
  cleanAttempts: { min: 0, max: 100, integer: true },
  maxNudges: { min: 0, max: 20, integer: true },
  searchAttempts: { min: 1, max: 500, integer: true },
};

/**
 * Valida ajustes parciais da física. Lança `DiceError` `INVALID_ARGUMENT` com
 * o caminho do campo (`physics.gravity`). Campos ausentes ou `undefined` ficam
 * de fora: quem chama os completa com os valores atuais.
 */
export function parsePhysicsConfig(value: unknown, path = 'physics'): Partial<PhysicsConfig> {
  const invalid = (message: string, field: string, received: unknown) =>
    new DiceError('INVALID_ARGUMENT', `${field}: ${message}`, {
      details: { path: field, received },
    });
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid('esperado um objeto.', path, value);
  }
  const parsed: Partial<PhysicsConfig> = {};
  for (const [key, received] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (!Object.hasOwn(PHYSICS_LIMITS, key)) throw invalid('campo desconhecido.', field, received);
    if (received === undefined) continue;
    const { min, max, integer } = PHYSICS_LIMITS[key as keyof PhysicsConfig];
    if (
      typeof received !== 'number' ||
      !Number.isFinite(received) ||
      received < min ||
      received > max ||
      (integer === true && !Number.isInteger(received))
    ) {
      const round = (n: number) => Number(n.toPrecision(4));
      throw invalid(
        `esperado um ${integer ? 'inteiro' : 'número'} de ${round(min)} a ${round(max)}.`,
        field,
        received,
      );
    }
    parsed[key as keyof PhysicsConfig] = received;
  }
  return parsed;
}
