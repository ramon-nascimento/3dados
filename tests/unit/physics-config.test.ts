import { describe, expect, it } from 'vitest';
import { isDiceError } from '../../src/core/errors';
import {
  DEFAULT_PHYSICS_CONFIG,
  PHYSICS_LIMITS,
  parsePhysicsConfig,
  type PhysicsConfig,
} from '../../src/physics/config';

const KEYS = Object.keys(DEFAULT_PHYSICS_CONFIG) as (keyof PhysicsConfig)[];

function failure(value: unknown, path?: string) {
  try {
    parsePhysicsConfig(value, path);
  } catch (error) {
    if (isDiceError(error)) return { code: error.code, message: error.message, ...error.details };
    throw error;
  }
  throw new Error('deveria ter falhado');
}

describe('parsePhysicsConfig', () => {
  it('há um limite para cada parâmetro, e o padrão está dentro dele', () => {
    expect(Object.keys(PHYSICS_LIMITS).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const { min, max, integer } = PHYSICS_LIMITS[key];
      const value = DEFAULT_PHYSICS_CONFIG[key];
      expect(value, key).toBeGreaterThanOrEqual(min);
      expect(value, key).toBeLessThanOrEqual(max);
      if (integer) expect(Number.isInteger(value), key).toBe(true);
    }
    expect(parsePhysicsConfig(DEFAULT_PHYSICS_CONFIG)).toEqual(DEFAULT_PHYSICS_CONFIG);
  });

  it('aceita ajustes parciais e os extremos de cada faixa', () => {
    expect(parsePhysicsConfig(undefined)).toEqual({});
    expect(parsePhysicsConfig({})).toEqual({});
    expect(parsePhysicsConfig({ gravity: 90, maxNudges: 0 })).toEqual({
      gravity: 90,
      maxNudges: 0,
    });
    for (const key of KEYS) {
      const { min, max } = PHYSICS_LIMITS[key];
      expect(parsePhysicsConfig({ [key]: min })).toEqual({ [key]: min });
      expect(parsePhysicsConfig({ [key]: max })).toEqual({ [key]: max });
    }
  });

  it('campo `undefined` fica de fora, para não apagar o valor em vigor', () => {
    const parsed = parsePhysicsConfig({ gravity: undefined, friction: 0.5 });
    expect(parsed).toEqual({ friction: 0.5 });
    expect('gravity' in parsed).toBe(false);
  });

  it.each(KEYS)('%s fora da faixa é recusado com o caminho do campo', (key) => {
    const { min, max } = PHYSICS_LIMITS[key];
    for (const value of [min - 1, max + 1, Number.NaN, Infinity, '3', null]) {
      expect(failure({ [key]: value })).toMatchObject({
        code: 'INVALID_ARGUMENT',
        path: `physics.${key}`,
        received: value,
      });
    }
  });

  it('contagens precisam ser inteiras', () => {
    expect(failure({ maxAttempts: 2.5 })).toMatchObject({
      path: 'physics.maxAttempts',
      message: 'physics.maxAttempts: esperado um inteiro de 1 a 100.',
    });
    expect(failure({ gravity: 5000 }).message).toBe(
      'physics.gravity: esperado um número de 1 a 2000.',
    );
  });

  it('recusa campo desconhecido e valor que não é objeto', () => {
    expect(failure({ gravidade: 10 })).toMatchObject({
      code: 'INVALID_ARGUMENT',
      path: 'physics.gravidade',
      message: 'physics.gravidade: campo desconhecido.',
    });
    for (const value of [null, 3, 'x', [1]]) {
      expect(failure(value)).toMatchObject({ code: 'INVALID_ARGUMENT', path: 'physics' });
    }
    expect(failure({ gravity: -1 }, 'config')).toMatchObject({ path: 'config.gravity' });
  });
});
