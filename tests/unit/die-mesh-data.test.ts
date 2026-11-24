import { describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { faceNormal } from '../../src/core/die-definition';
import { atlasLayout, buildDieMeshData } from '../../src/renderer/die-mesh-data';

const data = buildDieMeshData(D6);
const triangleCount = data.triangleFaces.length;

describe('buildDieMeshData (d6)', () => {
  it('gera dois triângulos por face', () => {
    expect(triangleCount).toBe(12);
    expect(data.positions).toHaveLength(triangleCount * 9);
    expect(data.normals).toHaveLength(triangleCount * 9);
    expect(data.uvs).toHaveLength(triangleCount * 6);
  });

  it('o atlas tem uma célula por face, com o valor da face como rótulo', () => {
    const layout = atlasLayout(D6);

    expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(D6.faces.length);
    expect(layout.labels).toEqual(D6.faces.map((face) => String(face.value)));
    expect(data.atlas).toEqual(layout);
  });

  it('cada triângulo usa a normal e a célula do atlas da sua própria face', () => {
    const { columns, rows } = data.atlas;

    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const faceIndex = data.triangleFaces[triangle]!;
      const normal = faceNormal(D6, D6.faces[faceIndex]!);
      const column = faceIndex % columns;
      const row = Math.floor(faceIndex / columns);

      for (let corner = 0; corner < 3; corner++) {
        const vertex = triangle * 3 + corner;
        expect(data.normals[vertex * 3]).toBeCloseTo(normal.x, 6);
        expect(data.normals[vertex * 3 + 1]).toBeCloseTo(normal.y, 6);
        expect(data.normals[vertex * 3 + 2]).toBeCloseTo(normal.z, 6);

        const u = data.uvs[vertex * 2]!;
        const v = data.uvs[vertex * 2 + 1]!;
        expect(u).toBeGreaterThanOrEqual(column / columns - 1e-6);
        expect(u).toBeLessThanOrEqual((column + 1) / columns + 1e-6);
        // v cresce para cima; a linha 0 do atlas é o topo.
        expect(v).toBeGreaterThanOrEqual(1 - (row + 1) / rows - 1e-6);
        expect(v).toBeLessThanOrEqual(1 - row / rows + 1e-6);
      }
    }
  });

  it('os triângulos ficam no plano da face e voltados para fora', () => {
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const p = (corner: number) => {
        const i = (triangle * 3 + corner) * 3;
        return [data.positions[i]!, data.positions[i + 1]!, data.positions[i + 2]!] as const;
      };
      const [a, b, c] = [p(0), p(1), p(2)];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const normal = faceNormal(D6, D6.faces[data.triangleFaces[triangle]!]!);

      expect(cross[0]! * normal.x + cross[1]! * normal.y + cross[2]! * normal.z).toBeGreaterThan(0);
    }
  });
});
