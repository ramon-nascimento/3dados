import { describe, expect, it } from 'vitest';
import { DiceError } from '../../src/core/errors';
import {
  createCryptoRandomSource,
  createSeededRandomSource,
  randomFloat,
  randomInt,
  type RandomSource,
} from '../../src/core/random';
import { chiSquareCritical, chiSquareUniform, countOutcomes } from './helpers/statistics';

const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100];
const SAMPLES = 120_000;

function sequenceSource(values: readonly number[]): RandomSource & { consumed: number } {
  const source = {
    consumed: 0,
    nextUint32() {
      const value = values[source.consumed];
      if (value === undefined) throw new Error('sequência esgotada');
      source.consumed++;
      return value;
    },
  };
  return source;
}

describe('randomInt', () => {
  it.each(DIE_SIDES)('é uniforme para %i faces com a fonte criptográfica', (sides) => {
    const source = createCryptoRandomSource();
    const counts = countOutcomes(sides, SAMPLES, () => randomInt(source, sides));

    expect(counts.every((count) => count > 0)).toBe(true);
    expect(chiSquareUniform(counts)).toBeLessThan(chiSquareCritical(sides - 1));
  });

  it('o teste estatístico reprova um sorteio enviesado', () => {
    const source = createCryptoRandomSource();
    const biased = () => Math.min(randomInt(source, 6), randomInt(source, 6));
    const counts = countOutcomes(6, SAMPLES, biased);

    expect(chiSquareUniform(counts)).toBeGreaterThan(chiSquareCritical(5));
  });

  it('descarta valores na faixa que causaria viés de módulo', () => {
    // Para 3 faces, 2^32 % 3 = 1: apenas 0xFFFFFFFF fica fora do maior múltiplo de 3.
    const source = sequenceSource([0xffff_ffff, 0xffff_ffff, 5]);

    expect(randomInt(source, 3)).toBe(2);
    expect(source.consumed).toBe(3);
  });

  it('aceita o maior valor ainda dentro do limite', () => {
    const source = sequenceSource([0xffff_fffe]);

    expect(randomInt(source, 3)).toBe(0xffff_fffe % 3);
    expect(source.consumed).toBe(1);
  });

  it('retorna sempre 0 quando há uma única saída possível', () => {
    expect(randomInt(sequenceSource([123_456]), 1)).toBe(0);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32 + 1])(
    'rejeita maxExclusive inválido: %d',
    (maxExclusive) => {
      const call = () => randomInt(createSeededRandomSource(1), maxExclusive);

      expect(call).toThrow(DiceError);
      expect(call).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    },
  );
});

describe('createSeededRandomSource', () => {
  it('produz a mesma sequência para a mesma semente', () => {
    const a = createSeededRandomSource(42);
    const b = createSeededRandomSource(42);

    for (let i = 0; i < 100; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('produz sequências diferentes para sementes diferentes', () => {
    const a = createSeededRandomSource(1);
    const b = createSeededRandomSource(2);
    const first = Array.from({ length: 8 }, () => a.nextUint32());
    const second = Array.from({ length: 8 }, () => b.nextUint32());

    expect(first).not.toEqual(second);
  });

  it('gera inteiros de 32 bits sem sinal razoavelmente uniformes', () => {
    const source = createSeededRandomSource(2026);
    const counts = countOutcomes(20, SAMPLES, () => randomInt(source, 20));

    expect(chiSquareUniform(counts)).toBeLessThan(chiSquareCritical(19));
  });

  it('rejeita semente não finita', () => {
    expect(() => createSeededRandomSource(Number.NaN)).toThrow(DiceError);
  });
});

describe('randomFloat', () => {
  it('fica em [0, 1), inclusive nos extremos da fonte', () => {
    expect(randomFloat(sequenceSource([0]))).toBe(0);
    expect(randomFloat(sequenceSource([0xffff_ffff]))).toBeLessThan(1);
  });
});
