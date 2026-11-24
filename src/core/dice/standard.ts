import { DieRegistry, type CompositeDie, type DieDefinition } from '../die-definition';
import { D10, D100, D100_TENS, D100_UNITS } from './d10';
import { D6 } from './d6';
import { D12, D20, D4, D8 } from './platonic';

/** Dados poliédricos que o motor conhece de fábrica. */
export const STANDARD_DICE: readonly DieDefinition[] = [D4, D6, D8, D10, D12, D20];

/** Dados físicos que só existem como parte de um dado composto. */
export const COMPOSITE_PART_DICE: readonly DieDefinition[] = [D100_TENS, D100_UNITS];

export const STANDARD_COMPOSITE_DICE: readonly CompositeDie[] = [D100];

export function createStandardRegistry(): DieRegistry {
  return new DieRegistry(STANDARD_DICE, STANDARD_COMPOSITE_DICE);
}
