import { isDiceError, type DiceError } from '../core/errors';
import {
  RemoteSequencer,
  parseEnvelope,
  type RemoteMessageType,
  type RemoteReason,
  type RemoteReceiptStatus,
  type RemoteStats,
  type RollRequestedEnvelope,
} from '../core/remote';
import type { RollId, RollOutcome, RollRequest } from '../core/types';

/** Controle de uma rolagem. Definido aqui para não criar ciclo com `engine.ts`. */
export interface RemoteRollHandle {
  readonly id: RollId;
  readonly result: Promise<RollOutcome>;
  cancel(): void;
}

/** O que o motor fez com uma mensagem recebida. */
export interface RemoteReceipt {
  status: RemoteReceiptStatus;
  /** Presente quando a mensagem não foi aplicada do jeito comum. */
  reason?: RemoteReason;
  /** Ausentes quando a mensagem nem pôde ser lida. */
  type?: RemoteMessageType;
  roomId?: string;
  sequence?: number;
  rollId?: RollId;
  /** Só em `roll.requested` aplicado: o controle da rolagem criada. */
  roll?: RemoteRollHandle;
  /** Só em `rejected`: o motivo, com o código (`INVALID_MESSAGE`, `INVALID_REQUEST`...). */
  error?: DiceError;
}

/** Controles das mensagens de um servidor externo. */
export interface DiceRemoteControls {
  /**
   * Recebe uma mensagem do servidor (`RollEnvelope`) e devolve o que foi feito
   * com ela. Nunca lança: mensagens inválidas voltam com `status: 'rejected'`.
   */
  receive(message: unknown): RemoteReceipt;
  /** Esquece o histórico de uma sala, ou de todas (reconexão, troca de sala). */
  reset(roomId?: string): void;
  getStats(): RemoteStats;
}

/** O que o canal precisa do motor. */
export interface RemoteHost {
  /** Enfileira ou inicia uma rolagem; `error` se o pedido foi recusado. */
  submit(request: RollRequest): { handle: RemoteRollHandle; error?: DiceError };
  /** Cancela uma rolagem na mesa ou na fila. Devolve se havia o que cancelar. */
  cancelRemote(rollId: RollId): boolean;
  /** Limpa a mesa e a fila. */
  clearRemote(): void;
  /** Relógio de parede, em ms desde a época (para `maxAgeMs`). */
  clock(): number;
  /** Erro de motor destruído, ou `undefined` se ele está vivo. */
  destroyedError(): DiceError | undefined;
}

function toRequest({
  rollId,
  roomId,
  playerId,
  visibility,
  sequence,
  sentAt,
  payload,
}: RollRequestedEnvelope): RollRequest {
  return {
    id: rollId,
    dice: payload.dice,
    ...(payload.seed === undefined ? {} : { seed: payload.seed }),
    ...(payload.effects === undefined ? {} : { effects: payload.effects }),
    // Os campos do envelope valem sobre os da aplicação: são os do servidor.
    metadata: {
      ...payload.metadata,
      playerId,
      roomId,
      visibility: visibility ?? 'public',
      sequence,
      sentAt,
    },
  };
}

/** Recebe mensagens do servidor, ordena por sala e as aplica no motor. */
export class RemoteChannel implements DiceRemoteControls {
  private readonly sequencer: RemoteSequencer;
  private readonly host: RemoteHost;
  private readonly stats: RemoteStats = {
    received: 0,
    applied: 0,
    duplicate: 0,
    stale: 0,
    cancelled: 0,
    rejected: 0,
  };

  constructor(host: RemoteHost, maxAgeMs: number | undefined) {
    this.host = host;
    this.sequencer = new RemoteSequencer(maxAgeMs === undefined ? {} : { maxAgeMs });
  }

  receive(message: unknown): RemoteReceipt {
    this.stats.received++;
    const destroyed = this.host.destroyedError();
    if (destroyed) return this.count({ status: 'rejected', error: destroyed });

    let envelope;
    try {
      envelope = parseEnvelope(message);
    } catch (error) {
      if (!isDiceError(error)) throw error;
      const reason =
        error.details?.path === 'protocolVersion' ? 'unsupported-version' : 'invalid-message';
      return this.count({ status: 'rejected', reason, error });
    }

    const about = {
      type: envelope.type,
      roomId: envelope.roomId,
      sequence: envelope.sequence,
      ...('rollId' in envelope ? { rollId: envelope.rollId } : {}),
    };
    const decision = this.sequencer.accept(envelope, this.host.clock());
    switch (decision.kind) {
      case 'skip':
        return this.count({ status: decision.status, reason: decision.reason, ...about });
      case 'request': {
        const { handle, error } = this.host.submit(toRequest(decision.envelope));
        if (error)
          return this.count({ status: 'rejected', reason: 'invalid-roll', error, ...about });
        return this.count({ status: 'applied', roll: handle, ...about });
      }
      case 'cancel':
        if (!decision.known) {
          return this.count({ status: 'applied', reason: 'awaiting-request', ...about });
        }
        return this.host.cancelRemote(decision.envelope.rollId)
          ? this.count({ status: 'applied', ...about })
          : this.count({ status: 'stale', reason: 'already-finished', ...about });
      case 'clear':
        this.host.clearRemote();
        return this.count({ status: 'applied', ...about });
    }
  }

  reset(roomId?: string): void {
    this.sequencer.reset(roomId);
  }

  getStats(): RemoteStats {
    return { ...this.stats };
  }

  private count(receipt: RemoteReceipt): RemoteReceipt {
    this.stats[receipt.status]++;
    return receipt;
  }
}
