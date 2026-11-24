import { DiceError } from './errors';
import {
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub,
  type Vec3,
} from './math';
import type { DieType } from './types';

/** Um texto desenhado sobre uma face. */
export interface FaceLabel {
  readonly text: string;
  /** Centro do texto: um ponto sobre a face, no referencial do dado. */
  readonly anchor: Vec3;
  /** Direção unitária, no plano da face, para onde aponta o topo do texto. */
  readonly up: Vec3;
  /** Altura da fonte, em unidades (1 unidade = aresta de um d6). */
  readonly height: number;
}

/** Uma face de um dado, descrita como dado puro. */
export interface DieFace {
  /** Identificador único dentro do dado. */
  readonly id: string;
  /** Valor registrado quando esta face é o resultado. */
  readonly value: number;
  /** Índices dos vértices da face, em sentido anti-horário visto de fora. */
  readonly vertexIndices: readonly number[];
  /**
   * Direção unitária, no referencial do dado, que aponta para cima quando esta
   * face é o resultado. Na maioria dos dados é a normal da face; no d4 é a
   * direção do vértice superior.
   */
  readonly readDirection: Vec3;
  /**
   * O que é desenhado nesta face. Quando omitido, o valor é desenhado no
   * centro. É apenas aparência: o resultado vem de `value`.
   */
  readonly labels?: readonly FaceLabel[];
}

/**
 * Geometria e numeração de um dado. É a única fonte usada pela física (casco
 * convexo), pelo render (malha) e pela leitura do resultado. O dado é convexo
 * e centrado na origem.
 */
export interface DieDefinition {
  readonly type: DieType;
  readonly vertices: readonly Vec3[];
  readonly faces: readonly DieFace[];
}

/**
 * Um dado lógico formado por mais de um dado físico, como o d100 (dezenas e
 * unidades). Cada parte é sorteada e animada como um dado comum.
 */
export interface CompositeDie {
  readonly type: DieType;
  readonly parts: readonly { readonly key: string; readonly definition: DieDefinition }[];
  /** Valor do dado lógico a partir dos valores das partes, na ordem de `parts`. */
  combine(values: readonly number[]): number;
  /** Valores das partes que produzem `value`, ou `undefined` se o valor não existe. */
  split(value: number): readonly number[] | undefined;
}

export type RegisteredDie =
  | { readonly kind: 'single'; readonly definition: DieDefinition }
  | { readonly kind: 'composite'; readonly composite: CompositeDie };

export function faceVertices(definition: DieDefinition, face: DieFace): Vec3[] {
  return face.vertexIndices.map((index) => {
    const vertex = definition.vertices[index];
    if (!vertex) {
      throw new DiceError('INVALID_ARGUMENT', `Face "${face.id}" usa um vértice inexistente.`, {
        details: { type: definition.type, faceId: face.id, index },
      });
    }
    return vertex;
  });
}

export function centroidOf(points: readonly Vec3[]): Vec3 {
  return vecScale(points.reduce(vecAdd, { x: 0, y: 0, z: 0 }), 1 / points.length);
}

export function faceCentroid(definition: DieDefinition, face: DieFace): Vec3 {
  return centroidOf(faceVertices(definition, face));
}

/** Normal unitária apontando para fora, calculada a partir dos vértices. */
export function faceNormal(definition: DieDefinition, face: DieFace): Vec3 {
  const [a, b, c] = faceVertices(definition, face);
  if (!a || !b || !c) {
    throw new DiceError('INVALID_ARGUMENT', `Face "${face.id}" tem menos de três vértices.`, {
      details: { type: definition.type, faceId: face.id },
    });
  }
  return vecNormalize(vecCross(vecSub(b, a), vecSub(c, b)));
}

/** Menor distância de `point` às retas das arestas do polígono. */
export function distanceToEdges(polygon: readonly Vec3[], point: Vec3): number {
  let smallest = Infinity;
  polygon.forEach((start, i) => {
    const end = polygon[(i + 1) % polygon.length]!;
    const edge = vecNormalize(vecSub(end, start));
    const offset = vecSub(point, start);
    const along = vecDot(offset, edge);
    smallest = Math.min(smallest, vecLength(vecSub(offset, vecScale(edge, along))));
  });
  return smallest;
}

/** Proporção entre a altura da fonte e o espaço livre em torno do texto. */
export const LABEL_HEIGHT_RATIO = 1.24;

/** Rótulo padrão: o valor, no centro da face, com o topo voltado para a primeira aresta. */
export function defaultFaceLabel(definition: DieDefinition, face: DieFace): FaceLabel {
  const vertices = faceVertices(definition, face);
  const anchor = centroidOf(vertices);
  const edgeMiddle = vecScale(vecAdd(vertices[0]!, vertices[1]!), 0.5);
  return {
    text: String(face.value),
    anchor,
    up: vecNormalize(vecSub(edgeMiddle, anchor)),
    height: distanceToEdges(vertices, anchor) * LABEL_HEIGHT_RATIO,
  };
}

export function faceLabels(definition: DieDefinition, face: DieFace): readonly FaceLabel[] {
  return face.labels ?? [defaultFaceLabel(definition, face)];
}

/** Raio da menor esfera centrada na origem que contém o dado. */
export function dieRadius(definition: DieDefinition): number {
  return Math.max(...definition.vertices.map(vecLength));
}

/** Registro dos dados conhecidos pelo motor. */
export class DieRegistry {
  private readonly entries = new Map<string, RegisteredDie>();

  constructor(
    definitions: readonly DieDefinition[] = [],
    composites: readonly CompositeDie[] = [],
  ) {
    for (const definition of definitions) this.register(definition);
    for (const composite of composites) this.registerComposite(composite);
  }

  register(definition: DieDefinition): void {
    this.entries.set(definition.type, { kind: 'single', definition });
  }

  registerComposite(composite: CompositeDie): void {
    this.entries.set(composite.type, { kind: 'composite', composite });
  }

  resolve(type: string): RegisteredDie | undefined {
    return this.entries.get(type);
  }

  has(type: string): boolean {
    return this.entries.has(type);
  }

  types(): string[] {
    return [...this.entries.keys()];
  }
}
