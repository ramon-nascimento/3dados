import { describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { DieRegistry } from '../../src/core/die-definition';
import { createCryptoRandomSource, createSeededRandomSource } from '../../src/core/random';
import { MAX_DICE_PER_ROLL, planRoll } from '../../src/core/roll-plan';
import type { RollRequest } from '../../src/core/types';
import { chiSquareCritical, chiSquareUniform } from './helpers/statistics';

const registry = new DieRegistry([D6]);
const rng = () => createSeededRandomSource(7);

function errorOf(request: unknown): { code?: string; message?: string } {
  try {
    planRoll(request as RollRequest, registry, rng());
  } catch (error) {
    return error as { code: string; message: string };
  }
  return {};
}

describe('planRoll', () => {
  it('expande grupos em dados individuais com identificadores únicos', () => {
    const plan = planRoll(
      { id: 'r1', dice: [{ type: 'd6', count: 3 }, { type: 'd6' }] },
      registry,
      rng(),
    );

    expect(plan.rollId).toBe('r1');
    expect(plan.dice.map((die) => die.dieId)).toEqual(['r1:0', 'r1:1', 'r1:2', 'r1:3']);
    expect(plan.dice.every((die) => die.source === 'rng')).toBe(true);
    expect(plan.dice.every((die) => die.targetFace.value >= 1 && die.targetFace.value <= 6)).toBe(
      true,
    );
  });

  it('usa os valores fornecidos no modo controlado', () => {
    const plan = planRoll({ dice: [{ type: 'd6', values: [6, 1, 3] }] }, registry, rng());

    expect(plan.dice.map((die) => die.targetFace.value)).toEqual([6, 1, 3]);
    expect(plan.dice.every((die) => die.source === 'predetermined')).toBe(true);
  });

  it('preserva ids, role, theme e metadata', () => {
    const plan = planRoll(
      {
        dice: [{ type: 'd6', ids: ['a', 'b'], role: 'damage', theme: 'gold' }],
        metadata: { playerId: 'p1', custom: 42 },
      },
      registry,
      rng(),
    );

    expect(plan.dice.map((die) => die.dieId)).toEqual(['a', 'b']);
    expect(plan.dice[0]).toMatchObject({ role: 'damage', theme: 'gold' });
    expect(plan.metadata).toEqual({ playerId: 'p1', custom: 42 });
  });

  it('gera identificador de rolagem e semente quando omitidos', () => {
    const a = planRoll({ dice: [{ type: 'd6' }] }, registry, createSeededRandomSource(1));
    const b = planRoll({ dice: [{ type: 'd6' }] }, registry, createSeededRandomSource(2));

    expect(a.rollId).toMatch(/^roll-[0-9a-f]{16}$/);
    expect(a.rollId).not.toBe(b.rollId);
    expect(a.seed).not.toBe(b.seed);
  });

  it('a semente fornecida não altera os valores sorteados', () => {
    const values = (seed: number) =>
      planRoll({ dice: [{ type: 'd6', count: 10 }], seed }, registry, rng()).dice.map(
        (die) => die.targetFace.value,
      );

    expect(values(1)).toEqual(values(999));
    expect(planRoll({ dice: [{ type: 'd6' }], seed: 123 }, registry, rng()).seed).toBe(123);
  });

  it('sorteia as faces do d6 de forma uniforme', () => {
    const source = createCryptoRandomSource();
    const counts = new Array<number>(6).fill(0);
    for (let i = 0; i < 2_000; i++) {
      const plan = planRoll(
        { id: 'r', dice: [{ type: 'd6', count: MAX_DICE_PER_ROLL }] },
        registry,
        source,
      );
      for (const die of plan.dice) counts[die.targetFace.value - 1]!++;
    }

    expect(chiSquareUniform(counts)).toBeLessThan(chiSquareCritical(5));
  });

  it.each([
    ['pedido que não é objeto', null],
    ['sem dados', { dice: [] }],
    ['dice que não é lista', { dice: 'd6' }],
    ['grupo que não é objeto', { dice: ['d6'] }],
    ['tipo que não é texto', { dice: [{ type: 6 }] }],
    ['count zero', { dice: [{ type: 'd6', count: 0 }] }],
    ['count fracionário', { dice: [{ type: 'd6', count: 1.5 }] }],
    ['values com tamanho diferente de count', { dice: [{ type: 'd6', count: 2, values: [1] }] }],
    ['valor inexistente no dado', { dice: [{ type: 'd6', values: [7] }] }],
    ['valor que não é número', { dice: [{ type: 'd6', values: ['6'] }] }],
    ['ids com tamanho diferente de count', { dice: [{ type: 'd6', count: 2, ids: ['a'] }] }],
    ['ids repetidos', { dice: [{ type: 'd6', ids: ['a', 'a'] }] }],
    [
      'ids repetidos entre grupos',
      {
        dice: [
          { type: 'd6', ids: ['a'] },
          { type: 'd6', ids: ['a'] },
        ],
      },
    ],
    ['id de dado vazio', { dice: [{ type: 'd6', ids: [''] }] }],
    ['role vazio', { dice: [{ type: 'd6', role: '' }] }],
    ['id de rolagem vazio', { id: '', dice: [{ type: 'd6' }] }],
    ['seed não finita', { seed: Number.NaN, dice: [{ type: 'd6' }] }],
    ['metadata que não é objeto', { metadata: 'x', dice: [{ type: 'd6' }] }],
    ['dados demais', { dice: [{ type: 'd6', count: MAX_DICE_PER_ROLL + 1 }] }],
  ])('rejeita %s', (_name, request) => {
    expect(errorOf(request).code).toBe('INVALID_REQUEST');
  });

  it('rejeita tipo de dado desconhecido com código próprio', () => {
    expect(errorOf({ dice: [{ type: 'd7' }] }).code).toBe('UNKNOWN_DIE_TYPE');
  });
});
