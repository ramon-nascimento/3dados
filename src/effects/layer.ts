import { Color, Group, type Object3D } from 'three';
import { parseEffectName, parseEffectOptions, type EffectOptions } from '../core/effect-trigger';
import { DiceError } from '../core/errors';
import type { Vec3 } from '../core/math';
import { createSeededRandomSource } from '../core/random';
import type { DieId } from '../core/types';
import { CATALOG, type EffectPhase } from './catalog';
import type { EffectPart, ParticleBudget } from './parts';
import { EffectResources } from './resources';
import {
  EFFECTS,
  isBuiltinEffect,
  type BuiltinEffect,
  type DiceEffectsControls,
  type EffectHandle,
  type EffectLevel,
  type EffectLevelSetting,
  type EffectPreset,
  type EffectStats,
  type EffectTriggerOptions,
  type EffectsEnvironment,
  type EffectsOptions,
} from './types';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function browserEffectsEnvironment(): EffectsEnvironment {
  const query =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : undefined;
  return {
    prefersReducedMotion: () => query?.matches === true,
    onReducedMotionChange(callback) {
      if (!query) return () => undefined;
      query.addEventListener('change', callback);
      return () => {
        query.removeEventListener('change', callback);
      };
    },
  };
}

/** O que os efeitos precisam do motor. Implementado pelo `integration`. */
export interface EffectsHost {
  /** Coloca o grupo dos efeitos na cena. */
  attach(object: Object3D): void;
  detach(object: Object3D): void;
  /**
   * Dados físicos na mesa que correspondem a `ids` (o identificador do dado
   * pedido ou de uma parte). Sem `ids`: todos.
   */
  resolveDice(ids?: readonly DieId[]): DieId[];
  /** Centro e raio de um dado na mesa, ou `undefined` se ele não está mais lá. */
  dieInfo(dieId: DieId): { position: Vec3; radius: number } | undefined;
  /** Relógio em milissegundos. */
  now(): number;
  /** Os efeitos mudaram: o motor decide se liga o laço ou só redesenha. */
  changed(): void;
}

export const DEFAULT_MAX_PARTICLES = 2000;
const MAX_PARTICLES_LIMIT = 20_000;
/** Intervalo mínimo entre clarões: no máximo 2,5 por segundo (WCAG 2.3.1 pede menos de 3). */
export const MIN_FLASH_INTERVAL_MS = 400;
/** Maior passo de tempo aplicado de uma vez (aba em segundo plano, por exemplo). */
const MAX_STEP_MS = 100;
const LEVEL_SETTINGS: readonly EffectLevelSetting[] = ['auto', 'full', 'reduced', 'off'];

function invalidArgument(message: string, path: string): DiceError {
  return new DiceError('INVALID_ARGUMENT', `${path}: ${message}`, { details: { path } });
}

function parseLevel(value: unknown, path: string): EffectLevelSetting {
  if (!LEVEL_SETTINGS.includes(value as EffectLevelSetting)) {
    throw invalidArgument(`esperado ${LEVEL_SETTINGS.map((l) => `"${l}"`).join(', ')}.`, path);
  }
  return value as EffectLevelSetting;
}

/** Valida as opções de criação. Lança `INVALID_ARGUMENT` com o campo na mensagem. */
export function parseEffectsOptions(options: unknown): Required<EffectsOptions> {
  if (options === undefined) return { level: 'auto', maxParticles: DEFAULT_MAX_PARTICLES };
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalidArgument('esperado um objeto.', 'effects');
  }
  const raw = options as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== 'level' && key !== 'maxParticles') {
      throw invalidArgument(`campo desconhecido "${key}".`, 'effects');
    }
  }
  const level = raw.level === undefined ? 'auto' : parseLevel(raw.level, 'effects.level');
  const maxParticles = raw.maxParticles ?? DEFAULT_MAX_PARTICLES;
  if (
    typeof maxParticles !== 'number' ||
    !Number.isInteger(maxParticles) ||
    maxParticles < 0 ||
    maxParticles > MAX_PARTICLES_LIMIT
  ) {
    throw invalidArgument(
      `esperado um inteiro de 0 a ${MAX_PARTICLES_LIMIT}.`,
      'effects.maxParticles',
    );
  }
  return { level, maxParticles };
}

type Target = { dieId: DieId } | { position: Vec3 };

interface EffectUnit {
  target: Target;
  radius: number;
  parts: EffectPart[];
}

interface ActiveEffect {
  id: number;
  name: string;
  units: EffectUnit[];
  startedAt: number;
  lastUpdate: number;
  durationMs: number;
}

/**
 * Camada de efeitos visuais. Cria seus próprios objetos em um grupo separado e
 * nunca toca nas malhas dos dados: o que a verificação final lê é sempre o que
 * a física decidiu. No nível `off` não cria nada, nem o grupo.
 */
export class DiceEffects implements DiceEffectsControls {
  private readonly env: EffectsEnvironment;
  private readonly host: EffectsHost;
  private readonly resources = new EffectResources();
  private readonly maxParticles: number;
  private readonly presets = new Map<string, EffectPreset>();
  private readonly active = new Map<number, ActiveEffect>();
  /** Nomes desconhecidos já avisados no console. */
  private readonly warned = new Set<string>();
  private readonly unsubscribeMedia: () => void;
  private setting: EffectLevelSetting;
  private effective: EffectLevel;
  private root: Group | undefined;
  private particles = 0;
  private skipped = 0;
  private nextId = 1;
  private lastFlash = -Infinity;
  private disposed = false;
  private readonly budget: ParticleBudget = {
    take: (wanted) => {
      const allowed = Math.max(Math.min(wanted, this.maxParticles - this.particles), 0);
      this.particles += allowed;
      return allowed;
    },
    give: (count) => {
      this.particles = Math.max(this.particles - count, 0);
    },
  };

  constructor(options: EffectsOptions, env: EffectsEnvironment, host: EffectsHost) {
    const parsed = parseEffectsOptions(options);
    this.env = env;
    this.host = host;
    this.maxParticles = parsed.maxParticles;
    this.setting = parsed.level;
    this.effective = this.resolveLevel();
    this.unsubscribeMedia = env.onReducedMotionChange(() => {
      if (this.setting === 'auto') this.applyLevel();
    });
  }

  get level(): EffectLevel {
    return this.effective;
  }

  get levelSetting(): EffectLevelSetting {
    return this.setting;
  }

  setLevel(level: EffectLevelSetting): void {
    this.setting = parseLevel(level, 'level');
    this.applyLevel();
  }

  register(name: string, preset: EffectPreset): void {
    const fail = (message: string, path: string) => invalidArgument(message, path);
    const parsedName = parseEffectName(name, 'name', fail);
    if (isBuiltinEffect(parsedName)) {
      throw invalidArgument(`"${parsedName}" é um efeito interno.`, 'name');
    }
    if (typeof preset !== 'object' || preset === null) throw fail('esperado um objeto.', 'preset');
    const { base, ...rest } = preset as unknown as Record<string, unknown>;
    if (typeof base !== 'string' || !isBuiltinEffect(base)) {
      throw fail(`esperado um efeito interno (${EFFECTS.join(', ')}).`, 'preset.base');
    }
    this.presets.set(parsedName, { base, ...parseEffectOptions(rest, 'preset', fail) });
    this.warned.delete(parsedName);
  }

  has(name: string): boolean {
    return isBuiltinEffect(name) || this.presets.has(name);
  }

  /** Quando um efeito acompanha os dados de um tema, ou `undefined` se ele não existe. */
  phaseOf(name: string): EffectPhase | undefined {
    const base = isBuiltinEffect(name) ? name : this.presets.get(name)?.base;
    return base === undefined ? undefined : CATALOG[base].phase;
  }

  trigger(name: string, options: EffectTriggerOptions = {}): EffectHandle | null {
    if (this.disposed) return null;
    const fail = (message: string, path: string) => invalidArgument(message, path);
    parseEffectName(name, 'name', fail);
    const { dieIds, position, ...rest } = options;
    const effectOptions = parseEffectOptions(rest, 'options', fail);
    let targets: Target[];
    if (position !== undefined) {
      const { x, y, z } = position as Partial<Vec3>;
      if (![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw fail('esperado { x, y, z } com números finitos.', 'options.position');
      }
      targets = [{ position: { x: x!, y: y!, z: z! } }];
    } else {
      if (dieIds !== undefined && !Array.isArray(dieIds)) {
        throw fail('esperada uma lista.', 'options.dieIds');
      }
      targets = this.host.resolveDice(dieIds).map((dieId) => ({ dieId }));
    }
    return this.spawn(name, targets, effectOptions, (this.nextId * 0x9e3779b9) >>> 0);
  }

  /**
   * Mostra um efeito nos dados físicos indicados. Uso do motor, para os
   * gatilhos do pedido e os efeitos dos temas; `seed` vem da rolagem.
   */
  spawnOnDice(
    name: string,
    dieIds: readonly DieId[],
    options: EffectOptions,
    seed: number,
  ): EffectHandle | null {
    if (this.disposed) return null;
    return this.spawn(
      name,
      dieIds.map((dieId) => ({ dieId })),
      options,
      seed,
    );
  }

  stopAll(): void {
    if (this.active.size === 0) return;
    for (const id of [...this.active.keys()]) this.stop(id);
    this.host.changed();
  }

  /** Interrompe as partes de efeitos presas a estes dados (os dados saíram da mesa). */
  stopForDice(dieIds: Iterable<DieId>): void {
    const gone = new Set(dieIds);
    if (gone.size === 0) return;
    let changed = false;
    for (const effect of [...this.active.values()]) {
      for (const unit of [...effect.units]) {
        if ('dieId' in unit.target && gone.has(unit.target.dieId)) {
          this.removeUnit(effect, unit);
          changed = true;
        }
      }
    }
    if (changed) this.host.changed();
  }

  /** Avança todos os efeitos até o instante atual. Chamado pelo laço de render. */
  update(): void {
    if (this.active.size === 0) return;
    const now = this.host.now();
    for (const effect of [...this.active.values()]) this.advance(effect, now);
  }

  /** Há efeito que muda a cada quadro: o laço de render precisa continuar. */
  get needsFrames(): boolean {
    for (const effect of this.active.values()) {
      if (effect.units.some((unit) => unit.parts.some((part) => part.animated))) return true;
    }
    return false;
  }

  /** Instante em que o próximo efeito parado termina, para o motor agendar a remoção. */
  get nextExpiry(): number | undefined {
    let next: number | undefined;
    for (const effect of this.active.values()) {
      const end = effect.startedAt + effect.durationMs;
      if (next === undefined || end < next) next = end;
    }
    return next;
  }

  getStats(): EffectStats {
    let objects = 0;
    this.root?.traverse(() => {
      objects++;
    });
    return {
      level: this.effective,
      active: this.active.size,
      particles: this.particles,
      objects,
      created: this.resources.created,
      disposed: this.resources.disposed,
      skipped: this.skipped,
    };
  }

  /** O grupo raiz, se já existe. Para testes. */
  get rootObject(): Group | undefined {
    return this.root;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const id of [...this.active.keys()]) this.stop(id);
    this.disposed = true;
    this.unsubscribeMedia();
    this.dropRoot();
    this.resources.dispose();
  }

  private resolveLevel(): EffectLevel {
    if (this.setting !== 'auto') return this.setting;
    return this.env.prefersReducedMotion() ? 'reduced' : 'full';
  }

  private applyLevel(): void {
    const next = this.resolveLevel();
    if (next === this.effective) return;
    this.effective = next;
    // Os efeitos em andamento foram criados para o nível anterior.
    for (const id of [...this.active.keys()]) this.stop(id);
    if (next === 'off') this.dropRoot();
    this.host.changed();
  }

  private dropRoot(): void {
    if (!this.root) return;
    this.host.detach(this.root);
    this.root = undefined;
  }

  private resolve(name: string): { base: BuiltinEffect; options: EffectOptions } | undefined {
    if (isBuiltinEffect(name)) return { base: name, options: {} };
    const preset = this.presets.get(name);
    if (!preset) return undefined;
    const { base, ...options } = preset;
    return { base, options };
  }

  private spawn(
    name: string,
    targets: readonly Target[],
    options: EffectOptions,
    seed: number,
  ): EffectHandle | null {
    const level = this.effective;
    const resolved = this.resolve(name);
    if (level === 'off' || !resolved || targets.length === 0) {
      this.skipped++;
      if (!resolved && level !== 'off' && !this.warned.has(name)) {
        this.warned.add(name);
        console.warn(`[3dados] Efeito "${name}" desconhecido; ignorado.`);
      }
      return null;
    }
    const definition = CATALOG[resolved.base];
    const merged = { ...resolved.options, ...options };
    const durationMs = merged.durationMs ?? definition.durationMs;
    const now = this.host.now();
    const rng = createSeededRandomSource(seed);
    const allowFlash = now - this.lastFlash >= MIN_FLASH_INTERVAL_MS;

    const units: EffectUnit[] = [];
    for (const target of targets) {
      const info = 'dieId' in target ? this.host.dieInfo(target.dieId) : undefined;
      if ('dieId' in target && !info) continue;
      const radius = info?.radius ?? 1;
      const parts = definition.build({
        level,
        color: new Color(merged.color ?? definition.color),
        intensity: merged.intensity ?? 1,
        durationMs,
        radius,
        rng,
        budget: this.budget,
        resources: this.resources,
        // Um clarão por disparo, mesmo com vários dados.
        allowFlash: allowFlash && units.length === 0,
      });
      if (parts.length > 0) units.push({ target, radius, parts });
    }
    if (units.length === 0) {
      this.skipped++;
      return null;
    }
    if (
      allowFlash &&
      level === 'full' &&
      (resolved.base === 'burst' || resolved.base === 'critical')
    ) {
      this.lastFlash = now;
    }

    this.root ??= this.createRoot();
    for (const unit of units) for (const part of unit.parts) this.root.add(part.object);
    const effect: ActiveEffect = {
      id: this.nextId++,
      name,
      units,
      startedAt: now,
      lastUpdate: now,
      durationMs,
    };
    this.active.set(effect.id, effect);
    // Primeiro quadro já posicionado: um efeito parado é desenhado uma vez só.
    this.advance(effect, now);
    this.host.changed();
    return {
      id: effect.id,
      stop: () => {
        if (!this.active.has(effect.id)) return;
        this.stop(effect.id);
        this.host.changed();
      },
    };
  }

  private createRoot(): Group {
    const root = new Group();
    root.name = '3dados-effects';
    this.host.attach(root);
    return root;
  }

  private advance(effect: ActiveEffect, now: number): void {
    const elapsed = now - effect.startedAt;
    const dt = Math.min(Math.max(now - effect.lastUpdate, 0), MAX_STEP_MS);
    effect.lastUpdate = now;
    for (const unit of [...effect.units]) {
      const anchor =
        'dieId' in unit.target
          ? this.host.dieInfo(unit.target.dieId)?.position
          : unit.target.position;
      for (const part of [...unit.parts]) {
        if (!part.update({ elapsed, dt, anchor })) {
          part.dispose();
          unit.parts.splice(unit.parts.indexOf(part), 1);
        }
      }
      if (unit.parts.length === 0) effect.units.splice(effect.units.indexOf(unit), 1);
    }
    if (effect.units.length === 0) this.active.delete(effect.id);
  }

  private removeUnit(effect: ActiveEffect, unit: EffectUnit): void {
    for (const part of unit.parts) part.dispose();
    effect.units.splice(effect.units.indexOf(unit), 1);
    if (effect.units.length === 0) this.active.delete(effect.id);
  }

  private stop(id: number): void {
    const effect = this.active.get(id);
    if (!effect) return;
    for (const unit of effect.units) for (const part of unit.parts) part.dispose();
    this.active.delete(id);
  }
}
