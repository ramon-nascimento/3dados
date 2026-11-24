import type { DieDefinition, DieFace } from '../die-definition';
import { vec3, type Vec3 } from '../math';

const H = 0.5;

// Cubo de aresta 1 centrado na origem.
const VERTICES: readonly Vec3[] = [
  vec3(-H, -H, -H),
  vec3(+H, -H, -H),
  vec3(+H, +H, -H),
  vec3(-H, +H, -H),
  vec3(-H, -H, +H),
  vec3(+H, -H, +H),
  vec3(+H, +H, +H),
  vec3(-H, +H, +H),
];

function face(value: number, vertexIndices: number[], normal: Vec3): DieFace {
  return { id: String(value), value, vertexIndices, readDirection: normal };
}

/**
 * d6 com a numeração ocidental: faces opostas somam 7 e as faces 1, 2 e 3
 * aparecem em sentido anti-horário em torno do vértice que compartilham.
 */
export const D6: DieDefinition = {
  type: 'd6',
  vertices: VERTICES,
  faces: [
    face(1, [3, 7, 6, 2], vec3(0, 1, 0)),
    face(2, [4, 5, 6, 7], vec3(0, 0, 1)),
    face(3, [1, 2, 6, 5], vec3(1, 0, 0)),
    face(4, [0, 4, 7, 3], vec3(-1, 0, 0)),
    face(5, [0, 3, 2, 1], vec3(0, 0, -1)),
    face(6, [0, 1, 5, 4], vec3(0, -1, 0)),
  ],
};
