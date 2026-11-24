import { describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import type { DieDefinition, DieFace } from '../../src/core/die-definition';
import { vec3, vecScale } from '../../src/core/math';
import { buildConvexFaces, createDieDefinition } from '../../src/core/polyhedron';
import { validateDieDefinition } from '../../src/core/validate-die';

/** Cópia mutável do d6, para estragar de um jeito por teste. */
function cube(): {
  type: string;
  vertices: { x: number; y: number; z: number }[];
  faces: DieFace[];
} {
  return structuredClone(D6) as never;
}

function errorOf(definition: unknown): { code?: string; message: string } {
  try {
    validateDieDefinition(definition);
  } catch (error) {
    return error as { code: string; message: string };
  }
  return { message: '' };
}

describe('validateDieDefinition', () => {
  it('aceita um dado personalizado válido, inclusive com valores repetidos e símbolos', () => {
    const fudge: DieDefinition = {
      type: 'dF',
      vertices: D6.vertices,
      faces: D6.faces.map((face, i) => ({
        ...face,
        id: `f${i}`,
        value: [1, 1, 0, 0, -1, -1][i]!,
        labels: [
          {
            text: ['+', '+', '', '', '−', '−'][i]!,
            anchor: vecScale(face.readDirection, 0.5),
            up: i < 2 || i > 3 ? vec3(0, 0, 1) : vec3(0, 1, 0),
            height: 0.6,
          },
        ].map((label) => ({ ...label, up: face.readDirection.z !== 0 ? vec3(0, 1, 0) : label.up })),
      })),
    };

    const validated = validateDieDefinition(fudge);

    expect(validated.type).toBe('dF');
    expect(validated.faces.map((face) => face.value)).toEqual([1, 1, 0, 0, -1, -1]);
    expect(validated.faces[0]!.labels?.[0]?.text).toBe('+');
  });

  it('normaliza direções de leitura e usa a normal quando omitidas', () => {
    const definition = cube();
    definition.faces = definition.faces.map((face, i) =>
      i === 0 ? { ...face, readDirection: vecScale(face.readDirection, 7) } : face,
    );
    delete (definition.faces[1] as { readDirection?: unknown }).readDirection;

    const validated = validateDieDefinition(definition);

    expect(validated.faces[0]!.readDirection).toEqual(D6.faces[0]!.readDirection);
    expect(validated.faces[1]!.readDirection.z).toBeCloseTo(1, 12);
  });

  it('aceita um dado montado a partir dos vértices', () => {
    // Bipirâmide quadrada alongada: oito faces equivalentes, opostas duas a duas.
    const bipyramid = createDieDefinition(
      'd8-alongado',
      [
        vec3(0, 1.3, 0),
        vec3(0, -1.3, 0),
        vec3(1, 0, 0),
        vec3(-1, 0, 0),
        vec3(0, 0, 1),
        vec3(0, 0, -1),
      ],
      (face) => ({ value: face.index + 1, id: `f${face.index}` }),
    );

    const validated = validateDieDefinition(bipyramid);

    expect(validated.faces).toHaveLength(8);
  });

  it('rejeita leitura pela face de cima em um sólido sem faces opostas', () => {
    // Bipirâmide triangular: apoiada em uma face, nenhuma outra fica paralela à mesa.
    const bipyramid = createDieDefinition(
      'bipiramide-triangular',
      [
        vec3(0, 1.2, 0),
        vec3(0, -1.2, 0),
        vec3(1, 0, 0),
        vec3(-0.5, 0, 0.866),
        vec3(-0.5, 0, -0.866),
      ],
      (face) => ({ value: face.index + 1, id: `f${face.index}` }),
    );

    const error = errorOf(bipyramid);

    expect(error.code).toBe('INVALID_DIE_DEFINITION');
    expect(error.message).toMatch(/ambíguo/);
  });

  it.each([
    ['definição que não é objeto', () => 'd6', /objeto/],
    ['type vazio', () => ({ ...cube(), type: '' }), /type/],
    [
      'menos de 4 vértices',
      () => ({ ...cube(), vertices: cube().vertices.slice(0, 3) }),
      /4 vértices/,
    ],
    ['menos de 4 faces', () => ({ ...cube(), faces: cube().faces.slice(0, 3) }), /4 faces/],
    [
      'vértice com coordenada não finita',
      () => {
        const d = cube();
        d.vertices[0]!.x = Number.NaN;
        return d;
      },
      /vertices\[0\]/,
    ],
    [
      'identificador de face repetido',
      () => {
        const d = cube();
        d.faces[1] = { ...d.faces[1]!, id: d.faces[0]!.id };
        return d;
      },
      /repetido/,
    ],
    [
      'valor que não é número',
      () => {
        const d = cube();
        d.faces[0] = { ...d.faces[0]!, value: '1' as never };
        return d;
      },
      /value/,
    ],
    [
      'índice de vértice inexistente',
      () => {
        const d = cube();
        d.faces[0] = { ...d.faces[0]!, vertexIndices: [0, 1, 99] };
        return d;
      },
      /vertexIndices/,
    ],
    [
      'face não plana',
      () => {
        const d = cube();
        d.vertices[6]!.y = 0.8;
        return d;
      },
      /não é plana/,
    ],
    [
      'face listada em sentido horário',
      () => {
        const d = cube();
        d.faces[0] = { ...d.faces[0]!, vertexIndices: [...d.faces[0]!.vertexIndices].reverse() };
        return d;
      },
      /não aponta para fora/,
    ],
    [
      'superfície aberta (falta uma face)',
      () => {
        const d = cube();
        const pyramid = [
          vec3(1, 0, 1),
          vec3(-1, 0, 1),
          vec3(-1, 0, -1),
          vec3(1, 0, -1),
          vec3(0, 1.5, 0),
        ];
        const shifted = pyramid.map((v) => vec3(v.x, v.y - 0.4, v.z));
        const hull = buildConvexFaces(shifted);
        d.vertices = shifted;
        d.faces = hull.slice(0, -1).map((face) => ({
          id: `f${face.index}`,
          value: face.index,
          vertexIndices: face.vertexIndices,
          readDirection: face.normal,
        }));
        return d;
      },
      /superfície fechada/,
    ],
    [
      'duas faces com a mesma direção de leitura',
      () => {
        const d = cube();
        d.faces[1] = { ...d.faces[1]!, readDirection: d.faces[0]!.readDirection };
        return d;
      },
      /mesma direção de leitura/,
    ],
    [
      'posição de repouso sem leitura para cima',
      () => {
        const d = cube();
        d.faces[0] = { ...d.faces[0]!, readDirection: vec3(0.3, 1, 0) };
        return d;
      },
      /ambíguo/,
    ],
    [
      'rótulo com altura inválida',
      () => {
        const d = cube();
        d.faces[0] = {
          ...d.faces[0]!,
          labels: [{ text: 'x', anchor: vec3(0, 0.5, 0), up: vec3(0, 0, 1), height: 0 }],
        };
        return d;
      },
      /height/,
    ],
  ])('rejeita %s', (_name, build, message) => {
    const error = errorOf(build());

    expect(error.code).toBe('INVALID_DIE_DEFINITION');
    expect(error.message).toMatch(message);
  });

  it('rejeita um sólido não convexo', () => {
    // Cubo com um vértice empurrado para dentro: as faces vizinhas deixam de ser planas
    // ou o sólido deixa de ser convexo; em ambos os casos a definição é recusada.
    const dented = cube();
    dented.vertices[6] = { x: 0.1, y: 0.1, z: 0.1 };

    expect(errorOf(dented).code).toBe('INVALID_DIE_DEFINITION');
  });

  it('aceita dados sem simetria entre todas as faces', () => {
    // Pirâmide de base quadrada: a base não é equivalente às faces laterais.
    const vertices = [
      vec3(1, -0.4, 1),
      vec3(-1, -0.4, 1),
      vec3(-1, -0.4, -1),
      vec3(1, -0.4, -1),
      vec3(0, 1.1, 0),
    ];
    const pyramid = createDieDefinition('piramide', vertices, (face) => ({
      value: face.index + 1,
      id: `f${face.index}`,
      // Lê-se a face que fica para baixo.
      readDirection: vecScale(face.normal, -1),
    }));

    expect(validateDieDefinition(pyramid).faces).toHaveLength(5);
  });

  it('rejeita um dado que não consegue repousar em uma de suas faces', () => {
    // Torre inclinada: base larga e topo minúsculo, deslocado para o lado.
    // Apoiada no topo, ela tomba.
    const raw = [
      vec3(-1, 0, -1),
      vec3(1, 0, -1),
      vec3(1, 0, 1),
      vec3(-1, 0, 1),
      vec3(2.9, 2, -0.1),
      vec3(3.1, 2, -0.1),
      vec3(3.1, 2, 0.1),
      vec3(2.9, 2, 0.1),
    ];
    const center = raw.reduce(
      (sum, p) => vec3(sum.x + p.x / 8, sum.y + p.y / 8, sum.z + p.z / 8),
      vec3(0, 0, 0),
    );
    const tower = createDieDefinition(
      'torre',
      raw.map((p) => vec3(p.x - center.x, p.y - center.y, p.z - center.z)),
      (face) => ({
        value: face.index + 1,
        id: `f${face.index}`,
        readDirection: vecScale(face.normal, -1),
      }),
    );

    const error = errorOf(tower);

    expect(error.code).toBe('INVALID_DIE_DEFINITION');
    expect(error.message).toMatch(/repousar/);
  });
});
