import { describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { faceCentroid, faceNormal, faceVertices } from '../../src/core/die-definition';
import { vecAdd, vecDot, vecLength, vecSub } from '../../src/core/math';

describe('geometria do d6', () => {
  it('tem 8 vértices, 6 faces quadradas e valores de 1 a 6', () => {
    expect(D6.vertices).toHaveLength(8);
    expect(D6.faces.map((face) => face.value).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(D6.faces.every((face) => face.vertexIndices.length === 4)).toBe(true);
    expect(new Set(D6.faces.map((face) => face.id)).size).toBe(6);
  });

  it('é centrado na origem', () => {
    const sum = D6.vertices.reduce(vecAdd, { x: 0, y: 0, z: 0 });

    expect(vecLength(sum)).toBeCloseTo(0, 12);
  });

  it.each(D6.faces)('face $id: plana, com normal para fora igual à direção de leitura', (face) => {
    const normal = faceNormal(D6, face);
    const centroid = faceCentroid(D6, face);

    for (const vertex of faceVertices(D6, face)) {
      expect(vecDot(vecSub(vertex, centroid), normal)).toBeCloseTo(0, 12);
    }
    expect(vecDot(normal, centroid)).toBeGreaterThan(0);
    expect(vecDot(normal, face.readDirection)).toBeCloseTo(1, 12);
    expect(vecLength(face.readDirection)).toBeCloseTo(1, 12);
  });

  it('é convexo: todo vértice fica atrás ou sobre o plano de cada face', () => {
    for (const face of D6.faces) {
      const normal = faceNormal(D6, face);
      const centroid = faceCentroid(D6, face);
      for (const vertex of D6.vertices) {
        expect(vecDot(vecSub(vertex, centroid), normal)).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('cada vértice pertence a exatamente três faces', () => {
    const usage = new Array<number>(D6.vertices.length).fill(0);
    for (const face of D6.faces) for (const index of face.vertexIndices) usage[index]!++;

    expect(usage).toEqual(new Array(8).fill(3));
  });

  it('faces opostas somam 7', () => {
    for (const face of D6.faces) {
      const opposite = D6.faces.find(
        (other) => vecDot(other.readDirection, face.readDirection) < -0.999,
      );

      expect(opposite?.value).toBe(7 - face.value);
    }
  });

  it('1, 2 e 3 giram em sentido anti-horário em torno do vértice comum', () => {
    const direction = (value: number) =>
      D6.faces.find((face) => face.value === value)!.readDirection;
    const [one, two, three] = [direction(1), direction(2), direction(3)];
    // Produto misto positivo = sentido anti-horário visto de fora.
    const triple =
      one.x * (two.y * three.z - two.z * three.y) -
      one.y * (two.x * three.z - two.z * three.x) +
      one.z * (two.x * three.y - two.y * three.x);

    expect(triple).toBeCloseTo(1, 12);
  });
});
