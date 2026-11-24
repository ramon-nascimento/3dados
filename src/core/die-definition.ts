import { DiceError } from './errors';
import { vecAdd, vecCross, vecNormalize, vecScale, vecSub, type Vec3 } from './math';
import type { DieType } from './types';

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
}

/**
 * Geometria e numeração de um dado. É a única fonte usada pela física (casco
 * convexo), pelo render (malha) e pela leitura do resultado. O dado é centrado
 * na origem.
 */
export interface DieDefinition {
  readonly type: DieType;
  readonly vertices: readonly Vec3[];
  readonly faces: readonly DieFace[];
}

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

export function faceCentroid(definition: DieDefinition, face: DieFace): Vec3 {
  const vertices = faceVertices(definition, face);
  const sum = vertices.reduce(vecAdd, { x: 0, y: 0, z: 0 });
  return vecScale(sum, 1 / vertices.length);
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

/** Registro dos dados conhecidos pelo motor. */
export class DieRegistry {
  private readonly definitions = new Map<string, DieDefinition>();

  constructor(definitions: readonly DieDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: DieDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  get(type: string): DieDefinition | undefined {
    return this.definitions.get(type);
  }

  types(): string[] {
    return [...this.definitions.keys()];
  }
}
