import type { EffectMoment, EffectOptions, EffectTrigger } from '../core/effect-trigger';
import type { DieId, DieType } from '../core/types';

/** Um dado pedido, já com o valor decidido, como os gatilhos o enxergam. */
export interface EffectSubject {
  dieId: DieId;
  type: DieType;
  value: number;
  role?: string;
  /** Dados físicos que o formam (dois no d100). */
  parts: readonly DieId[];
}

/** Um efeito a mostrar em um momento da rolagem, já com os dados físicos de destino. */
export interface PlannedEffect {
  effect: string;
  on: EffectMoment;
  options: EffectOptions;
  /** Dados físicos que recebem o efeito. */
  dieIds: readonly DieId[];
  /** Dado pedido que satisfez a condição. */
  subject: DieId;
}

/**
 * Decide, antes da animação, quais efeitos cada dado vai receber. É uma
 * comparação de dados e nada mais: tipo, `role`, valor oficial e
 * identificador. O motor não sabe o que é um crítico; quem declara a condição
 * é a aplicação. Roda depois de os valores estarem fixados e não os altera.
 */
export function planEffectTriggers(
  subjects: readonly EffectSubject[],
  triggers: readonly EffectTrigger[],
): PlannedEffect[] {
  const planned: PlannedEffect[] = [];
  for (const trigger of triggers) {
    const { when = {} } = trigger;
    for (const subject of subjects) {
      if (when.type !== undefined && when.type !== subject.type) continue;
      if (when.role !== undefined && when.role !== subject.role) continue;
      if (when.values !== undefined && !when.values.includes(subject.value)) continue;
      let dieIds: readonly DieId[] = subject.parts;
      if (when.dieIds !== undefined) {
        // O identificador do dado pedido vale para todas as partes; o de uma
        // parte, só para ela.
        if (!when.dieIds.includes(subject.dieId)) {
          dieIds = subject.parts.filter((part) => when.dieIds!.includes(part));
          if (dieIds.length === 0) continue;
        }
      }
      planned.push({
        effect: trigger.effect,
        on: trigger.on ?? 'settled',
        options: { ...trigger.options },
        dieIds,
        subject: subject.dieId,
      });
    }
  }
  return planned;
}
