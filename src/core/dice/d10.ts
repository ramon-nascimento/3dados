import type { CompositeDie, DieDefinition } from '../die-definition';
import { vec3, type Vec3 } from '../math';
import { createDieDefinition, labelToward, oppositeFaceIndex, type HullFace } from '../polyhedron';

const RADIUS = 0.95;
const COS_36 = Math.cos(Math.PI / 5);
/**
 * Altura do zigue-zague do anel. Com este valor exato os quatro vértices de
 * cada face ficam no mesmo plano: sem isso as "pipas" seriam dobradas e o dado
 * não teria faces bem definidas.
 */
const RING_OFFSET = (RADIUS * (1 - COS_36)) / (1 + COS_36);

const TOP = 0;
const BOTTOM = 1;

// Trapezoedro pentagonal: dois ápices e um anel de dez vértices alternando acima
// e abaixo do equador.
const VERTICES: readonly Vec3[] = [
  vec3(0, RADIUS, 0),
  vec3(0, -RADIUS, 0),
  ...Array.from({ length: 10 }, (_, k) => {
    const angle = (k * Math.PI) / 5;
    return vec3(
      RADIUS * Math.cos(angle),
      k % 2 === 0 ? RING_OFFSET : -RING_OFFSET,
      RADIUS * Math.sin(angle),
    );
  }),
];

/** Dígitos ímpares em torno do ápice de cima; os de baixo são os complementos para 9. */
const TOP_DIGITS = [1, 7, 3, 9, 5];

function digitsByFace(faces: readonly HullFace[]): number[] {
  const digits = new Array<number>(faces.length).fill(-1);
  faces
    .filter((face) => face.vertexIndices.includes(TOP))
    .sort((a, b) => Math.atan2(a.centroid.z, a.centroid.x) - Math.atan2(b.centroid.z, b.centroid.x))
    .forEach((face, position) => {
      const digit = TOP_DIGITS[position]!;
      digits[face.index] = digit;
      digits[oppositeFaceIndex(faces, face)] = 9 - digit;
    });
  return digits;
}

/**
 * Dado de dez faces. `text` e `value` definem o que cada dígito mostra e vale:
 * a mesma geometria serve ao d10 e às duas partes do d100.
 */
function tenSided(
  type: string,
  text: (digit: number) => string,
  value: (digit: number) => number,
): DieDefinition {
  let digits: number[] | undefined;
  return createDieDefinition(type, VERTICES, (face, faces) => {
    digits ??= digitsByFace(faces);
    const digit = digits[face.index]!;
    const apex = VERTICES[face.vertexIndices.includes(TOP) ? TOP : BOTTOM]!;
    return {
      value: value(digit),
      id: text(digit),
      labels: [labelToward(VERTICES, face, text(digit), apex)],
    };
  });
}

/** d10: faces marcadas de 0 a 9; a face "0" vale 10. Faces opostas somam 9 nos dígitos. */
export const D10: DieDefinition = tenSided('d10', String, (digit) => (digit === 0 ? 10 : digit));

/** Dado das unidades do d100: faces de 0 a 9, e a face "0" vale 0. */
export const D100_UNITS: DieDefinition = tenSided('d100:units', String, (digit) => digit);

/** Dado das dezenas do d100: faces de "00" a "90". */
export const D100_TENS: DieDefinition = tenSided(
  'd100:tens',
  (digit) => `${digit}0`,
  (digit) => digit * 10,
);

/** d100: dezenas e unidades. "00" com "0" vale 100. */
export const D100: CompositeDie = {
  type: 'd100',
  parts: [
    { key: 'tens', definition: D100_TENS },
    { key: 'units', definition: D100_UNITS },
  ],
  combine: ([tens = 0, units = 0]) => tens + units || 100,
  split: (value) =>
    Number.isInteger(value) && value >= 1 && value <= 100
      ? [(value % 100) - (value % 10), value % 10]
      : undefined,
};
