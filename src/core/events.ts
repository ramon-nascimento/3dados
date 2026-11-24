import type {
  DieId,
  DieType,
  RollCancelled,
  RollCompleted,
  RollFailed,
  RollId,
  RollMetadata,
} from './types';

export interface RollStartedEvent {
  rollId: RollId;
  dice: readonly { dieId: DieId; type: DieType; role?: string }[];
  /** Medições reais da pré-simulação desta rolagem. */
  simulation: {
    /** Tentativas feitas até obter uma trajetória válida. */
    attempts: number;
    /** Tempo de CPU gasto antes do primeiro quadro, em milissegundos. */
    cpuTimeMs: number;
  };
  metadata?: RollMetadata;
}

export interface DiceCollidedEvent {
  rollId: RollId;
  dieId: DieId;
  /** Com o que o dado colidiu. */
  other: { kind: 'die'; dieId: DieId } | { kind: 'surface' };
  /** Intensidade normalizada do impacto, de 0 a 1. */
  intensity: number;
  /** Instante do impacto desde o início da animação, em milissegundos. */
  timeMs: number;
}

export interface DiceSettledEvent {
  rollId: RollId;
  dieId: DieId;
  value: number;
  faceId: string;
}

/** Eventos de ciclo de vida emitidos pelo motor. */
export interface DiceEventMap {
  rollStarted: RollStartedEvent;
  diceCollided: DiceCollidedEvent;
  diceSettled: DiceSettledEvent;
  rollCompleted: RollCompleted;
  rollCancelled: RollCancelled;
  rollFailed: RollFailed;
}

export type DiceEventName = keyof DiceEventMap;

export type Listener<T> = (payload: T) => void;

/** Remove o ouvinte registrado. Chamar mais de uma vez não tem efeito. */
export type Unsubscribe = () => void;

export type ListenerErrorHandler = (error: unknown, eventName: string) => void;

const defaultListenerErrorHandler: ListenerErrorHandler = (error, eventName) => {
  console.error(`[3dados] Erro em ouvinte do evento "${eventName}":`, error);
};

/**
 * Emissor de eventos tipado. Uma exceção em um ouvinte não interrompe os
 * demais nem o motor: é entregue ao `onListenerError`.
 */
export class TypedEmitter<M extends object> {
  private readonly listeners = new Map<keyof M, Set<Listener<never>>>();
  private readonly onListenerError: ListenerErrorHandler;

  constructor(onListenerError: ListenerErrorHandler = defaultListenerErrorHandler) {
    this.onListenerError = onListenerError;
  }

  on<K extends keyof M>(eventName: K, listener: Listener<M[K]>): Unsubscribe {
    let set = this.listeners.get(eventName);
    if (!set) {
      set = new Set();
      this.listeners.set(eventName, set);
    }
    set.add(listener);
    return () => {
      this.off(eventName, listener);
    };
  }

  once<K extends keyof M>(eventName: K, listener: Listener<M[K]>): Unsubscribe {
    const unsubscribe = this.on(eventName, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof M>(eventName: K, listener: Listener<M[K]>): void {
    const set = this.listeners.get(eventName);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) this.listeners.delete(eventName);
  }

  emit<K extends keyof M>(eventName: K, payload: M[K]): void {
    const set = this.listeners.get(eventName);
    if (!set) return;
    // Cópia: ouvintes podem se remover (ou registrar outros) durante a emissão.
    for (const listener of [...set]) {
      try {
        (listener as Listener<M[K]>)(payload);
      } catch (error) {
        this.onListenerError(error, String(eventName));
      }
    }
  }

  listenerCount(eventName: keyof M): number {
    return this.listeners.get(eventName)?.size ?? 0;
  }

  /** Remove todos os ouvintes. Usado ao destruir o motor. */
  clear(): void {
    this.listeners.clear();
  }
}
