import type { DieDefinition, DieFace, DieRegistry } from './die-definition';
import { DiceError } from './errors';
import { randomInt, type RandomSource } from './random';
import type { DieId, DieType, DieValueSource, RollId, RollMetadata, RollRequest } from './types';

/**
 * Limite de segurança de dados por rolagem. É provisório: o valor definitivo
 * sai dos benchmarks da Etapa 9.
 */
export const MAX_DICE_PER_ROLL = 30;

/** Um dado de uma rolagem, com o resultado já decidido. */
export interface PlannedDie {
  readonly dieId: DieId;
  readonly type: DieType;
  readonly definition: DieDefinition;
  /** Face que precisa terminar na posição de leitura. */
  readonly targetFace: DieFace;
  readonly source: DieValueSource;
  readonly role?: string;
  readonly theme?: string;
}

/** Pedido validado, com todos os valores fixados antes de qualquer animação. */
export interface RollPlan {
  readonly rollId: RollId;
  readonly dice: readonly PlannedDie[];
  /** Semente da trajetória visual. */
  readonly seed: number;
  readonly metadata?: RollMetadata;
}

function invalid(message: string, details?: Record<string, unknown>): DiceError {
  return new DiceError('INVALID_REQUEST', message, details ? { details } : {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string, index: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`dice[${index}].${field} precisa ser um texto não vazio.`, { index, field });
  }
  return value;
}

export function generateRollId(rng: RandomSource): RollId {
  const part = () => rng.nextUint32().toString(16).padStart(8, '0');
  return `roll-${part()}${part()}`;
}

/**
 * Valida um pedido e decide o valor de cada dado: usa os valores fornecidos
 * (modo controlado) ou sorteia uma face (modo autônomo). O pedido pode vir de
 * JavaScript sem tipos ou da rede, então nada é presumido sobre o formato.
 */
export function planRoll(request: RollRequest, registry: DieRegistry, rng: RandomSource): RollPlan {
  const raw: unknown = request;
  if (!isRecord(raw)) throw invalid('O pedido de rolagem precisa ser um objeto.');
  if (!Array.isArray(raw.dice) || raw.dice.length === 0) {
    throw invalid('O pedido precisa de ao menos um grupo de dados em "dice".');
  }
  if (raw.id !== undefined && (typeof raw.id !== 'string' || raw.id.length === 0)) {
    throw invalid('"id" precisa ser um texto não vazio.');
  }
  if (raw.seed !== undefined && (typeof raw.seed !== 'number' || !Number.isFinite(raw.seed))) {
    throw invalid('"seed" precisa ser um número finito.');
  }
  if (raw.metadata !== undefined && !isRecord(raw.metadata)) {
    throw invalid('"metadata" precisa ser um objeto.');
  }

  const rollId = raw.id ?? generateRollId(rng);
  const dice: PlannedDie[] = [];
  const usedIds = new Set<DieId>();

  (raw.dice as unknown[]).forEach((spec, index) => {
    if (!isRecord(spec)) throw invalid(`dice[${index}] precisa ser um objeto.`, { index });
    if (typeof spec.type !== 'string') {
      throw invalid(`dice[${index}].type precisa ser um texto.`, { index });
    }
    const definition = registry.get(spec.type);
    if (!definition) {
      throw new DiceError('UNKNOWN_DIE_TYPE', `Tipo de dado desconhecido: "${spec.type}".`, {
        details: { index, type: spec.type, known: registry.types() },
      });
    }

    const { values, ids } = spec;
    if (values !== undefined && !Array.isArray(values)) {
      throw invalid(`dice[${index}].values precisa ser uma lista.`, { index });
    }
    if (ids !== undefined && !Array.isArray(ids)) {
      throw invalid(`dice[${index}].ids precisa ser uma lista.`, { index });
    }
    const count = spec.count ?? values?.length ?? ids?.length ?? 1;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      throw invalid(`dice[${index}].count precisa ser um inteiro maior que zero.`, {
        index,
        count,
      });
    }
    if (values && values.length !== count) {
      throw invalid(`dice[${index}].values precisa ter um valor por dado (${count}).`, {
        index,
        count,
        received: values.length,
      });
    }
    if (ids && ids.length !== count) {
      throw invalid(`dice[${index}].ids precisa ter um identificador por dado (${count}).`, {
        index,
        count,
        received: ids.length,
      });
    }
    if (dice.length + count > MAX_DICE_PER_ROLL) {
      throw invalid(`Uma rolagem aceita no máximo ${MAX_DICE_PER_ROLL} dados.`, {
        max: MAX_DICE_PER_ROLL,
      });
    }
    const role = optionalString(spec.role, 'role', index);
    const theme = optionalString(spec.theme, 'theme', index);

    for (let i = 0; i < count; i++) {
      const dieId: unknown = ids ? ids[i] : `${rollId}:${dice.length}`;
      if (typeof dieId !== 'string' || dieId.length === 0) {
        throw invalid(`dice[${index}].ids[${i}] precisa ser um texto não vazio.`, { index });
      }
      if (usedIds.has(dieId)) {
        throw invalid(`Identificador de dado repetido: "${dieId}".`, { index, dieId });
      }
      usedIds.add(dieId);

      let targetFace: DieFace;
      let source: DieValueSource;
      if (values) {
        const value: unknown = values[i];
        const candidates = definition.faces.filter((face) => face.value === value);
        if (candidates.length === 0) {
          throw invalid(`O valor ${String(value)} não existe em um ${definition.type}.`, {
            index,
            value,
            type: definition.type,
          });
        }
        targetFace = candidates[randomInt(rng, candidates.length)]!;
        source = 'predetermined';
      } else {
        // Sorteia uma face (não um valor): correto mesmo em dados com valores repetidos.
        targetFace = definition.faces[randomInt(rng, definition.faces.length)]!;
        source = 'rng';
      }

      dice.push({
        dieId,
        type: definition.type,
        definition,
        targetFace,
        source,
        ...(role === undefined ? {} : { role }),
        ...(theme === undefined ? {} : { theme }),
      });
    }
  });

  return {
    rollId,
    dice,
    seed: raw.seed === undefined ? rng.nextUint32() : raw.seed >>> 0,
    ...(raw.metadata === undefined ? {} : { metadata: raw.metadata }),
  };
}
