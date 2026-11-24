import { DiceError } from './errors';

/** Fonte de inteiros uniformes de 32 bits sem sinal. */
export interface RandomSource {
  /** Inteiro uniforme em [0, 2^32). */
  nextUint32(): number;
}

const UINT32_RANGE = 0x1_0000_0000;

/**
 * Fonte criptográfica (`crypto.getRandomValues`). É a fonte padrão dos
 * valores no modo autônomo. Funciona em navegadores, Workers e Node.
 */
export function createCryptoRandomSource(): RandomSource {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoApi?.getRandomValues !== 'function') {
    throw new DiceError(
      'UNSUPPORTED_ENVIRONMENT',
      'crypto.getRandomValues não está disponível neste ambiente.',
    );
  }
  const buffer = new Uint32Array(64);
  let index = buffer.length;
  return {
    nextUint32() {
      if (index >= buffer.length) {
        cryptoApi.getRandomValues(buffer);
        index = 0;
      }
      return buffer[index++]!;
    },
  };
}

/**
 * Fonte determinística (mulberry32) para trajetórias visuais e testes.
 * Não é criptográfica: não deve ser usada como fonte de valores oficiais.
 */
export function createSeededRandomSource(seed: number): RandomSource {
  if (!Number.isFinite(seed)) {
    throw new DiceError('INVALID_ARGUMENT', 'A semente precisa ser um número finito.', {
      details: { seed },
    });
  }
  let state = seed >>> 0;
  return {
    nextUint32() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}

/**
 * Inteiro uniforme em [0, maxExclusive). Usa amostragem por rejeição para
 * eliminar o viés de módulo: toda saída tem exatamente a mesma probabilidade.
 */
export function randomInt(source: RandomSource, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new DiceError('INVALID_ARGUMENT', 'maxExclusive precisa ser um inteiro entre 1 e 2^32.', {
      details: { maxExclusive },
    });
  }
  // Maior múltiplo de maxExclusive que cabe em 2^32; valores acima são descartados.
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let value = source.nextUint32();
  while (value >= limit) {
    value = source.nextUint32();
  }
  return value % maxExclusive;
}

/** Número uniforme em [0, 1) com 32 bits de resolução. */
export function randomFloat(source: RandomSource): number {
  return source.nextUint32() / UINT32_RANGE;
}
