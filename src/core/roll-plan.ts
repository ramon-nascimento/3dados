import type { DieDefinition, DieFace, DieRegistry } from './die-definition';
import { parseEffectTriggers, type EffectTrigger } from './effect-trigger';
import { DiceError } from './errors';
import { randomInt, type RandomSource } from './random';
import type { DieId, DieType, DieValueSource, RollId, RollMetadata, RollRequest } from './types';

/**
 * Limite de dados físicos por rolagem (um d100 conta como dois). É o maior
 * valor medido em que os dados maiores (d12, d20) ainda convergem sempre na
 * área de referência; ver docs/BENCHMARKS.md. O valor definitivo sai dos
 * benchmarks da Etapa 9.
 */
export const MAX_DICE_PER_ROLL = 30;

/** Um dado físico de uma rolagem: um corpo na simulação e uma malha na tela. */
export interface PlannedDie {
  readonly dieId: DieId;
  /** Tipo do dado físico. Em dados compostos, o da parte (ex.: `d100:tens`). */
  readonly type: DieType;
  readonly definition: DieDefinition;
  /** Face que precisa terminar na posição de leitura. */
  readonly targetFace: DieFace;
}

/** Um dado pedido, com o resultado já decidido. Formado por um ou mais dados físicos. */
export interface PlannedResult {
  readonly dieId: DieId;
  /** Tipo pedido (ex.: `d100`). */
  readonly type: DieType;
  /** Valor oficial deste dado. */
  readonly value: number;
  readonly source: DieValueSource;
  /** Índices, em `RollPlan.dice`, dos dados físicos que o formam. */
  readonly parts: readonly number[];
  readonly role?: string;
  readonly theme?: string;
}

/** Pedido validado, com todos os valores fixados antes de qualquer animação. */
export interface RollPlan {
  readonly rollId: RollId;
  /** Dados físicos, na ordem em que são simulados. */
  readonly dice: readonly PlannedDie[];
  /** Dados pedidos, na ordem do pedido. */
  readonly results: readonly PlannedResult[];
  /** Semente da trajetória visual. */
  readonly seed: number;
  readonly metadata?: RollMetadata;
  /** Gatilhos de efeito validados, na ordem do pedido. */
  readonly effects: readonly EffectTrigger[];
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

/** Sorteia uma face (não um valor): correto mesmo em dados com valores repetidos. */
function randomFace(definition: DieDefinition, rng: RandomSource): DieFace {
  return definition.faces[randomInt(rng, definition.faces.length)]!;
}

function faceWithValue(
  definition: DieDefinition,
  value: unknown,
  rng: RandomSource,
): DieFace | undefined {
  const candidates = definition.faces.filter((face) => face.value === value);
  return candidates.length === 0 ? undefined : candidates[randomInt(rng, candidates.length)];
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

  const effects = parseEffectTriggers(raw.effects, (message, path) =>
    invalid(`${path}: ${message}`, { path }),
  );

  const rollId = raw.id ?? generateRollId(rng);
  const dice: PlannedDie[] = [];
  const results: PlannedResult[] = [];
  const usedIds = new Set<DieId>();

  const claimId = (dieId: unknown, index: number): DieId => {
    if (typeof dieId !== 'string' || dieId.length === 0) {
      throw invalid(`dice[${index}].ids precisa conter textos não vazios.`, { index });
    }
    if (usedIds.has(dieId)) {
      throw invalid(`Identificador de dado repetido: "${dieId}".`, { index, dieId });
    }
    usedIds.add(dieId);
    return dieId;
  };

  (raw.dice as unknown[]).forEach((spec, index) => {
    if (!isRecord(spec)) throw invalid(`dice[${index}] precisa ser um objeto.`, { index });
    if (typeof spec.type !== 'string') {
      throw invalid(`dice[${index}].type precisa ser um texto.`, { index });
    }
    const requestedType = spec.type;
    const registered = registry.resolve(requestedType);
    if (!registered) {
      throw new DiceError('UNKNOWN_DIE_TYPE', `Tipo de dado desconhecido: "${requestedType}".`, {
        details: { index, type: requestedType, known: registry.types() },
      });
    }
    const parts =
      registered.kind === 'single'
        ? [{ key: undefined, definition: registered.definition }]
        : registered.composite.parts;

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
    if (dice.length + count * parts.length > MAX_DICE_PER_ROLL) {
      throw invalid(`Uma rolagem aceita no máximo ${MAX_DICE_PER_ROLL} dados físicos.`, {
        max: MAX_DICE_PER_ROLL,
      });
    }
    const role = optionalString(spec.role, 'role', index);
    const theme = optionalString(spec.theme, 'theme', index);

    for (let i = 0; i < count; i++) {
      const dieId = claimId(ids ? ids[i] : `${rollId}:${results.length}`, index);
      const requested: unknown = values?.[i];
      const noSuchValue = () =>
        invalid(`O valor ${String(requested)} não existe em um ${requestedType}.`, {
          index,
          value: requested,
          type: requestedType,
        });

      let faces: DieFace[];
      if (!values) {
        faces = parts.map(({ definition }) => randomFace(definition, rng));
      } else if (registered.kind === 'single') {
        const face = faceWithValue(registered.definition, requested, rng);
        if (!face) throw noSuchValue();
        faces = [face];
      } else {
        const split =
          typeof requested === 'number' ? registered.composite.split(requested) : undefined;
        if (!split) throw noSuchValue();
        faces = parts.map(({ definition }, p) => {
          const face = faceWithValue(definition, split[p], rng);
          if (!face) throw noSuchValue();
          return face;
        });
      }

      const partIndices = parts.map(({ key, definition }, p) => {
        dice.push({
          dieId: key === undefined ? dieId : claimId(`${dieId}:${key}`, index),
          type: definition.type,
          definition,
          targetFace: faces[p]!,
        });
        return dice.length - 1;
      });
      const faceValues = faces.map((face) => face.value);
      results.push({
        dieId,
        type: requestedType,
        value:
          registered.kind === 'single' ? faceValues[0]! : registered.composite.combine(faceValues),
        source: values ? 'predetermined' : 'rng',
        parts: partIndices,
        ...(role === undefined ? {} : { role }),
        ...(theme === undefined ? {} : { theme }),
      });
    }
  });

  return {
    rollId,
    dice,
    results,
    seed: raw.seed === undefined ? rng.nextUint32() : raw.seed >>> 0,
    ...(raw.metadata === undefined ? {} : { metadata: raw.metadata }),
    effects,
  };
}
