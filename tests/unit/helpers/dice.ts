import { D10, D100_TENS, D100_UNITS } from '../../../src/core/dice/d10';
import { D6 } from '../../../src/core/dice/d6';
import { D12, D20, D4, D8 } from '../../../src/core/dice/platonic';
import type { DieDefinition } from '../../../src/core/die-definition';
import {
  quatFromBasis,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  type Quat,
  type Vec3,
} from '../../../src/core/math';

export interface DieExpectation {
  die: DieDefinition;
  vertices: number;
  faces: number;
  sidesPerFace: number;
  /** Ordem do grupo de rotações. */
  symmetries: number;
  values: number[];
}

const range = (from: number, to: number, step = 1) =>
  Array.from({ length: (to - from) / step + 1 }, (_, i) => from + i * step);

/** Todos os dados físicos, com o que a geometria de cada um deve ter. */
export const ALL_DICE: DieExpectation[] = [
  { die: D4, vertices: 4, faces: 4, sidesPerFace: 3, symmetries: 12, values: range(1, 4) },
  { die: D6, vertices: 8, faces: 6, sidesPerFace: 4, symmetries: 24, values: range(1, 6) },
  { die: D8, vertices: 6, faces: 8, sidesPerFace: 3, symmetries: 24, values: range(1, 8) },
  { die: D10, vertices: 12, faces: 10, sidesPerFace: 4, symmetries: 10, values: range(1, 10) },
  { die: D12, vertices: 20, faces: 12, sidesPerFace: 5, symmetries: 60, values: range(1, 12) },
  { die: D20, vertices: 12, faces: 20, sidesPerFace: 3, symmetries: 60, values: range(1, 20) },
  {
    die: D100_TENS,
    vertices: 12,
    faces: 10,
    sidesPerFace: 4,
    symmetries: 10,
    values: range(0, 90, 10),
  },
  {
    die: D100_UNITS,
    vertices: 12,
    faces: 10,
    sidesPerFace: 4,
    symmetries: 10,
    values: range(0, 9),
  },
];

/** Uma rotação que leva o vetor unitário `from` a `to`. */
export function rotationTo(from: Vec3, to: Vec3): Quat {
  const basisFor = (axis: Vec3) => {
    const helper = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const x = vecNormalize(vecCross(helper, axis));
    return quatFromBasis(x, vecCross(axis, x), axis);
  };
  const a = basisFor(vecNormalize(from));
  const b = basisFor(vecNormalize(to));
  // b ⊗ a⁻¹
  const inverse = { x: -a.x, y: -a.y, z: -a.z, w: a.w };
  return {
    x: b.w * inverse.x + b.x * inverse.w + b.y * inverse.z - b.z * inverse.y,
    y: b.w * inverse.y - b.x * inverse.z + b.y * inverse.w + b.z * inverse.x,
    z: b.w * inverse.z + b.x * inverse.y - b.y * inverse.x + b.z * inverse.w,
    w: b.w * inverse.w - b.x * inverse.x - b.y * inverse.y - b.z * inverse.z,
  };
}

export function isUnit(v: Vec3): boolean {
  return Math.abs(vecLength(v) - 1) < 1e-9;
}

export function parallel(a: Vec3, b: Vec3): boolean {
  return vecDot(vecNormalize(a), vecNormalize(b)) > 1 - 1e-9;
}
