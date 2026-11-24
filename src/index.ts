/**
 * API pública do 3dados. Este é o único ponto de entrada suportado: nada fora
 * deste arquivo faz parte do contrato.
 */
export { VERSION } from './version';

export { DiceError, isDiceError } from './core/errors';
export type { DiceErrorCode, DiceErrorOptions } from './core/errors';

export type {
  DiceCollidedEvent,
  DiceEventMap,
  DiceEventName,
  DiceSettledEvent,
  Listener,
  RollStartedEvent,
  Unsubscribe,
} from './core/events';

export { DiceEngine } from './integration/engine';
export type { DiceEngineOptions, RollHandle } from './integration/engine';

export type { PhysicsConfig } from './physics/config';

export { createCryptoRandomSource, createSeededRandomSource } from './core/random';
export type { RandomSource } from './core/random';

export type {
  DieId,
  DieResult,
  DieSpec,
  DieType,
  DieValueSource,
  RollCancelReason,
  RollCancelled,
  RollCompleted,
  RollFailed,
  RollId,
  RollMetadata,
  RollOutcome,
  RollRequest,
  RollVisibility,
  StandardDieType,
} from './core/types';
