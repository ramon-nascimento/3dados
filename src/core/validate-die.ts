import { centroidOf, type DieDefinition, type DieFace, type FaceLabel } from './die-definition';
import { DiceError } from './errors';
import { FLAT_ALIGNMENT_MIN } from './face-reading';
import { vecCross, vecDot, vecLength, vecNormalize, vecSub, type Vec3 } from './math';
import { findReorientations } from './symmetry';

function fail(message: string, details?: Record<string, unknown>): never {
  throw new DiceError('INVALID_DIE_DEFINITION', message, details ? { details } : {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toVec3(value: unknown, where: string): Vec3 {
  if (
    !isRecord(value) ||
    ![value.x, value.y, value.z].every((n) => typeof n === 'number' && Number.isFinite(n))
  ) {
    fail(`${where} precisa ser um vetor {x, y, z} de números finitos.`);
  }
  return { x: value.x as number, y: value.y as number, z: value.z as number };
}

function toLabel(value: unknown, where: string): FaceLabel {
  if (!isRecord(value)) fail(`${where} precisa ser um objeto.`);
  if (typeof value.text !== 'string') fail(`${where}.text precisa ser um texto.`);
  if (typeof value.height !== 'number' || !(value.height > 0) || !Number.isFinite(value.height)) {
    fail(`${where}.height precisa ser um número maior que zero.`);
  }
  const up = toVec3(value.up, `${where}.up`);
  if (vecLength(up) < 1e-9) fail(`${where}.up não pode ser o vetor nulo.`);
  return {
    text: value.text,
    anchor: toVec3(value.anchor, `${where}.anchor`),
    up: vecNormalize(up),
    height: value.height,
  };
}

/**
 * Valida a definição de um dado personalizado e devolve uma cópia normalizada.
 * A definição pode vir de JavaScript sem tipos, então nada é presumido.
 *
 * Exige um poliedro convexo, fechado e com a origem no interior, em que toda
 * posição de repouso tem exatamente uma leitura. Enquanto a busca por
 * condições iniciais não existir (Etapa 4), exige também que as rotações de
 * simetria levem qualquer face a qualquer outra.
 */
export function validateDieDefinition(input: unknown): DieDefinition {
  if (!isRecord(input)) fail('A definição do dado precisa ser um objeto.');
  const { type } = input;
  if (typeof type !== 'string' || type.length === 0) {
    fail('"type" precisa ser um texto não vazio.');
  }
  if (!Array.isArray(input.vertices) || input.vertices.length < 4) {
    fail('Um dado precisa de ao menos 4 vértices.', { type });
  }
  if (!Array.isArray(input.faces) || input.faces.length < 4) {
    fail('Um dado precisa de ao menos 4 faces.', { type });
  }

  const vertices = input.vertices.map((vertex, i) => toVec3(vertex, `vertices[${i}]`));
  const scale = Math.max(...vertices.map(vecLength));
  if (!(scale > 0)) fail('Os vértices não podem estar todos na origem.', { type });
  const tolerance = 1e-6 * scale;

  const ids = new Set<string>();
  const normals: Vec3[] = [];
  const edges = new Map<string, number>();

  const faces: DieFace[] = (input.faces as unknown[]).map((raw, f) => {
    if (!isRecord(raw)) fail(`faces[${f}] precisa ser um objeto.`, { type });
    const { id, value } = raw;
    if (typeof id !== 'string' || id.length === 0) {
      fail(`faces[${f}].id precisa ser um texto não vazio.`, { type });
    }
    if (ids.has(id)) fail(`Identificador de face repetido: "${id}".`, { type, faceId: id });
    ids.add(id);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`faces[${f}].value precisa ser um número finito.`, { type, faceId: id });
    }
    const indices = raw.vertexIndices;
    if (
      !Array.isArray(indices) ||
      indices.length < 3 ||
      !indices.every((n) => Number.isInteger(n) && n >= 0 && n < vertices.length) ||
      new Set(indices).size !== indices.length
    ) {
      fail(
        `faces[${f}].vertexIndices precisa ter ao menos 3 índices de vértice distintos e válidos.`,
        {
          type,
          faceId: id,
        },
      );
    }
    const loop = indices as number[];
    const points = loop.map((index) => vertices[index]!);
    const centroid = centroidOf(points);
    const cross = vecCross(vecSub(points[1]!, points[0]!), vecSub(points[2]!, points[1]!));
    if (vecLength(cross) < tolerance * tolerance) {
      fail(`A face "${id}" é degenerada: seus primeiros vértices são colineares.`, {
        type,
        faceId: id,
      });
    }
    const normal = vecNormalize(cross);
    if (points.some((point) => Math.abs(vecDot(vecSub(point, centroid), normal)) > tolerance)) {
      fail(`A face "${id}" não é plana.`, { type, faceId: id });
    }
    if (vecDot(normal, centroid) <= tolerance) {
      fail(
        `A face "${id}" não aponta para fora: liste os vértices em sentido anti-horário visto de fora e centre o dado na origem.`,
        { type, faceId: id },
      );
    }
    if (vertices.some((vertex) => vecDot(vecSub(vertex, centroid), normal) > tolerance)) {
      fail(`O dado não é convexo: há vértices além do plano da face "${id}".`, {
        type,
        faceId: id,
      });
    }
    normals.push(normal);
    loop.forEach((from, i) => {
      const key = `${from}>${loop[(i + 1) % loop.length]!}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    });

    const readDirection =
      raw.readDirection === undefined
        ? normal
        : toVec3(raw.readDirection, `faces[${f}].readDirection`);
    if (vecLength(readDirection) < 1e-9) {
      fail(`faces[${f}].readDirection não pode ser o vetor nulo.`, { type, faceId: id });
    }
    if (raw.labels !== undefined && !Array.isArray(raw.labels)) {
      fail(`faces[${f}].labels precisa ser uma lista.`, { type, faceId: id });
    }
    const labels = (raw.labels as unknown[] | undefined)?.map((label, i) =>
      toLabel(label, `faces[${f}].labels[${i}]`),
    );
    return {
      id,
      value,
      vertexIndices: loop,
      readDirection: vecNormalize(readDirection),
      ...(labels === undefined ? {} : { labels }),
    };
  });

  // Superfície fechada: cada aresta aparece uma vez em cada sentido.
  for (const [key, count] of edges) {
    const [from, to] = key.split('>');
    if (count !== 1 || edges.get(`${to}>${from}`) !== 1) {
      fail(
        'As faces não formam uma superfície fechada: toda aresta precisa pertencer a exatamente duas faces.',
        {
          type,
          edge: [Number(from), Number(to)],
        },
      );
    }
  }

  // Sem ambiguidade: direções de leitura distintas...
  faces.forEach((face, i) => {
    const clash = faces.find(
      (other, j) => j > i && vecDot(other.readDirection, face.readDirection) > 1 - 1e-6,
    );
    if (clash) {
      fail(`As faces "${face.id}" e "${clash.id}" têm a mesma direção de leitura.`, { type });
    }
  });
  // ...e, em cada posição de repouso (uma face para baixo), uma leitura apontando para cima.
  faces.forEach((resting, i) => {
    const up = { x: -normals[i]!.x, y: -normals[i]!.y, z: -normals[i]!.z };
    if (!faces.some((face) => vecDot(face.readDirection, up) >= FLAT_ALIGNMENT_MIN)) {
      fail(
        `Com o dado apoiado na face "${resting.id}", nenhuma direção de leitura aponta para cima: o resultado seria ambíguo.`,
        { type, faceId: resting.id },
      );
    }
  });

  const definition: DieDefinition = { type, vertices, faces };
  const reference = faces[0]!;
  const unreachable = faces.find(
    (face) => findReorientations(definition, face, reference).length === 0,
  );
  if (unreachable) {
    fail(
      `O dado "${type}" não tem simetria que leve a face "${unreachable.id}" à face "${reference.id}". Dados assim ainda não são suportados (previsto para a Etapa 4).`,
      { type, faceId: unreachable.id },
    );
  }
  return definition;
}
