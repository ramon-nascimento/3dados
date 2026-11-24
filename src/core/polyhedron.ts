import {
  LABEL_HEIGHT_RATIO,
  centroidOf,
  distanceToEdges,
  type DieDefinition,
  type DieFace,
  type FaceLabel,
} from './die-definition';
import { DiceError } from './errors';
import { vecCross, vecDot, vecLength, vecNormalize, vecScale, vecSub, type Vec3 } from './math';
import type { DieType } from './types';

/** Uma face plana do casco convexo de um conjunto de vértices. */
export interface HullFace {
  readonly index: number;
  /** Índices dos vértices, em sentido anti-horário visto de fora. */
  readonly vertexIndices: readonly number[];
  readonly normal: Vec3;
  readonly centroid: Vec3;
}

/**
 * Faces do casco convexo, por força bruta: um plano por três vértices é face
 * se todos os outros ficam de um mesmo lado. Serve para poucos vértices (os
 * dados têm até 20) e dispensa listas de índices escritas à mão.
 */
export function buildConvexFaces(vertices: readonly Vec3[]): HullFace[] {
  const scale = Math.max(...vertices.map(vecLength), 0);
  const tolerance = 1e-7 * Math.max(scale, 1);
  const faces: HullFace[] = [];

  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      for (let k = j + 1; k < vertices.length; k++) {
        const a = vertices[i]!;
        const cross = vecCross(vecSub(vertices[j]!, a), vecSub(vertices[k]!, a));
        if (vecLength(cross) < tolerance * tolerance) continue;
        let normal = vecNormalize(cross);
        const distances = vertices.map((vertex) => vecDot(normal, vecSub(vertex, a)));
        if (distances.every((d) => d >= -tolerance)) {
          normal = vecScale(normal, -1);
        } else if (!distances.every((d) => d <= tolerance)) {
          continue;
        }
        if (faces.some((face) => vecDot(face.normal, normal) > 1 - 1e-9)) continue;

        const onPlane = distances.flatMap((d, index) => (Math.abs(d) <= tolerance ? [index] : []));
        const points = onPlane.map((index) => vertices[index]!);
        const centroid = centroidOf(points);
        // Ordena em torno da normal: anti-horário visto de fora.
        const u = vecNormalize(vecSub(points[0]!, centroid));
        const w = vecCross(normal, u);
        const angle = (point: Vec3) => {
          const offset = vecSub(point, centroid);
          return Math.atan2(vecDot(offset, w), vecDot(offset, u));
        };
        const vertexIndices = onPlane
          .map((index) => ({ index, angle: angle(vertices[index]!) }))
          .sort((p, q) => p.angle - q.angle)
          .map((p) => p.index);
        faces.push({ index: faces.length, vertexIndices, normal, centroid });
      }
    }
  }

  if (faces.length < 4) {
    throw new DiceError('INVALID_DIE_DEFINITION', 'Os vértices não formam um sólido.', {
      details: { vertices: vertices.length, faces: faces.length },
    });
  }
  return faces;
}

/** Índice da face cuja normal é oposta à da face dada, ou -1 se não houver. */
export function oppositeFaceIndex(faces: readonly HullFace[], face: HullFace): number {
  return faces.findIndex((other) => vecDot(other.normal, face.normal) < -1 + 1e-9);
}

/**
 * Distribui valores de modo que faces opostas somem `total`: cada face ainda
 * sem valor recebe o próximo da sequência e a oposta recebe o complemento.
 */
export function assignOppositeValues(
  faces: readonly HullFace[],
  sequence: readonly number[],
  total: number,
): number[] {
  const values = new Array<number | undefined>(faces.length).fill(undefined);
  let next = 0;
  for (const face of faces) {
    if (values[face.index] !== undefined) continue;
    const value = sequence[next++];
    const opposite = oppositeFaceIndex(faces, face);
    if (value === undefined || opposite < 0) {
      throw new DiceError('INVALID_DIE_DEFINITION', 'Faces sem par oposto ou sequência curta.');
    }
    values[face.index] = value;
    values[opposite] = total - value;
  }
  return values as number[];
}

/** Rótulo centrado em `anchor`, com o topo voltado para `toward`. */
export function labelToward(
  vertices: readonly Vec3[],
  face: HullFace,
  text: string,
  toward: Vec3,
  options: { anchor?: Vec3; ratio?: number } = {},
): FaceLabel {
  const polygon = face.vertexIndices.map((index) => vertices[index]!);
  const anchor = options.anchor ?? face.centroid;
  const direction = vecSub(toward, anchor);
  // Remove a componente fora do plano, caso `toward` não esteja sobre a face.
  const inPlane = vecSub(direction, vecScale(face.normal, vecDot(direction, face.normal)));
  return {
    text,
    anchor,
    up: vecNormalize(inPlane),
    height: distanceToEdges(polygon, anchor) * (options.ratio ?? LABEL_HEIGHT_RATIO),
  };
}

export interface FaceSpec {
  value: number;
  /** Padrão: o índice da face. */
  id?: string;
  /** Padrão: a normal da face. */
  readDirection?: Vec3;
  /**
   * Texto desenhado no centro da face, no lugar do valor. Texto vazio deixa a
   * face em branco. Ignorado se `labels` for fornecido.
   */
  text?: string;
  /** Controle total do que é desenhado na face. */
  labels?: readonly FaceLabel[];
}

/**
 * Monta a definição de um dado a partir dos vértices: as faces são as do casco
 * convexo e `describe` informa o valor (e, se quiser, os rótulos) de cada uma.
 */
export function createDieDefinition(
  type: DieType,
  vertices: readonly Vec3[],
  describe: (face: HullFace, faces: readonly HullFace[]) => FaceSpec,
): DieDefinition {
  const hull = buildConvexFaces(vertices);
  const faces: DieFace[] = hull.map((face) => {
    const spec = describe(face, hull);
    let labels = spec.labels;
    if (labels === undefined && spec.text !== undefined) {
      const first = vertices[face.vertexIndices[0]!]!;
      const second = vertices[face.vertexIndices[1]!]!;
      const edgeMiddle = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
        z: (first.z + second.z) / 2,
      };
      labels = spec.text === '' ? [] : [labelToward(vertices, face, spec.text, edgeMiddle)];
    }
    return {
      id: spec.id ?? String(face.index),
      value: spec.value,
      vertexIndices: face.vertexIndices,
      readDirection: vecNormalize(spec.readDirection ?? face.normal),
      ...(labels === undefined ? {} : { labels }),
    };
  });
  return { type, vertices, faces };
}
