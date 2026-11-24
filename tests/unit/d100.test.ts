import { describe, expect, it } from 'vitest';
import { D100 } from '../../src/core/dice/d10';
import { createStandardRegistry } from '../../src/core/dice/standard';
import { createCryptoRandomSource, createSeededRandomSource } from '../../src/core/random';
import { MAX_DICE_PER_ROLL, planRoll } from '../../src/core/roll-plan';
import { chiSquareCritical, chiSquareUniform } from './helpers/statistics';

const registry = createStandardRegistry();
const rng = () => createSeededRandomSource(3);

describe('d100 como dado composto', () => {
  it('decompõe e recompõe todos os valores de 1 a 100', () => {
    for (let value = 1; value <= 100; value++) {
      const parts = D100.split(value)!;

      expect(parts).toHaveLength(2);
      expect(parts[0]! % 10).toBe(0);
      expect(parts[0]).toBeGreaterThanOrEqual(0);
      expect(parts[0]).toBeLessThanOrEqual(90);
      expect(parts[1]).toBeGreaterThanOrEqual(0);
      expect(parts[1]).toBeLessThanOrEqual(9);
      expect(D100.combine(parts)).toBe(value);
    }
  });

  it('as 100 combinações de dezena e unidade produzem cada valor exatamente uma vez', () => {
    const seen = new Map<number, number>();
    for (let tens = 0; tens <= 90; tens += 10) {
      for (let units = 0; units <= 9; units++) {
        const value = D100.combine([tens, units]);
        seen.set(value, (seen.get(value) ?? 0) + 1);
      }
    }

    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it('"00" com "0" vale 100', () => {
    expect(D100.combine([0, 0])).toBe(100);
    expect(D100.split(100)).toEqual([0, 0]);
  });

  it.each([0, 101, -5, 1.5, Number.NaN])('não decompõe o valor inválido %d', (value) => {
    expect(D100.split(value)).toBeUndefined();
  });
});

describe('planRoll com d100', () => {
  it('modo controlado: fixa a dezena e a unidade de cada valor de 1 a 100', () => {
    for (let value = 1; value <= 100; value++) {
      const plan = planRoll(
        { id: 'r', dice: [{ type: 'd100', values: [value] }] },
        registry,
        rng(),
      );

      expect(plan.results).toHaveLength(1);
      expect(plan.results[0]).toMatchObject({ dieId: 'r:0', type: 'd100', value, parts: [0, 1] });
      expect(plan.dice.map((die) => die.type)).toEqual(['d100:tens', 'd100:units']);
      expect(plan.dice.map((die) => die.dieId)).toEqual(['r:0:tens', 'r:0:units']);
      const [tens, units] = plan.dice.map((die) => die.targetFace.value);
      expect(tens! + units! || 100).toBe(value);
    }
  });

  it('modo autônomo: os valores de 1 a 100 são uniformes', () => {
    const source = createCryptoRandomSource();
    const counts = new Array<number>(100).fill(0);
    for (let i = 0; i < 4_000; i++) {
      const plan = planRoll({ id: 'r', dice: [{ type: 'd100', count: 15 }] }, registry, source);
      for (const result of plan.results) counts[result.value - 1]!++;
    }

    expect(counts.every((count) => count > 0)).toBe(true);
    expect(chiSquareUniform(counts)).toBeLessThan(chiSquareCritical(99));
  });

  it('usa identificadores fornecidos para o dado e deriva os das partes', () => {
    const plan = planRoll({ dice: [{ type: 'd100', ids: ['pct'] }] }, registry, rng());

    expect(plan.results[0]!.dieId).toBe('pct');
    expect(plan.dice.map((die) => die.dieId)).toEqual(['pct:tens', 'pct:units']);
  });

  it('mistura d100 com outros dados mantendo a ordem do pedido', () => {
    const plan = planRoll(
      {
        id: 'r',
        dice: [{ type: 'd20' }, { type: 'd100', values: [57] }, { type: 'd6', count: 2 }],
      },
      registry,
      rng(),
    );

    expect(plan.results.map((result) => [result.dieId, result.type, result.parts])).toEqual([
      ['r:0', 'd20', [0]],
      ['r:1', 'd100', [1, 2]],
      ['r:2', 'd6', [3]],
      ['r:3', 'd6', [4]],
    ]);
    expect(plan.dice.map((die) => die.dieId)).toEqual([
      'r:0',
      'r:1:tens',
      'r:1:units',
      'r:2',
      'r:3',
    ]);
  });

  it('o limite conta dados físicos: cada d100 vale por dois', () => {
    const plan = (count: number) => planRoll({ dice: [{ type: 'd100', count }] }, registry, rng());

    expect(plan(MAX_DICE_PER_ROLL / 2).dice).toHaveLength(MAX_DICE_PER_ROLL);
    expect(() => plan(MAX_DICE_PER_ROLL / 2 + 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });

  it.each([0, 101, 12.5])('rejeita o valor %d', (value) => {
    expect(() => planRoll({ dice: [{ type: 'd100', values: [value] }] }, registry, rng())).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });

  it('o d10 sozinho aceita 10 e rejeita 0', () => {
    const ten = planRoll({ dice: [{ type: 'd10', values: [10] }] }, registry, rng());

    expect(ten.dice[0]!.targetFace.id).toBe('0');
    expect(ten.results[0]!.value).toBe(10);
    expect(() => planRoll({ dice: [{ type: 'd10', values: [0] }] }, registry, rng())).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' }),
    );
  });

  it('as partes do d100 não podem ser pedidas diretamente', () => {
    expect(() => planRoll({ dice: [{ type: 'd100:tens' }] }, registry, rng())).toThrow(
      expect.objectContaining({ code: 'UNKNOWN_DIE_TYPE' }),
    );
  });
});
