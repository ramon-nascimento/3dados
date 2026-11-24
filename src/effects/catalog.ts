import { Color } from 'three';
import {
  createEmitter,
  createHalo,
  createRing,
  type EffectPart,
  type EmitterSpec,
  type PartContext,
} from './parts';
import type { BuiltinEffect, EffectLevel } from './types';

/**
 * Quando um efeito de tema acompanha o dado: durante o movimento (`motion`,
 * dispara no início da animação) ou em repouso (`rest`, dispara quando ele para).
 */
export type EffectPhase = 'motion' | 'rest';

export interface SpawnContext extends PartContext {
  level: Exclude<EffectLevel, 'off'>;
  /** Cor principal do efeito, já resolvida. */
  color: Color;
  /** Pode haver clarão agora (limite de clarões por segundo). */
  allowFlash: boolean;
}

interface EffectDefinition {
  color: string;
  durationMs: number;
  phase: EffectPhase;
  /** Cria as peças. Uma lista vazia: nada a mostrar neste nível. */
  build(context: SpawnContext): EffectPart[];
}

const white = new Color('#ffffff');
const darken = (color: Color, amount: number) => color.clone().multiplyScalar(1 - amount);
const mix = (a: Color, b: Color, t: number) => a.clone().lerp(b, t);

/** Peças paradas que substituem o efeito no nível `reduced`. */
const staticRing = (c: SpawnContext, opacity = 0.9) =>
  createRing(c, { color: c.color, opacity, scale: 2.6, motion: 'static' });
const staticHalo = (c: SpawnContext, opacity = 0.6) =>
  createHalo(c, { color: c.color, opacity, scale: 3.2, motion: 'static' });

function emitter(c: SpawnContext, spec: Omit<EmitterSpec, 'emitUntil'> & { emitUntil?: number }) {
  // Emite até perto do fim, para que as últimas partículas se apaguem a tempo.
  const emitUntil = spec.emitUntil ?? Math.max(c.durationMs - spec.life[1], 0);
  return createEmitter(c, { ...spec, emitUntil });
}

function burstParts(c: SpawnContext): EffectPart[] {
  const parts: EffectPart[] = [];
  if (c.allowFlash) {
    parts.push(
      createHalo(c, { color: mix(c.color, white, 0.5), opacity: 0.9, scale: 6, motion: 'flash' }),
    );
  }
  parts.push(
    emitter(c, {
      texture: 'spark',
      blending: 'additive',
      burst: 70,
      rate: 0,
      emitUntil: 1,
      life: [500, 950],
      speed: [5, 13],
      direction: 'sphere',
      spawnRadius: 0.3,
      spawnHeight: [0, 0.3],
      gravity: -7,
      drag: 2.6,
      size: [0.32, 0.06],
      color: [mix(c.color, white, 0.35), darken(c.color, 0.3)],
      alpha: [1, 0],
    }),
  );
  return parts;
}

/** Efeitos internos. Cores e durações são os padrões; o pedido pode trocá-los. */
export const CATALOG: Readonly<Record<BuiltinEffect, EffectDefinition>> = {
  highlight: {
    color: '#ffd166',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticRing(c)]
        : [createRing(c, { color: c.color, opacity: 1, scale: 2.6, motion: 'pulse' })],
  },
  glow: {
    color: '#ffe08a',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticHalo(c, 0.7)]
        : [createHalo(c, { color: c.color, opacity: 0.85, scale: 3.2, motion: 'pulse' })],
  },
  aura: {
    color: '#9ad0ff',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticHalo(c)]
        : [
            createHalo(c, { color: c.color, opacity: 0.35, scale: 3, motion: 'pulse' }),
            emitter(c, {
              texture: 'soft',
              blending: 'additive',
              burst: 6,
              rate: 45,
              life: [900, 1500],
              speed: [0.2, 0.6],
              direction: 'up',
              spawnRadius: 1,
              spawnHeight: [-0.6, 0.2],
              gravity: 1.6,
              drag: 0.8,
              size: [0.32, 0.06],
              color: [mix(c.color, white, 0.3), c.color],
              alpha: [0.85, 0],
            }),
          ],
  },
  trail: {
    color: '#ffffff',
    durationMs: 8000,
    phase: 'motion',
    // Rastro é movimento: no nível reduzido não aparece.
    build: (c) =>
      c.level === 'reduced'
        ? []
        : [
            emitter(c, {
              texture: 'soft',
              blending: 'additive',
              burst: 0,
              rate: 0,
              perUnit: 9,
              life: [300, 550],
              speed: [0, 0.3],
              direction: 'sphere',
              spawnRadius: 0.25,
              spawnHeight: [-0.2, 0.2],
              gravity: 0,
              drag: 2,
              size: [0.5, 0.05],
              color: [c.color, c.color],
              alpha: [0.55, 0],
            }),
          ],
  },
  burst: {
    color: '#ffd166',
    durationMs: 1200,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [createRing(c, { color: c.color, opacity: 0.9, scale: 2.8, motion: 'fade' })]
        : burstParts(c),
  },
  fire: {
    color: '#ff7a1a',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticHalo(c)]
        : [
            createHalo(c, { color: c.color, opacity: 0.45, scale: 3, motion: 'pulse' }),
            emitter(c, {
              texture: 'soft',
              blending: 'additive',
              burst: 10,
              rate: 70,
              life: [550, 1000],
              speed: [0.6, 1.6],
              direction: 'up',
              spawnRadius: 0.8,
              spawnHeight: [-0.5, 0.3],
              gravity: 3,
              drag: 1.2,
              size: [0.42, 0.08],
              color: [mix(c.color, new Color('#ffe08a'), 0.6), darken(c.color, 0.45)],
              alpha: [0.95, 0],
            }),
          ],
  },
  frost: {
    color: '#8fd8ff',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticHalo(c)]
        : [
            createHalo(c, { color: c.color, opacity: 0.4, scale: 3, motion: 'pulse' }),
            emitter(c, {
              texture: 'spark',
              blending: 'additive',
              burst: 8,
              rate: 40,
              life: [900, 1500],
              speed: [0.2, 0.6],
              direction: 'down',
              spawnRadius: 1.1,
              spawnHeight: [1.1, 1.8],
              gravity: -0.8,
              drag: 0.6,
              size: [0.22, 0.12],
              color: [mix(c.color, white, 0.6), c.color],
              alpha: [0.95, 0],
            }),
          ],
  },
  lightning: {
    color: '#c9b8ff',
    durationMs: 2000,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticHalo(c)]
        : [
            createHalo(c, { color: c.color, opacity: 0.45, scale: 3, motion: 'pulse' }),
            emitter(c, {
              texture: 'spark',
              blending: 'additive',
              burst: 12,
              rate: 55,
              life: [120, 280],
              speed: [4, 9],
              direction: 'sphere',
              spawnRadius: 0.6,
              spawnHeight: [-0.3, 0.4],
              gravity: 0,
              drag: 6,
              size: [0.2, 0.04],
              color: [mix(c.color, white, 0.7), c.color],
              alpha: [1, 0.1],
            }),
          ],
  },
  critical: {
    color: '#ffc83d',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticRing(c), staticHalo(c, 0.7)]
        : [
            ...burstParts(c),
            createHalo(c, { color: c.color, opacity: 0.8, scale: 3.4, motion: 'pulse' }),
            createRing(c, { color: c.color, opacity: 1, scale: 2.8, motion: 'pulse' }),
          ],
  },
  failure: {
    color: '#c0392b',
    durationMs: 2500,
    phase: 'rest',
    build: (c) =>
      c.level === 'reduced'
        ? [staticRing(c, 0.85)]
        : [
            createRing(c, { color: c.color, opacity: 0.85, scale: 2.6, motion: 'pulse' }),
            createHalo(c, { color: c.color, opacity: 0.3, scale: 3, motion: 'pulse' }),
            emitter(c, {
              texture: 'smoke',
              blending: 'normal',
              burst: 10,
              rate: 30,
              life: [1100, 1700],
              speed: [0.3, 0.8],
              direction: 'ring',
              spawnRadius: 0.7,
              spawnHeight: [0.3, 0.8],
              gravity: -0.9,
              drag: 0.9,
              size: [0.55, 1.3],
              // Cinza avermelhado, para aparecer também sobre mapas escuros.
              color: [new Color('#6b5856'), new Color('#2e2626')],
              alpha: [0.75, 0],
            }),
          ],
  },
};
