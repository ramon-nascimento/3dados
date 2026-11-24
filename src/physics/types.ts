import type { DieDefinition, DieFace } from '../core/die-definition';
import type { SimulationRecording } from '../core/trajectory';
import type { DieId } from '../core/types';

// Contratos da simulação, sem dependência do Rapier: as declarações publicadas
// (`.d.ts`) do motor os referenciam, e não podem exigir os tipos do Rapier.

/** Área da mesa, centrada na origem, em unidades (1 unidade = um dado). */
export interface SimulationArea {
  width: number;
  depth: number;
}

/**
 * Como o material de um dado responde na simulação. A física não conhece
 * temas: quem monta o pedido traduz o material nestes números.
 */
export interface DieMaterialResponse {
  /** Multiplica `PhysicsConfig.friction`. */
  frictionScale: number;
  /** Multiplica `PhysicsConfig.restitution`; o resultado fica abaixo de 1. */
  restitutionScale: number;
  /** Densidade relativa (1 = plástico). Só pesa nas colisões entre dados. */
  density: number;
}

export interface SimulationDie {
  dieId: DieId;
  definition: DieDefinition;
  /** Ausente: plástico, com os valores de `PhysicsConfig`. */
  material?: DieMaterialResponse;
}

export interface SimulationRequest {
  dice: readonly SimulationDie[];
  area: SimulationArea;
  /** Semente das condições iniciais. Cada tentativa deriva a sua. */
  seed: number;
  /**
   * Por dado, os identificadores das faces em que ele pode terminar. Usado para
   * dados sem simetria entre todas as faces, que só conseguem exibir o valor
   * pedido se caírem em certas faces. Ausente ou `undefined`: qualquer face.
   */
  acceptableFaces?: readonly (ReadonlySet<string> | undefined)[];
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
  | 'not-on-surface'
  /** Algum dado terminou em uma face fora de `acceptableFaces`. */
  | 'wrong-face';

export interface SimulationResult {
  recording: SimulationRecording;
  /** Face física que terminou para cima, por dado, na ordem do pedido. */
  landedFaces: readonly DieFace[];
  /**
   * Por dado, se ele parou inclinado ou sobre outro dado e recebeu ao menos um
   * empurrão corretivo para terminar assentado.
   */
  recovered: readonly boolean[];
  /** Tentativas feitas, incluindo a aceita. */
  attempts: number;
  /** Motivo de descarte de cada tentativa anterior à aceita. */
  rejections: readonly RejectionReason[];
  /** Tempo de CPU gasto em todas as tentativas, em milissegundos. */
  cpuTimeMs: number;
}
