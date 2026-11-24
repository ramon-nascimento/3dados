import { describe, expect, it } from 'vitest';
import { DiceError, isDiceError } from '../../src/core/errors';

describe('DiceError', () => {
  it('carrega código, mensagem, detalhes e causa', () => {
    const cause = new Error('origem');
    const error = new DiceError('INVALID_REQUEST', 'pedido inválido', {
      cause,
      details: { field: 'dice' },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('DiceError');
    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.message).toBe('pedido inválido');
    expect(error.details).toEqual({ field: 'dice' });
    expect(error.cause).toBe(cause);
  });

  it('isDiceError distingue erros da biblioteca de outros valores', () => {
    expect(isDiceError(new DiceError('RESULT_MISMATCH', 'x'))).toBe(true);
    expect(isDiceError(new Error('x'))).toBe(false);
    expect(isDiceError({ code: 'RESULT_MISMATCH' })).toBe(false);
  });
});
