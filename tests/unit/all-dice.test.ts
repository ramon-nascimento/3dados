import { describe, expect, it } from 'vitest';
import { D10, D100_TENS, D100_UNITS } from '../../src/core/dice/d10';
import { D6 } from '../../src/core/dice/d6';
import { D12, D20, D4, D8 } from '../../src/core/dice/platonic';
import {
  faceCentroid,
  faceLabels,
  faceNormal,
  faceVertices,
  type DieDefinition,
} from '../../src/core/die-definition';
import { isFlat, readFace } from '../../src/core/face-reading';
import {
  WORLD_UP,
  quatMultiply,
  rotateVector,
  vecAdd,
  vecDot,
  vecLength,
  vecScale,
  vecSub,
} from '../../src/core/math';
import { computeRotationGroup, findReorientations } from '../../src/core/symmetry';
import { validateDieDefinition } from '../../src/core/validate-die';
import { ALL_DICE, isUnit, parallel, rotationTo } from './helpers/dice';

const DOWN = { x: 0, y: -1, z: 0 };

describe.each(ALL_DICE)(
  '$die.type',
  ({ die, vertices, faces, sidesPerFace, symmetries, values }) => {
    it('tem o número esperado de vértices, faces e lados por face', () => {
      expect(die.vertices).toHaveLength(vertices);
      expect(die.faces).toHaveLength(faces);
      expect(die.faces.every((face) => face.vertexIndices.length === sidesPerFace)).toBe(true);
    });

    it('tem exatamente os valores esperados, com identificadores únicos', () => {
      expect(die.faces.map((face) => face.value).sort((a, b) => a - b)).toEqual(values);
      expect(new Set(die.faces.map((face) => face.id)).size).toBe(faces);
    });

    it('é centrado na origem', () => {
      const sum = die.vertices.reduce(vecAdd, { x: 0, y: 0, z: 0 });

      expect(vecLength(sum)).toBeLessThan(1e-9);
    });

    it('toda face é plana e aponta para fora', () => {
      for (const face of die.faces) {
        const normal = faceNormal(die, face);
        const centroid = faceCentroid(die, face);

        for (const vertex of faceVertices(die, face)) {
          expect(Math.abs(vecDot(vecSub(vertex, centroid), normal))).toBeLessThan(1e-9);
        }
        expect(vecDot(normal, centroid)).toBeGreaterThan(0.1);
      }
    });

    it('é convexo: nenhum vértice fica além do plano de uma face', () => {
      for (const face of die.faces) {
        const normal = faceNormal(die, face);
        const centroid = faceCentroid(die, face);
        for (const vertex of die.vertices) {
          expect(vecDot(vecSub(vertex, centroid), normal)).toBeLessThan(1e-9);
        }
      }
    });

    it('passa na validação exigida de dados personalizados', () => {
      expect(() => validateDieDefinition(die)).not.toThrow();
    });

    it('cada face é lida, sem ambiguidade, quando sua direção de leitura aponta para cima', () => {
      for (const face of die.faces) {
        expect(isUnit(face.readDirection)).toBe(true);
        const reading = readFace(die, rotationTo(face.readDirection, WORLD_UP));

        expect(reading.face.id).toBe(face.id);
        expect(reading.alignment).toBeCloseTo(1, 9);
        expect(reading.margin).toBeGreaterThan(0.1);
        expect(isFlat(reading)).toBe(true);
      }
    });

    it('em toda posição de repouso (uma face para baixo) há uma leitura plana', () => {
      const read = new Set<string>();
      for (const face of die.faces) {
        const reading = readFace(die, rotationTo(faceNormal(die, face), DOWN));

        expect(isFlat(reading)).toBe(true);
        read.add(reading.face.id);
      }
      // Cada posição de repouso corresponde a um resultado diferente.
      expect(read.size).toBe(faces);
    });

    it(`tem ${symmetries} rotações de simetria, todas levando o sólido sobre si mesmo`, () => {
      const group = computeRotationGroup(die);

      expect(group).toHaveLength(symmetries);
      for (const rotation of group) {
        for (const vertex of die.vertices) {
          const rotated = rotateVector(rotation, vertex);
          expect(die.vertices.some((other) => vecLength(vecSub(rotated, other)) < 1e-6)).toBe(true);
        }
        // ...e as direções de leitura sobre direções de leitura.
        for (const face of die.faces) {
          const rotated = rotateVector(rotation, face.readDirection);
          expect(die.faces.some((other) => parallel(other.readDirection, rotated))).toBe(true);
        }
      }
    });

    it('qualquer face pode ser exibida no lugar de qualquer outra', () => {
      for (const landed of die.faces) {
        // Corpo físico em repouso com `landed` na posição de leitura.
        const body = rotationTo(landed.readDirection, WORLD_UP);
        for (const target of die.faces) {
          const options = findReorientations(die, target, landed);
          expect(options.length).toBeGreaterThan(0);
          for (const offset of options) {
            const reading = readFace(die, quatMultiply(body, offset));
            expect(reading.face.id).toBe(target.id);
            expect(reading.alignment).toBeCloseTo(1, 6);
          }
        }
      }
    });

    it('os rótulos ficam sobre a própria face, com direção no plano', () => {
      for (const face of die.faces) {
        const normal = faceNormal(die, face);
        const centroid = faceCentroid(die, face);
        const labels = faceLabels(die, face);

        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
          expect(Math.abs(vecDot(vecSub(label.anchor, centroid), normal))).toBeLessThan(1e-9);
          expect(Math.abs(vecDot(label.up, normal))).toBeLessThan(1e-9);
          expect(isUnit(label.up)).toBe(true);
          expect(label.height).toBeGreaterThan(0.05);
        }
      }
    });
  },
);

describe('numeração', () => {
  const oppositeSum = (die: DieDefinition) =>
    die.faces.map((face) => {
      const opposite = die.faces.find((other) =>
        parallel(other.readDirection, vecScale(face.readDirection, -1)),
      );
      return face.value + (opposite?.value ?? Number.NaN);
    });

  it.each([
    [D6, 7],
    [D8, 9],
    [D12, 13],
    [D20, 21],
  ])('$type: faces opostas somam o total da convenção', (die, total) => {
    expect(new Set(oppositeSum(die))).toEqual(new Set([total]));
  });

  it('d10: os dígitos de faces opostas somam 9 e a face "0" vale 10', () => {
    for (const face of D10.faces) {
      const opposite = D10.faces.find((other) =>
        parallel(other.readDirection, vecScale(face.readDirection, -1)),
      )!;
      expect(Number(face.id) + Number(opposite.id)).toBe(9);
      expect(face.value).toBe(face.id === '0' ? 10 : Number(face.id));
    }
  });

  it('d10: dígitos ímpares em torno de um ápice, pares em torno do outro', () => {
    const top = D10.faces.filter((face) => face.vertexIndices.includes(0));

    expect(top.map((face) => Number(face.id) % 2)).toEqual([1, 1, 1, 1, 1]);
  });

  it('d100: dezenas de "00" a "90" valendo 0 a 90; unidades de "0" a "9" valendo 0 a 9', () => {
    for (const face of D100_TENS.faces) {
      expect(face.id).toBe(`${face.value / 10}0`);
      expect(faceLabels(D100_TENS, face)[0]!.text).toBe(face.id);
    }
    for (const face of D100_UNITS.faces) {
      expect(face.id).toBe(String(face.value));
    }
  });

  it.each([D6, D8, D12, D20])('$type: o rótulo de cada face é o seu valor', (die) => {
    for (const face of die.faces) {
      expect(faceLabels(die, face).map((label) => label.text)).toEqual([String(face.value)]);
    }
  });

  it('d10: o rótulo de cada face é o seu dígito', () => {
    for (const face of D10.faces) {
      expect(faceLabels(D10, face).map((label) => label.text)).toEqual([face.id]);
    }
  });

  it('d4: o número junto a cada vértice é o valor lido quando esse vértice fica para cima', () => {
    for (const face of D4.faces) {
      const labels = faceLabels(D4, face);
      expect(labels).toHaveLength(3);

      for (const label of labels) {
        // Vértice da face mais próximo do rótulo.
        const corner = faceVertices(D4, face).reduce((best, vertex) =>
          vecLength(vecSub(vertex, label.anchor)) < vecLength(vecSub(best, label.anchor))
            ? vertex
            : best,
        );
        const reading = readFace(D4, rotationTo(corner, WORLD_UP));

        expect(label.text).toBe(String(reading.face.value));
        // O topo do número aponta para o vértice.
        expect(parallel(label.up, vecSub(corner, label.anchor))).toBe(true);
      }
    }
  });

  it('d4: o valor nunca aparece na face que fica para baixo', () => {
    for (const face of D4.faces) {
      const texts = faceLabels(D4, face).map((label) => label.text);

      expect(texts).not.toContain(String(face.value));
    }
  });
});
