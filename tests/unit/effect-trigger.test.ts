import { describe, expect, it } from 'vitest';
import { createStandardRegistry } from '../../src/core/dice/standard';
import { isDiceError } from '../../src/core/errors';
import { createSeededRandomSource } from '../../src/core/random';
import { planRoll } from '../../src/core/roll-plan';
import type { RollRequest } from '../../src/core/types';
import { planEffectTriggers, type EffectSubject } from '../../src/effects/triggers';

const registry = createStandardRegistry();
const plan = (request: unknown) =>
  planRoll(request as RollRequest, registry, createSeededRandomSource(1));

function rejection(request: unknown): { code: string; message: string } {
  try {
    plan(request);
  } catch (error) {
    if (isDiceError(error)) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error('o pedido foi aceito');
}

describe('gatilhos de efeito no pedido', () => {
  it('são validados e copiados para o plano, na ordem', () => {
    const effects = [
      { effect: 'critical', on: 'settled', when: { type: 'd20', values: [20] } },
      { effect: 'highlight', when: { role: 'hope', dieIds: ['a'] }, options: { color: '#FFAA00' } },
      { effect: 'burst', on: 'completed', options: { durationMs: 900, intensity: 1.5 } },
    ];
    const result = plan({ dice: [{ type: 'd20' }], effects });
    expect(result.effects).toEqual([
      effects[0],
      { ...effects[1], options: { color: '#ffaa00' } },
      effects[2],
    ]);
  });

  it('sem `effects`, o plano tem uma lista vazia', () => {
    expect(plan({ dice: [{ type: 'd6' }] }).effects).toEqual([]);
  });

  it('não consomem o RNG: os valores são os mesmos com e sem gatilhos', () => {
    const dice = [{ type: 'd20', count: 5 }];
    const without = plan({ dice, seed: 3 });
    const withEffects = plan({
      dice,
      seed: 3,
      effects: [{ effect: 'critical', when: { values: [20] } }],
    });
    expect(withEffects.results.map((r) => r.value)).toEqual(without.results.map((r) => r.value));
    expect(withEffects.rollId).toBe(without.rollId);
  });

  it.each([
    ['lista', { effects: 'critical' }, /effects: esperada uma lista/],
    ['item', { effects: [1] }, /effects\[0\]: esperado um objeto/],
    ['nome', { effects: [{ effect: '' }] }, /effects\[0\]\.effect: esperado um texto/],
    ['nome longo', { effects: [{ effect: 'x'.repeat(65) }] }, /no máximo 64/],
    ['momento', { effects: [{ effect: 'glow', on: 'later' }] }, /effects\[0\]\.on: esperado/],
    [
      'campo extra',
      { effects: [{ effect: 'glow', at: 1 }] },
      /effects\[0\]\.at: campo desconhecido/,
    ],
    ['condição', { effects: [{ effect: 'glow', when: [] }] }, /when: esperado um objeto/],
    ['valores', { effects: [{ effect: 'glow', when: { values: [] } }] }, /when\.values: esperada/],
    ['valor', { effects: [{ effect: 'glow', when: { values: ['20'] } }] }, /values\[0\]/],
    ['dieIds', { effects: [{ effect: 'glow', when: { dieIds: [''] } }] }, /dieIds\[0\]/],
    ['role', { effects: [{ effect: 'glow', when: { role: 3 } }] }, /when\.role/],
    ['cor', { effects: [{ effect: 'glow', options: { color: 'red' } }] }, /options\.color/],
    ['duração', { effects: [{ effect: 'glow', options: { durationMs: 50 } }] }, /durationMs/],
    ['intensidade', { effects: [{ effect: 'glow', options: { intensity: 3 } }] }, /intensity/],
    ['opção extra', { effects: [{ effect: 'glow', options: { size: 2 } }] }, /options\.size/],
    ['muitos', { effects: Array(33).fill({ effect: 'glow' }) }, /no máximo 32 gatilhos/],
  ])('recusa %s inválido com INVALID_REQUEST', (_name, extra, message) => {
    const { code, message: text } = rejection({ dice: [{ type: 'd6' }], ...extra });
    expect(code).toBe('INVALID_REQUEST');
    expect(text).toMatch(message);
  });

  it('nome de efeito desconhecido não é erro de pedido', () => {
    expect(
      plan({ dice: [{ type: 'd6' }], effects: [{ effect: 'nao-existe' }] }).effects,
    ).toHaveLength(1);
  });
});

describe('planEffectTriggers', () => {
  const subjects: EffectSubject[] = [
    { dieId: 'a', type: 'd20', value: 20, role: 'attack', parts: ['a'] },
    { dieId: 'b', type: 'd20', value: 1, parts: ['b'] },
    { dieId: 'c', type: 'd100', value: 100, parts: ['c:tens', 'c:units'] },
    { dieId: 'h', type: 'd12', value: 7, role: 'hope', parts: ['h'] },
  ];
  const targets = (triggers: Parameters<typeof planEffectTriggers>[1]) =>
    planEffectTriggers(subjects, triggers).map(({ dieIds }) => dieIds);

  it('sem condição, vale para todos os dados, com `settled` como padrão', () => {
    const planned = planEffectTriggers(subjects, [{ effect: 'glow' }]);
    expect(planned.map((p) => p.subject)).toEqual(['a', 'b', 'c', 'h']);
    expect(planned.every((p) => p.on === 'settled')).toBe(true);
  });

  it('compara tipo, role e valor', () => {
    expect(targets([{ effect: 'x', when: { type: 'd20' } }])).toEqual([['a'], ['b']]);
    expect(targets([{ effect: 'x', when: { role: 'hope' } }])).toEqual([['h']]);
    expect(targets([{ effect: 'x', when: { values: [1, 7] } }])).toEqual([['b'], ['h']]);
    expect(targets([{ effect: 'x', when: { type: 'd20', values: [20] } }])).toEqual([['a']]);
    expect(targets([{ effect: 'x', when: { type: 'd20', role: 'attack', values: [1] } }])).toEqual(
      [],
    );
  });

  it('no d100 compara o valor lógico e alcança as duas partes', () => {
    expect(targets([{ effect: 'x', when: { type: 'd100', values: [100] } }])).toEqual([
      ['c:tens', 'c:units'],
    ]);
    // "10" seria a face das dezenas; o valor do dado é 100.
    expect(targets([{ effect: 'x', when: { type: 'd100', values: [10] } }])).toEqual([]);
  });

  it('dieIds aceita o dado pedido ou uma parte', () => {
    expect(targets([{ effect: 'x', when: { dieIds: ['c'] } }])).toEqual([['c:tens', 'c:units']]);
    expect(targets([{ effect: 'x', when: { dieIds: ['c:units', 'a'] } }])).toEqual([
      ['a'],
      ['c:units'],
    ]);
    expect(targets([{ effect: 'x', when: { dieIds: ['zz'] } }])).toEqual([]);
  });

  it('preserva momento, opções e ordem dos gatilhos', () => {
    const planned = planEffectTriggers(subjects, [
      { effect: 'one', on: 'start', when: { dieIds: ['a'] } },
      { effect: 'two', on: 'completed', when: { dieIds: ['b'] }, options: { color: '#ff0000' } },
    ]);
    expect(planned).toEqual([
      { effect: 'one', on: 'start', options: {}, dieIds: ['a'], subject: 'a' },
      {
        effect: 'two',
        on: 'completed',
        options: { color: '#ff0000' },
        dieIds: ['b'],
        subject: 'b',
      },
    ]);
  });
});
