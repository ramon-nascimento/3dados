import { describe, expect, it } from 'vitest';
import { faceCentroid, faceNormal, faceVertices } from '../../src/core/die-definition';
import {
  BEVEL,
  DEFAULT_CHAMFER,
  buildDieMeshData,
  type DieMeshData,
} from '../../src/renderer/die-mesh-data';
import { ALL_DICE } from './helpers/dice';

type Point = readonly [number, number, number];

function triangles(data: DieMeshData) {
  return Array.from(data.triangleFaces, (tag, t) => {
    const corner = (c: number) => {
      const v = t * 3 + c;
      return {
        position: [
          data.positions[v * 3]!,
          data.positions[v * 3 + 1]!,
          data.positions[v * 3 + 2]!,
        ] as Point,
        normal: [data.normals[v * 3]!, data.normals[v * 3 + 1]!, data.normals[v * 3 + 2]!] as Point,
        uv: [data.uvs[v * 2]!, data.uvs[v * 2 + 1]!] as const,
      };
    };
    return { tag, corners: [corner(0), corner(1), corner(2)] as const };
  });
}

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point, b: Point): Point => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe.each(ALL_DICE)('malha do $die.type', ({ die, faces, sidesPerFace }) => {
  const sharp = buildDieMeshData(die, 0);
  const beveled = buildDieMeshData(die);
  const { columns, rows } = beveled.atlas;
  const cellOf = (index: number) => ({ column: index % columns, row: Math.floor(index / columns) });

  it('sem chanfro, tem só os triângulos das faces', () => {
    expect(sharp.triangleFaces).toHaveLength(faces * (sidesPerFace - 2));
    expect(Array.from(sharp.triangleFaces).every((tag) => tag < faces)).toBe(true);
  });

  it('o atlas tem uma célula por face e uma célula livre para o chanfro', () => {
    expect(columns * rows).toBeGreaterThanOrEqual(faces + 1);
    expect(beveled.atlas.cells).toHaveLength(faces);
  });

  it.each([
    ['sem chanfro', sharp],
    ['com chanfro', beveled],
  ])('%s: todo triângulo é voltado para fora', (_name, data) => {
    for (const { corners } of triangles(data)) {
      const [a, b, c] = corners.map((corner) => corner.position) as [Point, Point, Point];
      const geometric = cross(sub(b, a), sub(c, a));
      const center: Point = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ];

      expect(dot(geometric, center)).toBeGreaterThan(0);
    }
  });

  it('com chanfro, a malha fica dentro do sólido usado pela física', () => {
    for (const face of die.faces) {
      const n = faceNormal(die, face);
      const c = faceCentroid(die, face);
      for (const { corners } of triangles(beveled)) {
        for (const { position } of corners) {
          const distance =
            (position[0] - c.x) * n.x + (position[1] - c.y) * n.y + (position[2] - c.z) * n.z;
          expect(distance).toBeLessThan(1e-5);
        }
      }
    }
  });

  it('com chanfro, a malha é fechada: toda aresta pertence a dois triângulos', () => {
    const key = (p: Point) => p.map((n) => Math.round(n * 1e4)).join(',');
    const edges = new Map<string, number>();
    for (const { corners } of triangles(beveled)) {
      for (let i = 0; i < 3; i++) {
        const pair = [key(corners[i]!.position), key(corners[(i + 1) % 3]!.position)]
          .sort()
          .join('|');
        edges.set(pair, (edges.get(pair) ?? 0) + 1);
      }
    }

    expect([...edges.values()].every((count) => count === 2)).toBe(true);
  });

  it('os triângulos de cada face ficam no plano dela, com a normal dela e na célula dela', () => {
    for (const { tag, corners } of triangles(beveled)) {
      if (tag === BEVEL) continue;
      const face = die.faces[tag]!;
      const n = faceNormal(die, face);
      const c = faceCentroid(die, face);
      const { column, row } = cellOf(tag);

      for (const { position, normal, uv } of corners) {
        expect(
          Math.abs(
            (position[0] - c.x) * n.x + (position[1] - c.y) * n.y + (position[2] - c.z) * n.z,
          ),
        ).toBeLessThan(1e-5);
        expect(dot(normal, [n.x, n.y, n.z])).toBeCloseTo(1, 5);
        expect(uv[0]).toBeGreaterThanOrEqual(column / columns - 1e-6);
        expect(uv[0]).toBeLessThanOrEqual((column + 1) / columns + 1e-6);
        expect(uv[1]).toBeGreaterThanOrEqual(1 - (row + 1) / rows - 1e-6);
        expect(uv[1]).toBeLessThanOrEqual(1 - row / rows + 1e-6);
      }
    }
  });

  it('o chanfro usa só a célula livre do atlas', () => {
    const { column, row } = cellOf(faces);
    const bevel = triangles(beveled).filter(({ tag }) => tag === BEVEL);

    expect(bevel.length).toBeGreaterThan(0);
    for (const { corners } of bevel) {
      for (const { uv } of corners) {
        expect(uv[0]).toBeCloseTo((column + 0.5) / columns, 6);
        expect(uv[1]).toBeCloseTo(1 - (row + 0.5) / rows, 6);
      }
    }
  });

  it('o chanfro recua cada face da largura pedida', () => {
    for (const { tag, corners } of triangles(beveled)) {
      if (tag === BEVEL) continue;
      const face = die.faces[tag]!;
      const original = faceVertices(die, face);
      for (const { position } of corners) {
        // Distância do ponto recuado à aresta original mais próxima.
        const nearest = Math.min(
          ...original.map((start, i) => {
            const end = original[(i + 1) % original.length]!;
            const edge: Point = [end.x - start.x, end.y - start.y, end.z - start.z];
            const offset: Point = [
              position[0] - start.x,
              position[1] - start.y,
              position[2] - start.z,
            ];
            const length = Math.hypot(...edge);
            return Math.hypot(...cross(edge, offset)) / length;
          }),
        );
        expect(nearest).toBeCloseTo(DEFAULT_CHAMFER, 4);
      }
    }
  });

  it('cada célula traz os rótulos da sua face, dentro da célula', () => {
    die.faces.forEach((face, index) => {
      const labels = beveled.atlas.cells[index]!;
      const expected = face.labels?.map((label) => label.text) ?? [String(face.value)];

      expect(labels.map((label) => label.text)).toEqual(expected);
      for (const label of labels) {
        expect(label.x).toBeGreaterThan(0.1);
        expect(label.x).toBeLessThan(0.9);
        expect(label.y).toBeGreaterThan(0.1);
        expect(label.y).toBeLessThan(0.9);
        expect(label.height).toBeGreaterThan(0.05);
        expect(label.height).toBeLessThan(0.8);
        expect(Number.isFinite(label.angle)).toBe(true);
      }
    });
  });

  it('sublinha 6 e 9 só quando o dado tem os dois', () => {
    const texts = beveled.atlas.cells.flat().map((label) => label.text);
    const ambiguous = texts.includes('6') && texts.includes('9');

    for (const label of beveled.atlas.cells.flat()) {
      expect(label.underline).toBe(ambiguous && (label.text === '6' || label.text === '9'));
    }
  });
});
