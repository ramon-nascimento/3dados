/**
 * API pública do 3dados. Este é o único ponto de entrada suportado: nada fora
 * deste arquivo faz parte do contrato.
 */
export { VERSION } from './version';

export { DiceError, isDiceError } from './core/errors';
export type { DiceErrorCode, DiceErrorOptions } from './core/errors';

export type {
  ContextLostEvent,
  ContextRestoredEvent,
  DiceCollidedEvent,
  DiceEventMap,
  DiceEventName,
  DiceSettledEvent,
  Listener,
  QualityChangedEvent,
  RollStartedEvent,
  Unsubscribe,
} from './core/events';

export { createDieDefinition } from './core/polyhedron';
export type { FaceSpec, HullFace } from './core/polyhedron';
export type { DieDefinition, DieFace, FaceLabel } from './core/die-definition';
export { EFFECT_LIMITS, EFFECT_MOMENTS } from './core/effect-trigger';
export type {
  EffectCondition,
  EffectMoment,
  EffectOptions,
  EffectTrigger,
} from './core/effect-trigger';
export type { Quat, Vec3 } from './core/math';

export { DiceEngine } from './integration/engine';
export type { DiceEngineOptions, RollHandle, TableDie } from './integration/engine';
export { ROLL_CONCURRENCY, ROLL_QUEUE_LIMITS } from './integration/options';
export type { RemoteOptions, RollConcurrency, RollQueueOptions } from './integration/options';
export type { DiceRemoteControls, RemoteReceipt } from './integration/remote';
export type { EngineState, EngineStats, PendingRoll, RollPhase } from './integration/state';

export {
  PROTOCOL_VERSION,
  REMOTE_LIMITS,
  REMOTE_MESSAGE_TYPES,
  ROLL_VISIBILITIES,
  parseEnvelope,
} from './core/remote';
export type {
  RemoteEnvelopeBase,
  RemoteMessageType,
  RemoteReason,
  RemoteReceiptStatus,
  RemoteRollPayload,
  RemoteStats,
  RollCancelledEnvelope,
  RollEnvelope,
  RollRequestedEnvelope,
  TableClearedEnvelope,
} from './core/remote';

export { MAX_FPS_LIMITS } from './renderer/types';
export type {
  FrameSession,
  Presentation,
  QualitySetting,
  RenderQuality,
  RenderStats,
  TimingSummary,
} from './renderer/types';

export {
  DEFAULT_THEME,
  MATERIAL_PRESETS,
  MATERIALS,
  TEXTURES,
  THEME_SCHEMA_VERSION,
  parseTheme,
  serializeTheme,
} from './customization';
export type {
  EmissiveTarget,
  MaterialAppearance,
  MaterialKind,
  MaterialPhysics,
  MaterialPreset,
  TextureKind,
  ThemeColors,
  ThemeConfig,
  ThemeEmissive,
} from './customization';

export { DEFAULT_PHYSICS_CONFIG, PHYSICS_LIMITS } from './physics/config';
export type { PhysicsConfig } from './physics/config';

export { BUILTIN_SOUNDS, SOUND_PROFILES, SURFACES, intensityToGain } from './audio';
export type {
  AudioOptions,
  AudioState,
  AudioStats,
  BuiltinSound,
  DiceAudioControls,
  ImpactOptions,
  PlayOptions,
  SoundProfile,
  SoundSource,
  Surface,
} from './audio';

// Direto de `effects/types`: o barril `effects` leva ao three nos `.d.ts`.
export { EFFECTS } from './effects/types';
export type {
  BuiltinEffect,
  DiceEffectsControls,
  EffectHandle,
  EffectLevel,
  EffectLevelSetting,
  EffectPreset,
  EffectStats,
  EffectTriggerOptions,
  EffectsOptions,
} from './effects/types';

export { createCryptoRandomSource, createSeededRandomSource } from './core/random';
export type { RandomSource } from './core/random';

export type {
  DieComponentResult,
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
