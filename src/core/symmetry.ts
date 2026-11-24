import {
  faceCentroid,
  faceNormal,
  faceVertices,
  type DieDefinition,
  type DieFace,
} from './die-definition';
import { DiceError } from './errors';
import {
  quatConjugate,
  quatDot,
  quatFromBasis,
  quatMultiply,
  rotateVector,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecSub,
  type Quat,
  type Vec3,
} from './math';

const EPSILON = 1e-6;

/** Base ortonormal presa a uma face: eixo X rumo ao vértice `k`, eixo Z na normal. */
function faceFrame(definition: DieDefinition, face: DieFace, k: number): Quat {
  const vertices = faceVertices(definition, face);
  const anchor = vertices[k % vertices.length]!;
  const normal = faceNormal(definition, face);
  const xAxis = vecNormalize(vecSub(anchor, faceCentroid(definition, face)));
  return quatFromBasis(xAxis, vecCross(normal, xAxis), normal);
}

function mapsOntoSet(rotation: Quat, points: readonly Vec3[], tolerance: number): boolean {
  return points.every((point) => {
    const rotated = rotateVector(rotation, point);
    return points.some((candidate) => vecLength(vecSub(rotated, candidate)) < tolerance);
  });
}

const groupCache = new WeakMap<DieDefinition, readonly Quat[]>();

/**
 * Rotações que levam o dado sobre si mesmo (grupo de simetria rotacional),
 * calculadas a partir da geometria. Uma rotação é aceita se preserva o
 * conjunto de vértices e o conjunto de direções de leitura.
 *
 * Toda simetria leva a face 0 a alguma face com algum deslocamento cíclico dos
 * vértices; testar todos esses candidatos enumera o grupo inteiro.
 */
export function computeRotationGroup(definition: DieDefinition): readonly Quat[] {
  const cached = groupCache.get(definition);
  if (cached) return cached;

  const reference = definition.faces[0];
  if (!reference) {
    throw new DiceError('INVALID_ARGUMENT', `O dado "${definition.type}" não tem faces.`);
  }
  const scale = Math.max(...definition.vertices.map(vecLength));
  const tolerance = EPSILON * Math.max(scale, 1) * 100;
  const readDirections = definition.faces.map((face) => face.readDirection);
  const referenceInverse = quatConjugate(faceFrame(definition, reference, 0));
  const sides = reference.vertexIndices.length;
  const group: Quat[] = [];

  for (const face of definition.faces) {
    if (face.vertexIndices.length !== sides) continue;
    for (let k = 0; k < sides; k++) {
      const rotation = quatMultiply(faceFrame(definition, face, k), referenceInverse);
      const isSymmetry =
        mapsOntoSet(rotation, definition.vertices, tolerance) &&
        mapsOntoSet(rotation, readDirections, tolerance);
      // q e -q são a mesma rotação.
      const isNew = group.every((known) => Math.abs(quatDot(known, rotation)) < 1 - EPSILON);
      if (isSymmetry && isNew) group.push(rotation);
    }
  }

  groupCache.set(definition, group);
  return group;
}

/**
 * Rotações de simetria que colocam a face `target` onde a face `landed` está.
 *
 * Aplicada à malha como deslocamento fixo em relação ao corpo físico
 * (`malha = corpo ⊗ rotação`), faz a face `target` terminar para cima quando a
 * simulação termina com `landed` para cima, sem alterar a forma do dado em
 * nenhum instante da trajetória.
 */
export function findReorientations(
  definition: DieDefinition,
  target: DieFace,
  landed: DieFace,
): Quat[] {
  return computeRotationGroup(definition).filter(
    (rotation) =>
      vecDot(rotateVector(rotation, target.readDirection), landed.readDirection) > 1 - EPSILON,
  );
}
