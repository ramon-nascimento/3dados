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

export { createDieDefinition } from './core/polyhedron';
export type { FaceSpec, HullFace } from './core/polyhedron';
export type { DieDefinition, DieFace, FaceLabel } from './core/die-definition';
export type { Quat, Vec3 } from './core/math';

export { DiceEngine } from './integration/engine';
export type { DiceEngineOptions, RollHandle, TableDie } from './integration/engine';

export type { Presentation, QualitySetting, RenderQuality } from './renderer/dice-renderer';

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
