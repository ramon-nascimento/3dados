import type { DieDefinition, DieFace } from './die-definition';
import { DiceError } from './errors';
import { WORLD_UP, rotateVector, vecDot, type Quat, type Vec3 } from './math';

export interface FaceReading {
  /** Face cuja direção de leitura está mais alinhada com "para cima". */
  face: DieFace;
  /** Cosseno do ângulo entre a direção de leitura e "para cima". 1 = perfeitamente plano. */
  alignment: number;
  /** Diferença de alinhamento para a segunda melhor face. Perto de 0 = ambíguo. */
  margin: number;
}

/**
 * Alinhamento mínimo para considerar que o dado está assentado em uma face
 * (cos 2,5° ≈ 0,999). Abaixo disso o dado está inclinado ou apoiado em algo.
 */
export const FLAT_ALIGNMENT_MIN = 0.999;

/**
 * Lê o resultado de um dado a partir da sua orientação. É a única função que
 * converte orientação em valor: física, verificação e testes passam por ela.
 */
export function readFace(
  definition: DieDefinition,
  rotation: Quat,
  up: Vec3 = WORLD_UP,
): FaceReading {
  let best: DieFace | undefined;
  let bestAlignment = -Infinity;
  let secondAlignment = -Infinity;

  for (const face of definition.faces) {
    const alignment = vecDot(rotateVector(rotation, face.readDirection), up);
    if (alignment > bestAlignment) {
      secondAlignment = bestAlignment;
      bestAlignment = alignment;
      best = face;
    } else if (alignment > secondAlignment) {
      secondAlignment = alignment;
    }
  }

  if (!best) {
    throw new DiceError('INVALID_ARGUMENT', `O dado "${definition.type}" não tem faces.`);
  }
  return { face: best, alignment: bestAlignment, margin: bestAlignment - secondAlignment };
}

/** `true` quando a leitura corresponde a um dado assentado, sem ambiguidade. */
export function isFlat(reading: FaceReading): boolean {
  return reading.alignment >= FLAT_ALIGNMENT_MIN;
}
