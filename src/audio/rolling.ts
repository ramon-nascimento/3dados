import type { DieDefinition } from '../core/die-definition';
import { rotateVector, vecLength, type Quat } from '../core/math';
import type { DieTrajectory } from '../core/trajectory';

/** Um vértice está apoiado na mesa quando fica a menos disto do ponto mais baixo. */
const CONTACT_BAND = 0.03;
/** O dado está na mesa quando o ponto mais baixo fica abaixo disto. */
const ON_SURFACE = 0.04;

/** Um tombo: o dado passou a se apoiar em um vértice novo enquanto rolava na mesa. */
export interface RollingContact {
  /** Passo da simulação. */
  step: number;
  /** Velocidade do vértice que tocou a mesa (velocidade angular × raio), em unidades/s. */
  speed: number;
}

function rotationAt(trajectory: DieTrajectory, frame: number): Quat {
  const r = trajectory.rotations;
  const i = frame * 4;
  return { x: r[i]!, y: r[i + 1]!, z: r[i + 2]!, w: r[i + 3]! };
}

/** Ângulo entre duas orientações, em radianos. */
function angleBetween(a: Quat, b: Quat): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(dot, 1));
}

/**
 * Encontra os tombos de um dado ao longo da trajetória gravada.
 *
 * A física só registra o início de um contato. Um dado que rola continua
 * encostado na mesa, então os estalos de cada aresta que bate não aparecem
 * como colisão. Aqui eles são reconstruídos da geometria: a cada quadro, o
 * conjunto de vértices apoiados; quando entra um vértice novo com o dado na
 * mesa, houve um tombo. Funciona para qualquer dado convexo e não altera a
 * simulação.
 */
export function findRollingContacts(
  trajectory: DieTrajectory,
  definition: DieDefinition,
  timestep: number,
): RollingContact[] {
  const frames = trajectory.positions.length / 3;
  const vertices = definition.vertices;
  const radius = Math.max(...vertices.map(vecLength));
  const contacts: RollingContact[] = [];
  let previous = new Set<number>();
  const heights = new Float64Array(vertices.length);

  for (let frame = 0; frame < frames; frame++) {
    const rotation = rotationAt(trajectory, frame);
    const centerY = trajectory.positions[frame * 3 + 1]!;
    let lowest = Infinity;
    for (let v = 0; v < vertices.length; v++) {
      const y = centerY + rotateVector(rotation, vertices[v]!).y;
      heights[v] = y;
      if (y < lowest) lowest = y;
    }

    const touching = new Set<number>();
    if (lowest < ON_SURFACE) {
      for (let v = 0; v < vertices.length; v++) {
        if (heights[v]! - lowest < CONTACT_BAND) touching.add(v);
      }
    }

    // Só conta como tombo se o dado já estava na mesa no quadro anterior; a
    // chegada vinda do ar é um impacto, que a física já registra.
    if (frame > 0 && previous.size > 0 && touching.size > 0) {
      const fresh = [...touching].some((v) => !previous.has(v));
      if (fresh) {
        const angle = angleBetween(rotationAt(trajectory, frame - 1), rotation);
        contacts.push({ step: frame, speed: (angle / timestep) * radius });
      }
    }
    previous = touching;
  }
  return contacts;
}
