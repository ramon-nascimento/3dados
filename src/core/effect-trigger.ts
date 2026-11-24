import type { DiceError } from './errors';
import type { DieId, DieType } from './types';

/**
 * Momento da rolagem em que um gatilho dispara.
 * - `start`: quando a animação começa.
 * - `settled`: quando o dado para (num dado composto, quando todas as partes param).
 * - `completed`: depois de o motor conferir o que está na tela.
 */
export type EffectMoment = 'start' | 'settled' | 'completed';

export const EFFECT_MOMENTS: readonly EffectMoment[] = ['start', 'settled', 'completed'];

/** Ajustes de um efeito. Todos opcionais; ausentes usam o padrão do efeito. */
export interface EffectOptions {
  /** Cor principal, `#rrggbb`. */
  color?: string;
  /** Duração, de 100 a 10.000 ms. */
  durationMs?: number;
  /** Intensidade, de 0 a 2. Multiplica a quantidade e o brilho das partículas. */
  intensity?: number;
}

/**
 * Condição de um gatilho. O motor só compara dados: não interpreta nenhum
 * valor. Os campos presentes se combinam com E; sem nenhum, vale para todos.
 */
export interface EffectCondition {
  /** Tipo pedido (`d20`, `d100`, um dado personalizado). */
  type?: DieType;
  /** `role` do `DieSpec`. */
  role?: string;
  /** Valores oficiais que disparam o efeito. No d100, o valor de 1 a 100. */
  values?: readonly number[];
  /** Identificadores de dado: o do dado pedido ou o de uma parte (`<id>:tens`). */
  dieIds?: readonly DieId[];
}

/** Gatilho declarado no pedido: "quando a condição valer, mostre este efeito". */
export interface EffectTrigger {
  /** Nome de um efeito interno ou registrado com `engine.effects.register`. */
  effect: string;
  /** Padrão: `settled`. */
  on?: EffectMoment;
  when?: EffectCondition;
  options?: EffectOptions;
}

/** Faixas aceitas nos ajustes de efeito e nos gatilhos. */
export const EFFECT_LIMITS = {
  nameLength: 64,
  durationMs: { min: 100, max: 10_000 },
  intensity: { min: 0, max: 2 },
  triggersPerRoll: 32,
  listLength: 64,
} as const;

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

type MakeError = (message: string, path: string) => DiceError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  fail: MakeError,
) {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw fail(`campo desconhecido "${key}".`, path === '' ? key : `${path}.${key}`);
    }
  }
}

function inRange(
  value: unknown,
  range: { min: number; max: number },
  path: string,
  fail: MakeError,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw fail(`esperado um número de ${range.min} a ${range.max}.`, path);
  }
  if (value < range.min || value > range.max) {
    throw fail(`esperado um número de ${range.min} a ${range.max}.`, path);
  }
  return value;
}

/** Nome de efeito: texto não vazio de até 64 caracteres. */
export function parseEffectName(value: unknown, path: string, fail: MakeError): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw fail('esperado um texto não vazio.', path);
  }
  if (value.length > EFFECT_LIMITS.nameLength) {
    throw fail(`no máximo ${EFFECT_LIMITS.nameLength} caracteres.`, path);
  }
  return value;
}

/** Valida e copia ajustes de efeito. `path` é o prefixo usado nas mensagens. */
export function parseEffectOptions(raw: unknown, path: string, fail: MakeError): EffectOptions {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw fail('esperado um objeto.', path);
  checkKeys(raw, ['color', 'durationMs', 'intensity'], path, fail);
  const at = (key: string) => (path === '' ? key : `${path}.${key}`);
  const options: EffectOptions = {};
  if (raw.color !== undefined) {
    if (typeof raw.color !== 'string' || !COLOR_PATTERN.test(raw.color)) {
      throw fail('esperada uma cor no formato "#rrggbb".', at('color'));
    }
    options.color = raw.color.toLowerCase();
  }
  if (raw.durationMs !== undefined) {
    options.durationMs = inRange(raw.durationMs, EFFECT_LIMITS.durationMs, at('durationMs'), fail);
  }
  if (raw.intensity !== undefined) {
    options.intensity = inRange(raw.intensity, EFFECT_LIMITS.intensity, at('intensity'), fail);
  }
  return options;
}

function stringList(value: unknown, path: string, fail: MakeError): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > EFFECT_LIMITS.listLength) {
    throw fail(`esperada uma lista de 1 a ${EFFECT_LIMITS.listLength} itens.`, path);
  }
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw fail('esperado um texto não vazio.', `${path}[${i}]`);
    }
    return item;
  });
}

function parseCondition(raw: unknown, path: string, fail: MakeError): EffectCondition {
  if (!isRecord(raw)) throw fail('esperado um objeto.', path);
  checkKeys(raw, ['type', 'role', 'values', 'dieIds'], path, fail);
  const condition: EffectCondition = {};
  for (const key of ['type', 'role'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.length === 0) {
      throw fail('esperado um texto não vazio.', `${path}.${key}`);
    }
    condition[key] = value;
  }
  if (raw.values !== undefined) {
    const values = raw.values;
    if (!Array.isArray(values) || values.length === 0 || values.length > EFFECT_LIMITS.listLength) {
      throw fail(
        `esperada uma lista de 1 a ${EFFECT_LIMITS.listLength} números.`,
        `${path}.values`,
      );
    }
    condition.values = values.map((value: unknown, i) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw fail('esperado um número.', `${path}.values[${i}]`);
      }
      return value;
    });
  }
  if (raw.dieIds !== undefined) condition.dieIds = stringList(raw.dieIds, `${path}.dieIds`, fail);
  return condition;
}

/**
 * Valida os gatilhos de um pedido de rolagem. O pedido pode vir da rede, então
 * nada é presumido sobre o formato. Um nome de efeito desconhecido não é erro
 * aqui: o motor avisa e ignora, para que um cliente sem o efeito ainda role.
 */
export function parseEffectTriggers(raw: unknown, fail: MakeError): EffectTrigger[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw fail('esperada uma lista.', 'effects');
  if (raw.length > EFFECT_LIMITS.triggersPerRoll) {
    throw fail(`no máximo ${EFFECT_LIMITS.triggersPerRoll} gatilhos.`, 'effects');
  }
  return raw.map((item: unknown, i) => {
    const path = `effects[${i}]`;
    if (!isRecord(item)) throw fail('esperado um objeto.', path);
    checkKeys(item, ['effect', 'on', 'when', 'options'], path, fail);
    const trigger: EffectTrigger = { effect: parseEffectName(item.effect, `${path}.effect`, fail) };
    if (item.on !== undefined) {
      if (!EFFECT_MOMENTS.includes(item.on as EffectMoment)) {
        throw fail(`esperado ${EFFECT_MOMENTS.map((m) => `"${m}"`).join(', ')}.`, `${path}.on`);
      }
      trigger.on = item.on as EffectMoment;
    }
    if (item.when !== undefined) trigger.when = parseCondition(item.when, `${path}.when`, fail);
    if (item.options !== undefined) {
      trigger.options = parseEffectOptions(item.options, `${path}.options`, fail);
    }
    return trigger;
  });
}
