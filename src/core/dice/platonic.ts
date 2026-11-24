import type { DieDefinition } from '../die-definition';
import { vec3, vecNormalize, vecScale, type Vec3 } from '../math';
import {
  assignOppositeValues,
  createDieDefinition,
  labelToward,
  type HullFace,
} from '../polyhedron';

const PHI = (1 + Math.sqrt(5)) / 2;

/** Escala os vértices para que o mais distante fique a `radius` da origem. */
function scaleTo(radius: number, vertices: readonly Vec3[]): Vec3[] {
  return vertices.map((vertex) => vecScale(vecNormalize(vertex), radius));
}

function signs(values: readonly number[]): number[][] {
  return values.reduce<number[][]>(
    (combinations, value) =>
      value === 0
        ? combinations.map((c) => [...c, 0])
        : combinations.flatMap((c) => [
            [...c, value],
            [...c, -value],
          ]),
    [[]],
  );
}

/** Todas as combinações de sinais de (a, b, c) e de suas permutações cíclicas. */
function cyclicSigns(a: number, b: number, c: number): Vec3[] {
  return [
    [a, b, c],
    [c, a, b],
    [b, c, a],
  ].flatMap((triple) => signs(triple).map(([x, y, z]) => vec3(x!, y!, z!)));
}

/**
 * Dado cujo valor é lido na face de cima, com um número por face e faces
 * opostas somando `total`. A disposição em torno do dado é própria: alterna
 * valores altos e baixos, sem reproduzir a de nenhum fabricante.
 */
function faceUpDie(
  type: string,
  vertices: readonly Vec3[],
  sequence: readonly number[],
  total: number,
): DieDefinition {
  let values: number[] | undefined;
  return createDieDefinition(type, vertices, (face: HullFace, faces) => {
    values ??= assignOppositeValues(faces, sequence, total);
    const value = values[face.index]!;
    const firstVertex = vertices[face.vertexIndices[0]!]!;
    return {
      value,
      id: String(value),
      labels: [labelToward(vertices, face, String(value), firstVertex)],
    };
  });
}

const D4_VERTICES = scaleTo(1, [vec3(1, 1, 1), vec3(1, -1, -1), vec3(-1, 1, -1), vec3(-1, -1, 1)]);

/**
 * d4 lido pelo vértice de cima. Cada vértice tem um valor, escrito junto a ele
 * nas três faces que o tocam. A "face" de resultado é a que fica para baixo:
 * sua direção de leitura aponta para o vértice oposto.
 */
export const D4: DieDefinition = createDieDefinition('d4', D4_VERTICES, (face) => {
  const apex = [0, 1, 2, 3].find((index) => !face.vertexIndices.includes(index))!;
  return {
    value: apex + 1,
    id: String(apex + 1),
    readDirection: D4_VERTICES[apex]!,
    labels: face.vertexIndices.map((index) => {
      const corner = D4_VERTICES[index]!;
      const anchor = {
        x: face.centroid.x + (corner.x - face.centroid.x) * 0.5,
        y: face.centroid.y + (corner.y - face.centroid.y) * 0.5,
        z: face.centroid.z + (corner.z - face.centroid.z) * 0.5,
      };
      return labelToward(D4_VERTICES, face, String(index + 1), corner, { anchor, ratio: 1.55 });
    }),
  };
});

/** d8: octaedro, faces opostas somam 9. */
export const D8: DieDefinition = faceUpDie('d8', scaleTo(1, cyclicSigns(1, 0, 0)), [1, 7, 3, 5], 9);

/** d12: dodecaedro, faces opostas somam 13. */
export const D12: DieDefinition = faceUpDie(
  'd12',
  scaleTo(0.95, [
    ...signs([1, 1, 1]).map(([x, y, z]) => vec3(x!, y!, z!)),
    ...cyclicSigns(0, 1 / PHI, PHI),
  ]),
  [1, 11, 3, 9, 5, 7],
  13,
);

/** d20: icosaedro, faces opostas somam 21. */
export const D20: DieDefinition = faceUpDie(
  'd20',
  scaleTo(1, cyclicSigns(0, 1, PHI)),
  [1, 19, 3, 17, 5, 15, 7, 13, 9, 11],
  21,
);
