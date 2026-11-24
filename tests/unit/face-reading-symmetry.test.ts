import { describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { FLAT_ALIGNMENT_MIN, isFlat, readFace } from '../../src/core/face-reading';
import {
  QUAT_IDENTITY,
  quatMultiply,
  quatNormalize,
  rotateVector,
  vecLength,
  vecSub,
  type Quat,
  type Vec3,
} from '../../src/core/math';
import { createSeededRandomSource, randomFloat } from '../../src/core/random';
import { computeRotationGroup, findReorientations } from '../../src/core/symmetry';

function axisAngle(axis: Vec3, degrees: number): Quat {
  const half = (degrees * Math.PI) / 360;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

function randomRotation(seed: number): Quat {
  const source = createSeededRandomSource(seed);
  const n = () => randomFloat(source) * 2 - 1;
  return quatNormalize({ x: n(), y: n(), z: n(), w: n() });
}

const group = computeRotationGroup(D6);

describe('readFace', () => {
  it('na orientação de referência lê a face 1, perfeitamente plana', () => {
    const reading = readFace(D6, QUAT_IDENTITY);

    expect(reading.face.value).toBe(1);
    expect(reading.alignment).toBeCloseTo(1, 12);
    expect(reading.margin).toBeCloseTo(1, 12);
    expect(isFlat(reading)).toBe(true);
  });

  it('lê cada uma das 6 faces nas 24 orientações assentadas do cubo', () => {
    const counts = new Map<number, number>();
    for (const rotation of group) {
      const reading = readFace(D6, rotation);
      expect(isFlat(reading)).toBe(true);
      counts.set(reading.face.value, (counts.get(reading.face.value) ?? 0) + 1);
    }

    expect([...counts.entries()].sort()).toEqual([1, 2, 3, 4, 5, 6].map((value) => [value, 4]));
  });

  it('a face lida é a que tem os vértices mais altos', () => {
    for (const rotation of group) {
      const { face } = readFace(D6, rotation);
      const heights = D6.vertices.map((vertex) => rotateVector(rotation, vertex).y);
      const top = Math.max(...heights);

      for (const index of face.vertexIndices) expect(heights[index]).toBeCloseTo(top, 9);
    }
  });

  it('um dado inclinado 10° ainda é lido, mas não é considerado assentado', () => {
    const reading = readFace(D6, axisAngle({ x: 1, y: 0, z: 0 }, 10));

    expect(reading.face.value).toBe(1);
    expect(reading.alignment).toBeLessThan(FLAT_ALIGNMENT_MIN);
    expect(isFlat(reading)).toBe(false);
  });

  it('um dado equilibrado na aresta é ambíguo: margem zero', () => {
    const reading = readFace(D6, axisAngle({ x: 1, y: 0, z: 0 }, 45));

    expect(reading.margin).toBeCloseTo(0, 9);
    expect(isFlat(reading)).toBe(false);
  });

  it('girar em torno do eixo vertical não muda a leitura', () => {
    for (let degrees = 0; degrees < 360; degrees += 17) {
      expect(readFace(D6, axisAngle({ x: 0, y: 1, z: 0 }, degrees)).face.value).toBe(1);
    }
  });
});

describe('computeRotationGroup (d6)', () => {
  it('tem 24 rotações distintas, incluindo a identidade', () => {
    expect(group).toHaveLength(24);
    expect(group.some((rotation) => Math.abs(rotation.w) > 1 - 1e-9)).toBe(true);
  });

  it('toda rotação leva o conjunto de vértices sobre si mesmo', () => {
    for (const rotation of group) {
      for (const vertex of D6.vertices) {
        const rotated = rotateVector(rotation, vertex);
        const matches = D6.vertices.filter((other) => vecLength(vecSub(rotated, other)) < 1e-9);
        expect(matches).toHaveLength(1);
      }
    }
  });

  it('é fechado sob composição', () => {
    const isMember = (candidate: Quat) =>
      group.some(
        (known) =>
          Math.abs(
            known.x * candidate.x +
              known.y * candidate.y +
              known.z * candidate.z +
              known.w * candidate.w,
          ) >
          1 - 1e-9,
      );

    for (const a of group) for (const b of group) expect(isMember(quatMultiply(a, b))).toBe(true);
  });
});

describe('findReorientations (d6)', () => {
  const pairs = D6.faces.flatMap((target) => D6.faces.map((landed) => ({ target, landed })));

  it.each(pairs)(
    'alvo $target.value, caiu $landed.value: toda reorientação exibe o alvo',
    ({ target, landed }) => {
      const options = findReorientations(D6, target, landed);
      expect(options).toHaveLength(4);

      // Qualquer orientação final em que a face `landed` está para cima...
      for (let seed = 0; seed < 5; seed++) {
        const spin = axisAngle({ x: 0, y: 1, z: 0 }, seed * 61);
        const landedUp = group.find((rotation) => readFace(D6, rotation).face.id === landed.id)!;
        const body = quatMultiply(spin, landedUp);
        expect(readFace(D6, body).face.id).toBe(landed.id);

        // ...passa a exibir `target`, perfeitamente plana, com a malha reorientada.
        for (const offset of options) {
          const reading = readFace(D6, quatMultiply(body, offset));
          expect(reading.face.id).toBe(target.id);
          expect(reading.alignment).toBeCloseTo(1, 9);
        }
      }
    },
  );

  it('a malha reorientada ocupa o mesmo volume do corpo em qualquer orientação', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const body = randomRotation(seed);
      const bodyVertices = D6.vertices.map((vertex) => rotateVector(body, vertex));

      for (const offset of group) {
        const mesh = quatMultiply(body, offset);
        for (const vertex of D6.vertices) {
          const meshVertex = rotateVector(mesh, vertex);
          const coincides = bodyVertices.some(
            (other) => vecLength(vecSub(meshVertex, other)) < 1e-9,
          );
          expect(coincides).toBe(true);
        }
      }
    }
  });
});
