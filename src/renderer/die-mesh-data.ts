import {
  faceCentroid,
  faceLabels,
  faceNormal,
  faceVertices,
  type DieDefinition,
} from '../core/die-definition';
import {
  vecAdd,
  vecCross,
  vecDot,
  vecLength,
  vecNormalize,
  vecScale,
  vecSub,
  type Vec3,
} from '../core/math';

/** Um texto a desenhar em uma célula do atlas, em coordenadas da célula. */
export interface LabelDraw {
  text: string;
  /** Centro do texto, de 0 a 1, com `y` crescendo para cima. */
  x: number;
  y: number;
  /** Rotação anti-horária do texto, em radianos. */
  angle: number;
  /** Altura da fonte como fração do lado da célula. */
  height: number;
  /** Traço sob o texto, para distinguir 6 de 9. */
  underline: boolean;
}

/**
 * Grade do atlas de rótulos: a célula `i` pertence à face `i` do dado. Há uma
 * célula a mais, sem rótulos, usada pelo chanfro.
 */
export interface AtlasLayout {
  columns: number;
  rows: number;
  /** Rótulos de cada face, na ordem das faces. */
  cells: readonly (readonly LabelDraw[])[];
}

/** Malha de um dado como arrays puros, sem depender de three. */
export interface DieMeshData {
  /** Triângulos não indexados: 3 números por vértice. */
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Índice da face de cada triângulo, ou `BEVEL` para o chanfro. */
  triangleFaces: Uint16Array;
  atlas: AtlasLayout;
}

/** Marca, em `triangleFaces`, os triângulos do chanfro. */
export const BEVEL = 0xffff;

/** Largura padrão do chanfro, em unidades (1 unidade = aresta de um d6). */
export const DEFAULT_CHAMFER = 0.06;

/**
 * Fração do menor raio inscrito das faces que o chanfro pode ocupar. Acima
 * disso o contorno recuado de uma face pequena se inverteria.
 */
const MAX_CHAMFER_FRACTION = 0.4;

/** Maior chanfro que a geometria do dado comporta sem inverter nenhuma face. */
export function maxChamfer(definition: DieDefinition): number {
  let smallest = Infinity;
  for (const face of definition.faces) {
    const vertices = faceVertices(definition, face);
    const centroid = faceCentroid(definition, face);
    vertices.forEach((start, i) => {
      const end = vertices[(i + 1) % vertices.length]!;
      const edge = vecSub(end, start);
      const distance = vecLength(vecCross(edge, vecSub(centroid, start))) / vecLength(edge);
      smallest = Math.min(smallest, distance);
    });
  }
  return smallest * MAX_CHAMFER_FRACTION;
}

/** Eixos ortonormais e oblíquos da projeção do chanfro na célula livre. */
const BEVEL_AXIS_U: Vec3 = { x: 0.8, y: 0.6, z: 0 };
const BEVEL_AXIS_V: Vec3 = { x: -0.36, y: 0.48, z: 0.8 };

interface FaceFrame {
  normal: Vec3;
  centroid: Vec3;
  /** Eixos da célula do atlas no plano da face. */
  right: Vec3;
  up: Vec3;
  /** Metade do lado da célula, em unidades. */
  extent: number;
  column: number;
  row: number;
}

/**
 * Constrói a malha a partir da definição do dado.
 *
 * Cada face é mapeada na sua própria célula do atlas; o que liga o valor
 * lógico ao que é desenhado é só o índice da face. Com `chamfer > 0`, as faces
 * são recuadas e as arestas e os vértices viram faixas com normais
 * interpoladas, o que dá a aparência arredondada. A malha fica sempre dentro
 * do sólido original, que é o que a física usa. O chanfro pedido é limitado a
 * {@link maxChamfer}.
 *
 * O chanfro usa a célula livre do atlas, projetando a posição de cada ponto
 * nela: com um tema de cor lisa a célula é uniforme; com textura, o padrão
 * continua pelas arestas em vez de virar uma mancha de uma cor só.
 */
export function buildDieMeshData(
  definition: DieDefinition,
  requestedChamfer: number = DEFAULT_CHAMFER,
): DieMeshData {
  const chamfer = Math.min(requestedChamfer, maxChamfer(definition));
  const faceCount = definition.faces.length;
  const columns = Math.ceil(Math.sqrt(faceCount + 1));
  const rows = Math.ceil((faceCount + 1) / columns);
  const texts = new Set(
    definition.faces.flatMap((face) => faceLabels(definition, face).map((label) => label.text)),
  );
  const ambiguousSixNine = texts.has('6') && texts.has('9');

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const triangleFaces: number[] = [];

  const frames: FaceFrame[] = definition.faces.map((face, faceIndex) => {
    const vertices = faceVertices(definition, face);
    const normal = faceNormal(definition, face);
    const centroid = faceCentroid(definition, face);
    const edgeMiddle = vecScale(vecAdd(vertices[0]!, vertices[1]!), 0.5);
    const up = vecNormalize(vecSub(edgeMiddle, centroid));
    const right = vecCross(up, normal);
    const extent = Math.max(
      ...vertices.flatMap((vertex) => {
        const offset = vecSub(vertex, centroid);
        return [Math.abs(vecDot(offset, right)), Math.abs(vecDot(offset, up))];
      }),
    );
    return {
      normal,
      centroid,
      right,
      up,
      extent,
      column: faceIndex % columns,
      row: Math.floor(faceIndex / columns),
    };
  });

  /** Coordenadas de um ponto da face dentro da sua célula, de 0 a 1. */
  const inCell = (frame: FaceFrame, point: Vec3) => {
    const offset = vecSub(point, frame.centroid);
    return {
      x: 0.5 + vecDot(offset, frame.right) / (2 * frame.extent),
      y: 0.5 + vecDot(offset, frame.up) / (2 * frame.extent),
    };
  };
  // A linha 0 do atlas fica no topo da imagem; v cresce para cima.
  const cellUv = (column: number, row: number, x: number, y: number): [number, number] => [
    (column + x) / columns,
    1 - (row + 1 - y) / rows,
  ];
  const radius = Math.max(...definition.vertices.map(vecLength));
  /** Ponto do chanfro projetado na célula livre, dentro de uma margem de 10%. */
  const bevelUv = (point: Vec3): [number, number] =>
    cellUv(
      faceCount % columns,
      Math.floor(faceCount / columns),
      0.5 + (0.4 * vecDot(point, BEVEL_AXIS_U)) / radius,
      0.5 + (0.4 * vecDot(point, BEVEL_AXIS_V)) / radius,
    );

  /** Emite um polígono convexo como leque de triângulos, voltado para `outward`. */
  const emit = (
    points: Vec3[],
    pointNormals: Vec3[],
    pointUvs: [number, number][],
    outward: Vec3,
    tag: number,
  ) => {
    const geometric = vecCross(vecSub(points[1]!, points[0]!), vecSub(points[2]!, points[0]!));
    const order = points.map((_, i) => i);
    if (vecDot(geometric, outward) < 0) order.reverse();
    for (let i = 1; i < order.length - 1; i++) {
      for (const index of [order[0]!, order[i]!, order[i + 1]!]) {
        const point = points[index]!;
        const normal = pointNormals[index]!;
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
        uvs.push(...pointUvs[index]!);
      }
      triangleFaces.push(tag);
    }
  };

  // Vértices de cada face, recuados de `chamfer` em relação às duas arestas vizinhas.
  const inset: Vec3[][] = definition.faces.map((face) => {
    const vertices = faceVertices(definition, face);
    if (chamfer <= 0) return vertices;
    return vertices.map((vertex, i) => {
      const toNext = vecNormalize(vecSub(vertices[(i + 1) % vertices.length]!, vertex));
      const toPrevious = vecNormalize(
        vecSub(vertices[(i + vertices.length - 1) % vertices.length]!, vertex),
      );
      const sine = vecLength(vecCross(toNext, toPrevious));
      return vecAdd(vertex, vecScale(vecAdd(toNext, toPrevious), chamfer / sine));
    });
  });

  definition.faces.forEach((_, f) => {
    const frame = frames[f]!;
    const points = inset[f]!;
    emit(
      points,
      points.map(() => frame.normal),
      points.map((point) => {
        const { x, y } = inCell(frame, point);
        return cellUv(frame.column, frame.row, x, y);
      }),
      frame.normal,
      f,
    );
  });

  if (chamfer > 0) {
    // Aresta dirigida "a>b" → face que a contém e posição de `a` no contorno.
    const edgeOwner = new Map<string, { face: number; position: number }>();
    definition.faces.forEach((face, f) => {
      face.vertexIndices.forEach((from, position) => {
        const to = face.vertexIndices[(position + 1) % face.vertexIndices.length]!;
        edgeOwner.set(`${from}>${to}`, { face: f, position });
      });
    });
    const next = (f: number, position: number) =>
      (position + 1) % definition.faces[f]!.vertexIndices.length;

    // Uma faixa por aresta, entre os contornos recuados das duas faces vizinhas.
    for (const [key, a] of edgeOwner) {
      const [from, to] = key.split('>').map(Number) as [number, number];
      if (from > to) continue;
      const b = edgeOwner.get(`${to}>${from}`);
      if (!b) continue;
      const na = frames[a.face]!.normal;
      const nb = frames[b.face]!.normal;
      emit(
        [
          inset[a.face]![a.position]!,
          inset[a.face]![next(a.face, a.position)]!,
          inset[b.face]![b.position]!,
          inset[b.face]![next(b.face, b.position)]!,
        ],
        [na, na, nb, nb],
        [
          inset[a.face]![a.position]!,
          inset[a.face]![next(a.face, a.position)]!,
          inset[b.face]![b.position]!,
          inset[b.face]![next(b.face, b.position)]!,
        ].map(bevelUv),
        vecAdd(na, nb),
        BEVEL,
      );
    }

    // Um polígono por vértice, ligando os cantos recuados das faces que o tocam.
    definition.vertices.forEach((_, vertex) => {
      const start = definition.faces.findIndex((face) => face.vertexIndices.includes(vertex));
      if (start < 0) return;
      const corners: Vec3[] = [];
      const cornerNormals: Vec3[] = [];
      let f = start;
      do {
        const loop = definition.faces[f]!.vertexIndices;
        const position = loop.indexOf(vertex);
        corners.push(inset[f]![position]!);
        cornerNormals.push(frames[f]!.normal);
        // A face seguinte é a que compartilha a aresta que sai deste vértice.
        const twin = edgeOwner.get(`${loop[(position + 1) % loop.length]!}>${vertex}`);
        if (!twin) return;
        f = twin.face;
      } while (f !== start && corners.length <= definition.faces.length);

      emit(corners, cornerNormals, corners.map(bevelUv), cornerNormals.reduce(vecAdd), BEVEL);
    });
  }

  const cells = definition.faces.map((face, f) => {
    const frame = frames[f]!;
    return faceLabels(definition, face).map((label): LabelDraw => {
      const { x, y } = inCell(frame, label.anchor);
      return {
        text: label.text,
        x,
        y,
        angle: Math.atan2(-vecDot(label.up, frame.right), vecDot(label.up, frame.up)),
        height: label.height / (2 * frame.extent),
        underline: ambiguousSixNine && (label.text === '6' || label.text === '9'),
      };
    });
  });

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    triangleFaces: new Uint16Array(triangleFaces),
    atlas: { columns, rows, cells },
  };
}
