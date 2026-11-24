import type { EffectOptions } from '../core/effect-trigger';
import type { Vec3 } from '../core/math';
import type { DieId } from '../core/types';

/** Nível efetivo dos efeitos. */
export type EffectLevel = 'off' | 'reduced' | 'full';
/**
 * Nível pedido. `auto` usa `full`, ou `reduced` quando o sistema pede menos
 * movimento (`prefers-reduced-motion: reduce`), e acompanha a mudança.
 */
export type EffectLevelSetting = EffectLevel | 'auto';

/** Efeitos internos. */
export type BuiltinEffect =
  | 'highlight'
  | 'glow'
  | 'aura'
  | 'trail'
  | 'burst'
  | 'fire'
  | 'frost'
  | 'lightning'
  | 'critical'
  | 'failure';

export const EFFECTS: readonly BuiltinEffect[] = [
  'highlight',
  'glow',
  'aura',
  'trail',
  'burst',
  'fire',
  'frost',
  'lightning',
  'critical',
  'failure',
];

export function isBuiltinEffect(name: string): name is BuiltinEffect {
  return (EFFECTS as readonly string[]).includes(name);
}

/** Preset registrado pela aplicação: um efeito interno com outros ajustes. */
export interface EffectPreset extends EffectOptions {
  /** Efeito interno em que o preset se baseia. */
  base: BuiltinEffect;
}

/** Opções de `engine.effects.trigger`. */
export interface EffectTriggerOptions extends EffectOptions {
  /**
   * Dados que recebem o efeito: o identificador do dado pedido ou de uma parte
   * (`<id>:tens`). Sem `dieIds` nem `position`: todos os dados da mesa.
   */
  dieIds?: readonly DieId[];
  /** Ponto da mesa, em unidades do motor, para um efeito fora dos dados. */
  position?: Vec3;
}

/** Controle de um efeito em andamento. */
export interface EffectHandle {
  readonly id: number;
  /** Interrompe o efeito e libera seus recursos. Sem efeito se já terminou. */
  stop(): void;
}

export interface EffectStats {
  level: EffectLevel;
  /** Efeitos em andamento. */
  active: number;
  /** Partículas vivas. */
  particles: number;
  /** Objetos de efeito na cena (inclui o grupo raiz). */
  objects: number;
  /** Geometrias, materiais e texturas criados desde a criação do motor. */
  created: number;
  /** Desses, quantos já foram liberados. */
  disposed: number;
  /** Disparos ignorados: nível `off`, efeito desconhecido ou sem alvo. */
  skipped: number;
}

/** Opções de criação: `DiceEngine.create(el, { effects })`. */
export interface EffectsOptions {
  /** Padrão: `auto`. */
  level?: EffectLevelSetting;
  /** Teto de partículas vivas somando todos os efeitos. Padrão: 2.000; de 0 a 20.000. */
  maxParticles?: number;
}

/** Controles públicos dos efeitos: `engine.effects`. */
export interface DiceEffectsControls {
  /** Nível efetivo. */
  readonly level: EffectLevel;
  /** Nível pedido. */
  readonly levelSetting: EffectLevelSetting;
  /** Muda o nível. Interrompe os efeitos em andamento. */
  setLevel(level: EffectLevelSetting): void;
  /**
   * Mostra um efeito agora. Devolve `null` se nada foi criado: nível `off`,
   * efeito desconhecido (com aviso no console) ou nenhum alvo na mesa.
   */
  trigger(name: string, options?: EffectTriggerOptions): EffectHandle | null;
  /** Registra ou substitui um preset. Não pode ter o nome de um efeito interno. */
  register(name: string, preset: EffectPreset): void;
  /** Se `name` é um efeito interno ou registrado. */
  has(name: string): boolean;
  /** Interrompe todos os efeitos. */
  stopAll(): void;
  getStats(): EffectStats;
}
