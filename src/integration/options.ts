import { DiceError } from '../core/errors';

/**
 * O que acontece quando uma rolagem chega com outra em andamento.
 * - `queue` (padrão): espera a vez. Os dados da rolagem concluída ficam
 *   visíveis por `queue.holdMs` antes de a próxima começar.
 * - `replace`: cancela a anterior (`superseded`) e começa na hora.
 */
export type RollConcurrency = 'queue' | 'replace';

export const ROLL_CONCURRENCY: readonly RollConcurrency[] = ['queue', 'replace'];

export interface RollQueueOptions {
  /**
   * Rolagens esperando a vez, sem contar a que está na mesa. Passando disso,
   * a mais antiga da fila é cancelada (`superseded`). Padrão: 8, de 1 a 64.
   */
  maxPending?: number;
  /**
   * Tempo mínimo, em ms, em que os dados de uma rolagem concluída ficam na
   * mesa antes de a próxima da fila começar. Padrão: 1500, de 0 a 10.000.
   */
  holdMs?: number;
}

export interface RemoteOptions {
  /**
   * Descarta mensagens com `sentAt` mais velho que isto, em ms, pelo relógio
   * local (`Date.now()`). Padrão: sem limite. Relógios de máquinas diferentes
   * divergem; use só se a aplicação alinhar o relógio com o do servidor.
   */
  maxAgeMs?: number;
}

export interface ParsedRollOptions {
  concurrency: RollConcurrency;
  maxPending: number;
  holdMs: number;
  maxAgeMs: number | undefined;
}

export const ROLL_QUEUE_LIMITS = {
  maxPending: { min: 1, max: 64, default: 8 },
  holdMs: { min: 0, max: 10_000, default: 1500 },
} as const;

function invalidArgument(message: string, path: string, received: unknown): DiceError {
  return new DiceError('INVALID_ARGUMENT', `${path}: ${message}`, { details: { path, received } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberIn(
  value: unknown,
  path: string,
  { min, max }: { min: number; max: number },
  integer: boolean,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    throw invalidArgument(
      `esperado um ${integer ? 'inteiro' : 'número'} de ${min} a ${max}.`,
      path,
      value,
    );
  }
  return value;
}

/** Valida `concurrency`, `queue` e `remote` das opções do motor. */
export function parseRollOptions(options: {
  concurrency?: unknown;
  queue?: unknown;
  remote?: unknown;
}): ParsedRollOptions {
  const concurrency = options.concurrency ?? 'queue';
  if (!(ROLL_CONCURRENCY as readonly unknown[]).includes(concurrency)) {
    throw invalidArgument('esperado "queue" ou "replace".', 'concurrency', concurrency);
  }
  const queue = options.queue ?? {};
  if (!isRecord(queue)) throw invalidArgument('esperado um objeto.', 'queue', queue);
  const remote = options.remote ?? {};
  if (!isRecord(remote)) throw invalidArgument('esperado um objeto.', 'remote', remote);
  for (const [path, value, known] of [
    ['queue', queue, ['maxPending', 'holdMs']],
    ['remote', remote, ['maxAgeMs']],
  ] as const) {
    for (const key of Object.keys(value)) {
      if (!(known as readonly string[]).includes(key)) {
        throw invalidArgument('campo desconhecido.', `${path}.${key}`, value[key]);
      }
    }
  }
  const { maxPending, holdMs } = ROLL_QUEUE_LIMITS;
  return {
    concurrency: concurrency as RollConcurrency,
    maxPending:
      queue.maxPending === undefined
        ? maxPending.default
        : numberIn(queue.maxPending, 'queue.maxPending', maxPending, true),
    holdMs:
      queue.holdMs === undefined
        ? holdMs.default
        : numberIn(queue.holdMs, 'queue.holdMs', holdMs, false),
    maxAgeMs:
      remote.maxAgeMs === undefined
        ? undefined
        : numberIn(remote.maxAgeMs, 'remote.maxAgeMs', { min: 0, max: Number.MAX_VALUE }, false),
  };
}
