import { describe, expect, it } from 'vitest';
import {
  QUAT_IDENTITY,
  quatConjugate,
  quatFromBasis,
  quatMultiply,
  quatSlerp,
  rotateVector,
  vec3,
  vecCross,
  vecNormalize,
  type Quat,
  type Vec3,
} from '../../src/core/math';
import { finalRotation, sampleTrajectory, type DieTrajectory } from '../../src/core/trajectory';

function expectVec(actual: Vec3, expected: Vec3, digits = 9): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

const quarterTurnY: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

describe('quatérnios', () => {
  it('rotateVector gira 90° em torno de Y: X vai para -Z', () => {
    expectVec(rotateVector(quarterTurnY, vec3(1, 0, 0)), vec3(0, 0, -1));
  });

  it('quatMultiply(a, b) aplica b primeiro e depois a', () => {
    const quarterTurnX: Quat = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
    const v = vec3(0, 0, 1);

    expectVec(
      rotateVector(quatMultiply(quarterTurnY, quarterTurnX), v),
      rotateVector(quarterTurnY, rotateVector(quarterTurnX, v)),
    );
  });

  it('o conjugado desfaz a rotação', () => {
    const v = vec3(0.3, -1.2, 2);

    expectVec(rotateVector(quatConjugate(quarterTurnY), rotateVector(quarterTurnY, v)), v);
  });

  it('quatFromBasis leva os eixos canônicos à base dada', () => {
    const x = vecNormalize(vec3(1, 2, 3));
    const y = vecNormalize(vecCross(vec3(0, 0, 1), x));
    const z = vecCross(x, y);
    const rotation = quatFromBasis(x, y, z);

    expectVec(rotateVector(rotation, vec3(1, 0, 0)), x);
    expectVec(rotateVector(rotation, vec3(0, 1, 0)), y);
    expectVec(rotateVector(rotation, vec3(0, 0, 1)), z);
  });

  it('quatSlerp na metade de 90° equivale a 45°', () => {
    const half = quatSlerp(QUAT_IDENTITY, quarterTurnY, 0.5);

    expectVec(rotateVector(half, vec3(1, 0, 0)), vec3(Math.SQRT1_2, 0, -Math.SQRT1_2));
  });

  it('quatSlerp segue o caminho curto quando os sinais são opostos', () => {
    const negated: Quat = { x: -0, y: -Math.SQRT1_2, z: -0, w: -Math.SQRT1_2 };
    const half = quatSlerp(QUAT_IDENTITY, negated, 0.5);

    expectVec(rotateVector(half, vec3(1, 0, 0)), vec3(Math.SQRT1_2, 0, -Math.SQRT1_2));
  });
});

describe('sampleTrajectory', () => {
  const trajectory: DieTrajectory = {
    dieId: 'a',
    positions: new Float32Array([0, 0, 0, 2, 4, 6, 4, 8, 12]),
    rotations: new Float32Array([0, 0, 0, 1, 0, Math.SQRT1_2, 0, Math.SQRT1_2, 0, 1, 0, 0]),
    settledStep: 2,
  };

  it('devolve o quadro exato em passos inteiros', () => {
    expectVec(sampleTrajectory(trajectory, 1).position, vec3(2, 4, 6));
  });

  it('interpola entre quadros', () => {
    expectVec(sampleTrajectory(trajectory, 0.5).position, vec3(1, 2, 3));
    // A gravação usa Float32: a precisão é de ~7 dígitos.
    expectVec(
      rotateVector(sampleTrajectory(trajectory, 0.5).rotation, vec3(1, 0, 0)),
      vec3(Math.SQRT1_2, 0, -Math.SQRT1_2),
      6,
    );
  });

  it('fora da faixa usa o primeiro ou o último quadro', () => {
    expectVec(sampleTrajectory(trajectory, -3).position, vec3(0, 0, 0));
    expectVec(sampleTrajectory(trajectory, 99).position, vec3(4, 8, 12));
    expect(sampleTrajectory(trajectory, 2).rotation.y).toBeCloseTo(1, 6);
  });

  it('finalRotation devolve a rotação do último quadro', () => {
    expect(finalRotation(trajectory)).toEqual({ x: 0, y: 1, z: 0, w: 0 });
  });
});
