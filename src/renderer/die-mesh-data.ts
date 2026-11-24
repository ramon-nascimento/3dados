import { faceCentroid, faceNormal, faceVertices, type DieDefinition } from '../core/die-definition';
import { vecAdd, vecCross, vecDot, vecNormalize, vecScale, vecSub } from '../core/math';

/** Grade do atlas de rótulos: a célula `i` pertence à face `i` do dado. */
export interface AtlasLayout {
  columns: number;
  rows: number;
  /** Texto de cada célula, na ordem das faces. */
  labels: readonly string[];
}

/** Malha de um dado como arrays puros, sem depender de three. */
export interface DieMeshData {
  /** Triângulos não indexados: 3 números por vértice. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Índice da face de cada triângulo. */
  triangleFaces: Uint16Array;
  atlas: AtlasLayout;
}

export function atlasLayout(definition: DieDefinition): AtlasLayout {
  const columns = Math.ceil(Math.sqrt(definition.faces.length));
  return {
    columns,
    rows: Math.ceil(definition.faces.length / columns),
    labels: definition.faces.map((face) => String(face.value)),
  };
}

/**
 * Constrói a malha a partir da definição do dado. Cada face é mapeada na sua
 * própria célula do atlas, com o rótulo em pé na direção do meio da primeira
 * aresta. O que liga o valor lógico ao valor desenhado é só o índice da face.
 */
export function buildDieMeshData(definition: DieDefinition): DieMeshData {
  const atlas = atlasLayout(definition);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const triangleFaces: number[] = [];

  definition.faces.forEach((face, faceIndex) => {
    const vertices = faceVertices(definition, face);
    const normal = faceNormal(definition, face);
    const centroid = faceCentroid(definition, face);
    const edgeMiddle = vecScale(vecAdd(vertices[0]!, vertices[1]!), 0.5);
    const up = vecNormalize(vecSub(edgeMiddle, centroid));
    const right = vecCross(up, normal);

    // Coordenadas 2D no plano da face, normalizadas para caber na célula.
    const planar = vertices.map((vertex) => {
      const offset = vecSub(vertex, centroid);
      return { x: vecDot(offset, right), y: vecDot(offset, up) };
    });
    const extent = Math.max(...planar.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)]));
    const column = faceIndex % atlas.columns;
    const row = Math.floor(faceIndex / atlas.columns);
    const cellUv = planar.map((p) => {
      const x01 = 0.5 + p.x / (2 * extent);
      const y01 = 0.5 + p.y / (2 * extent);
      // A linha 0 do atlas fica no topo da imagem; v cresce para cima.
      return { u: (column + x01) / atlas.columns, v: 1 - (row + 1 - y01) / atlas.rows };
    });

    for (let i = 1; i < vertices.length - 1; i++) {
      for (const index of [0, i, i + 1]) {
        const vertex = vertices[index]!;
        const uv = cellUv[index]!;
        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(uv.u, uv.v);
      }
      triangleFaces.push(faceIndex);
    }
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    triangleFaces: new Uint16Array(triangleFaces),
    atlas,
  };
}
