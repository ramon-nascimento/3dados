import type { EffectTrigger } from './effect-trigger';
import { DiceError } from './errors';
import type { DieSpec, RollId, RollVisibility } from './types';

/**
 * Protocolo de mensagens vindas de um servidor externo (multiplayer). O
 * servidor é a autoridade dos resultados, das permissões e do histórico; o
 * motor só decide o que fazer com cada mensagem que chega: aplicar, descartar
 * como repetida ou obsoleta, ou recusar. Nada aqui depende de DOM ou de rede.
 */

/** Versão do protocolo que este motor entende. */
export const PROTOCOL_VERSION = 1;

export type RemoteMessageType = 'roll.requested' | 'roll.cancelled' | 'table.cleared';

export const REMOTE_MESSAGE_TYPES: readonly RemoteMessageType[] = [
  'roll.requested',
  'roll.cancelled',
  'table.cleared',
];

export const ROLL_VISIBILITIES: readonly RollVisibility[] = ['public', 'private', 'blind'];

/** Campos comuns a toda mensagem. */
export interface RemoteEnvelopeBase {
  protocolVersion: typeof PROTOCOL_VERSION;
  roomId: string;
  /** Quem originou a mensagem. */
  playerId: string;
  /**
   * Ordem da mensagem na sala, atribuída pelo servidor: inteiro, crescente.
   * Buracos são normais (um cliente não recebe as rolagens privadas dos outros).
   */
  sequence: number;
  /** Instante de envio no relógio do servidor, em ms desde a época. */
  sentAt: number;
}

/** O que o servidor manda para uma rolagem: os dados com os valores oficiais. */
export interface RemoteRollPayload {
  /** Todo grupo precisa de `values`: em multiplayer, o valor vem do servidor. */
  dice: readonly DieSpec[];
  /** Semente da trajetória. Na mesma máquina, a mesma semente dá a mesma animação. */
  seed?: number;
  effects?: readonly EffectTrigger[];
  /** Dados livres da aplicação, devolvidos em `metadata` nos eventos. */
  metadata?: Readonly<Record<string, unknown>>;
}

export interface RollRequestedEnvelope extends RemoteEnvelopeBase {
  type: 'roll.requested';
  rollId: RollId;
  /** Padrão: `public`. O motor não aplica permissões: só repassa o valor. */
  visibility?: RollVisibility;
  payload: RemoteRollPayload;
}

export interface RollCancelledEnvelope extends RemoteEnvelopeBase {
  type: 'roll.cancelled';
  rollId: RollId;
}

export interface TableClearedEnvelope extends RemoteEnvelopeBase {
  type: 'table.cleared';
}

/** Mensagem do servidor, com versão de protocolo. */
export type RollEnvelope = RollRequestedEnvelope | RollCancelledEnvelope | TableClearedEnvelope;

/** O que o motor fez com uma mensagem. */
export type RemoteReceiptStatus = 'applied' | 'duplicate' | 'stale' | 'cancelled' | 'rejected';

/**
 * Motivo, quando a mensagem não foi aplicada normalmente.
 * - `same-sequence`, `same-roll`: repetida.
 * - `expired`: mais velha que `maxAgeMs`.
 * - `out-of-order`: mais antiga que uma rolagem ou limpeza já aplicada na sala.
 * - `before-clear`: pedido anterior ao último `table.cleared`.
 * - `already-finished`: cancelamento de uma rolagem que já terminou aqui.
 * - `cancelled-before-request`: o cancelamento chegou antes do pedido.
 * - `awaiting-request`: cancelamento guardado; o pedido ainda não chegou.
 * - `invalid-message`, `unsupported-version`, `invalid-roll`: recusada.
 */
export type RemoteReason =
  | 'same-sequence'
  | 'same-roll'
  | 'expired'
  | 'out-of-order'
  | 'before-clear'
  | 'already-finished'
  | 'cancelled-before-request'
  | 'awaiting-request'
  | 'invalid-message'
  | 'unsupported-version'
  | 'invalid-roll';

/** Contagem das mensagens recebidas, por destino. */
export interface RemoteStats {
  received: number;
  applied: number;
  duplicate: number;
  stale: number;
  cancelled: number;
  rejected: number;
}

/** Limites do protocolo. */
export const REMOTE_LIMITS = {
  /** Comprimento máximo de `roomId`, `playerId` e `rollId`. */
  idLength: 128,
  /** Mensagens e rolagens lembradas por sala, para reconhecer repetições. */
  historySize: 512,
  /** Salas lembradas; a menos usada é esquecida primeiro. */
  rooms: 64,
} as const;

function invalidMessage(message: string, path: string, received?: unknown): DiceError {
  return new DiceError('INVALID_MESSAGE', `Mensagem inválida: ${path}: ${message}`, {
    details: { path, ...(received === undefined ? {} : { received }) },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseId(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > REMOTE_LIMITS.idLength) {
    throw invalidMessage(
      `esperado um texto de 1 a ${REMOTE_LIMITS.idLength} caracteres.`,
      path,
      value,
    );
  }
  return value;
}

/**
 * Confere a forma de uma mensagem vinda da rede e devolve uma cópia tipada.
 * Lança `DiceError` `INVALID_MESSAGE`, com o campo em `details.path`. Os dados
 * da rolagem (tipos, valores, temas) são validados depois, como em `roll()`.
 */
export function parseEnvelope(input: unknown): RollEnvelope {
  if (!isRecord(input)) throw invalidMessage('esperado um objeto.', 'envelope');
  if (input.protocolVersion !== PROTOCOL_VERSION) {
    throw new DiceError(
      'INVALID_MESSAGE',
      `Versão de protocolo não suportada: ${String(input.protocolVersion)} (este motor entende a ${PROTOCOL_VERSION}).`,
      { details: { path: 'protocolVersion', received: input.protocolVersion } },
    );
  }
  const type = input.type as RemoteMessageType;
  if (typeof type !== 'string' || !REMOTE_MESSAGE_TYPES.includes(type)) {
    throw invalidMessage(
      `esperado ${REMOTE_MESSAGE_TYPES.map((t) => `"${t}"`).join(', ')}.`,
      'type',
      type,
    );
  }
  const sequence = input.sequence;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
    throw invalidMessage('esperado um inteiro maior ou igual a zero.', 'sequence', sequence);
  }
  const sentAt = input.sentAt;
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) {
    throw invalidMessage('esperado um número (ms desde a época).', 'sentAt', sentAt);
  }
  const base: RemoteEnvelopeBase = {
    protocolVersion: PROTOCOL_VERSION,
    roomId: parseId(input.roomId, 'roomId'),
    playerId: parseId(input.playerId, 'playerId'),
    sequence,
    sentAt,
  };

  if (type === 'table.cleared') return { ...base, type };
  const rollId = parseId(input.rollId, 'rollId');
  if (type === 'roll.cancelled') return { ...base, type, rollId };

  const visibility = input.visibility ?? 'public';
  if (typeof visibility !== 'string' || !(ROLL_VISIBILITIES as string[]).includes(visibility)) {
    throw invalidMessage(
      `esperado ${ROLL_VISIBILITIES.map((v) => `"${v}"`).join(', ')}.`,
      'visibility',
      visibility,
    );
  }
  const payload = input.payload;
  if (!isRecord(payload)) throw invalidMessage('esperado um objeto.', 'payload');
  if (!Array.isArray(payload.dice) || payload.dice.length === 0) {
    throw invalidMessage('esperada uma lista com ao menos um grupo de dados.', 'payload.dice');
  }
  (payload.dice as unknown[]).forEach((spec, index) => {
    // O servidor é a autoridade: um cliente nunca sorteia o valor de outro jogador.
    if (!isRecord(spec) || !Array.isArray(spec.values)) {
      throw invalidMessage(
        'obrigatório em rolagens remotas (o valor oficial vem do servidor).',
        `payload.dice[${index}].values`,
      );
    }
  });
  if (payload.metadata !== undefined && !isRecord(payload.metadata)) {
    throw invalidMessage('esperado um objeto.', 'payload.metadata');
  }
  return {
    ...base,
    type,
    rollId,
    visibility: visibility as RollVisibility,
    payload: payload as unknown as RemoteRollPayload,
  };
}

/** Conjunto com tamanho máximo: ao passar do limite, esquece o mais antigo. */
class BoundedSet<T> {
  private readonly items = new Set<T>();
  constructor(private readonly limit: number) {}

  has(item: T): boolean {
    return this.items.has(item);
  }

  add(item: T): void {
    this.items.delete(item);
    this.items.add(item);
    if (this.items.size > this.limit) {
      const oldest = this.items.values().next().value as T;
      this.items.delete(oldest);
    }
  }
}

interface RoomState {
  /** Maior sequência de pedido ou limpeza já considerada; -1 se nenhuma. */
  lastOrdered: number;
  /** Sequência do último `table.cleared`; -1 se nenhum. */
  cleared: number;
  sequences: BoundedSet<number>;
  /** Rolagens cujo pedido já chegou. */
  requested: BoundedSet<RollId>;
  /** Rolagens canceladas antes de o pedido chegar. */
  cancelled: BoundedSet<RollId>;
}

/** Decisão sobre uma mensagem válida. */
export type RemoteDecision =
  | { kind: 'request'; envelope: RollRequestedEnvelope }
  /** `known`: o pedido já tinha chegado. Sem ele, o cancelamento fica guardado. */
  | { kind: 'cancel'; envelope: RollCancelledEnvelope; known: boolean }
  | { kind: 'clear'; envelope: TableClearedEnvelope }
  | { kind: 'skip'; status: 'duplicate' | 'stale' | 'cancelled'; reason: RemoteReason };

export interface RemoteSequencerOptions {
  /**
   * Idade máxima de uma mensagem (`now - sentAt`), em ms. Ausente: sem limite.
   * Compara relógios de máquinas diferentes: só use com o relógio do servidor.
   */
  maxAgeMs?: number;
  /** Mensagens lembradas por sala. Padrão: `REMOTE_LIMITS.historySize`. */
  historySize?: number;
}

/**
 * Ordena as mensagens de cada sala. Regras:
 * - mesma `sequence` ou mesmo `rollId` pedido duas vezes: repetida;
 * - pedido mais antigo que outro pedido ou limpeza já considerados: obsoleto
 *   (a mesa mostra a ordem do servidor; uma rolagem atrasada não interrompe a
 *   mais nova);
 * - limpeza mais antiga que um pedido já considerado: obsoleta;
 * - cancelamento vale por `rollId`, em qualquer ordem: antes do pedido, ele é
 *   guardado e impede a rolagem quando o pedido chegar.
 * Buracos na sequência não bloqueiam nada.
 */
export class RemoteSequencer {
  private readonly rooms = new Map<string, RoomState>();
  private readonly maxAgeMs: number | undefined;
  private readonly historySize: number;

  constructor(options: RemoteSequencerOptions = {}) {
    this.maxAgeMs = options.maxAgeMs;
    this.historySize = options.historySize ?? REMOTE_LIMITS.historySize;
  }

  /** Decide o destino de uma mensagem já validada e registra o que for preciso. */
  accept(envelope: RollEnvelope, now: number): RemoteDecision {
    const room = this.room(envelope.roomId);
    if (room.sequences.has(envelope.sequence)) {
      return { kind: 'skip', status: 'duplicate', reason: 'same-sequence' };
    }
    room.sequences.add(envelope.sequence);
    if (this.maxAgeMs !== undefined && now - envelope.sentAt > this.maxAgeMs) {
      return { kind: 'skip', status: 'stale', reason: 'expired' };
    }

    switch (envelope.type) {
      case 'roll.requested': {
        if (room.requested.has(envelope.rollId)) {
          return { kind: 'skip', status: 'duplicate', reason: 'same-roll' };
        }
        if (envelope.sequence <= room.cleared) {
          return { kind: 'skip', status: 'stale', reason: 'before-clear' };
        }
        if (envelope.sequence < room.lastOrdered) {
          return { kind: 'skip', status: 'stale', reason: 'out-of-order' };
        }
        room.requested.add(envelope.rollId);
        room.lastOrdered = envelope.sequence;
        if (room.cancelled.has(envelope.rollId)) {
          return { kind: 'skip', status: 'cancelled', reason: 'cancelled-before-request' };
        }
        return { kind: 'request', envelope };
      }
      case 'roll.cancelled': {
        if (room.requested.has(envelope.rollId)) return { kind: 'cancel', envelope, known: true };
        if (room.cancelled.has(envelope.rollId)) {
          return { kind: 'skip', status: 'duplicate', reason: 'same-roll' };
        }
        room.cancelled.add(envelope.rollId);
        return { kind: 'cancel', envelope, known: false };
      }
      case 'table.cleared': {
        if (envelope.sequence < room.lastOrdered) {
          return { kind: 'skip', status: 'stale', reason: 'out-of-order' };
        }
        room.lastOrdered = envelope.sequence;
        room.cleared = envelope.sequence;
        return { kind: 'clear', envelope };
      }
    }
  }

  /** Esquece o histórico de uma sala, ou de todas. Para reconexão ou troca de sala. */
  reset(roomId?: string): void {
    if (roomId === undefined) this.rooms.clear();
    else this.rooms.delete(roomId);
  }

  private room(roomId: string): RoomState {
    let room = this.rooms.get(roomId);
    if (room) {
      // Volta ao fim: é a sala usada mais recentemente.
      this.rooms.delete(roomId);
    } else {
      room = {
        lastOrdered: -1,
        cleared: -1,
        sequences: new BoundedSet(this.historySize),
        requested: new BoundedSet(this.historySize),
        cancelled: new BoundedSet(this.historySize),
      };
    }
    this.rooms.set(roomId, room);
    if (this.rooms.size > REMOTE_LIMITS.rooms) {
      this.rooms.delete(this.rooms.keys().next().value as string);
    }
    return room;
  }
}
