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
