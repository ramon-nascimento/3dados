import type { Color } from 'three';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector2,
  type Object3D,
} from 'three';
import type { Vec3 } from '../core/math';
import { randomFloat, type RandomSource } from '../core/random';
import type { EffectResources, EffectTextureKind } from './resources';

/** O que cada parte recebe a cada quadro. */
export interface PartFrame {
  /** Milissegundos desde o início do efeito. */
  elapsed: number;
  /** Milissegundos desde o quadro anterior. */
  dt: number;
  /** Posição atual do alvo (centro do dado ou ponto). `undefined`: o alvo sumiu. */
  anchor: Vec3 | undefined;
}

/** Peça de um efeito: um objeto do three com seu próprio ciclo de vida. */
export interface EffectPart {
  readonly object: Object3D;
  /** Muda a cada quadro. Peças paradas não mantêm o laço de render ligado. */
  readonly animated: boolean;
  /** Partículas vivas desta peça. */
  readonly particles: number;
  /** Avança um quadro. Devolve `false` quando terminou. */
  update(frame: PartFrame): boolean;
  dispose(): void;
}

/** Quantas partículas ainda cabem no teto global. */
export interface ParticleBudget {
  take(wanted: number): number;
  give(count: number): void;
}

/** Contexto comum para criar as peças. */
export interface PartContext {
  resources: EffectResources;
  /** Tamanho do alvo, em unidades (raio do dado; 1 para um ponto). */
  radius: number;
  durationMs: number;
  intensity: number;
  rng: RandomSource;
  budget: ParticleBudget;
}

const FADE_IN_MS = 150;
const FADE_OUT_MS = 400;
/** Altura do anel sobre a mesa, para não disputar profundidade com a sombra. */
const RING_HEIGHT = 0.02;

/** Entrada e saída suaves dentro da duração. */
export function envelope(elapsed: number, duration: number): number {
  const fadeIn = Math.min(elapsed / FADE_IN_MS, 1);
  const fadeOut = Math.min(Math.max((duration - elapsed) / FADE_OUT_MS, 0), 1);
  return Math.min(fadeIn, fadeOut);
}

/** Variação lenta, de 0 a 1, com período em milissegundos. */
function pulse(elapsed: number, periodMs: number): number {
  return 0.5 - 0.5 * Math.cos((elapsed / periodMs) * Math.PI * 2);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Como uma peça plana (anel ou halo) se comporta no tempo.
 * - `pulse`: entra, pulsa devagar e sai (nível `full`).
 * - `static`: aparece pronta e some no fim, sem mudar (nível `reduced`).
 * - `fade`: aparece e perde opacidade até o fim, sem se mover.
 * - `flash`: clarão curto, ~180 ms.
 */
export type PlateMotion = 'pulse' | 'static' | 'fade' | 'flash';

interface PlateOptions {
  color: Color;
  /** Opacidade máxima. */
  opacity: number;
  /** Tamanho em múltiplos do raio do alvo. */
  scale: number;
  motion: PlateMotion;
}

const FLASH_MS = 180;

function plateOpacity(motion: PlateMotion, elapsed: number, duration: number, max: number) {
  switch (motion) {
    case 'static':
      return max;
    case 'fade':
      return max * Math.max(1 - elapsed / duration, 0);
    case 'flash':
      return max * Math.max(1 - elapsed / FLASH_MS, 0) ** 2;
    case 'pulse':
      return max * envelope(elapsed, duration) * lerp(0.6, 1, pulse(elapsed, 1400));
  }
}

/**
 * Opacidade máxima e tamanho de uma peça plana com a intensidade do disparo:
 * a opacidade cresce até 1 e o tamanho varia de 0,75 a 1,25 vez (intensidade 0 a 2).
 */
function plateStrength(context: PartContext, options: PlateOptions) {
  const intensity = context.intensity;
  return {
    opacity: Math.min(options.opacity * intensity, 1),
    size: context.radius * options.scale * (0.75 + 0.25 * intensity),
  };
}

function plateDuration(motion: PlateMotion, duration: number) {
  return motion === 'flash' ? Math.min(FLASH_MS, duration) : duration;
}

/** Anel deitado na mesa, sob o alvo: o destaque de um dado. */
export function createRing(context: PartContext, options: PlateOptions): EffectPart {
  const { resources, durationMs } = context;
  const { opacity, size } = plateStrength(context, options);
  const texture = resources.acquireTexture('ring');
  const geometry = resources.track(new PlaneGeometry(1, 1));
  geometry.rotateX(-Math.PI / 2);
  const material = resources.track(
    new MeshBasicMaterial({
      map: texture,
      color: options.color,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity,
    }),
  );
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 1;
  mesh.scale.setScalar(size);
  const duration = plateDuration(options.motion, durationMs);
  return {
    object: mesh,
    animated: options.motion !== 'static',
    particles: 0,
    update({ elapsed, anchor }) {
      if (elapsed >= duration || !anchor) return false;
      mesh.position.set(anchor.x, RING_HEIGHT, anchor.z);
      material.opacity = plateOpacity(options.motion, elapsed, duration, opacity);
      if (options.motion === 'pulse')
        mesh.scale.setScalar(size * lerp(0.94, 1.06, pulse(elapsed, 1400)));
      return true;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      resources.releaseTexture('ring');
    },
  };
}

/** Halo aditivo voltado para a câmera, no centro do alvo: brilho e clarão. */
export function createHalo(context: PartContext, options: PlateOptions): EffectPart {
  const { resources, durationMs } = context;
  const { opacity, size } = plateStrength(context, options);
  const texture = resources.acquireTexture('soft');
  const material = resources.track(
    new SpriteMaterial({
      map: texture,
      color: options.color,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity,
    }),
  );
  // O `Sprite` usa uma geometria interna do three, compartilhada e nunca liberada.
  const sprite = new Sprite(material);
  sprite.renderOrder = 2;
  sprite.scale.setScalar(size);
  const duration = plateDuration(options.motion, durationMs);
  return {
    object: sprite,
    animated: options.motion !== 'static',
    particles: 0,
    update({ elapsed, anchor }) {
      if (elapsed >= duration || !anchor) return false;
      sprite.position.set(anchor.x, anchor.y, anchor.z);
      material.opacity = plateOpacity(options.motion, elapsed, duration, opacity);
      return true;
    },
    dispose() {
      sprite.removeFromParent();
      material.dispose();
      resources.releaseTexture('soft');
    },
  };
}

/** De onde e para onde as partículas saem. */
export type EmitDirection = 'sphere' | 'up' | 'down' | 'ring';

export interface EmitterSpec {
  texture: EffectTextureKind;
  blending: 'additive' | 'normal';
  /** Partículas lançadas de uma vez no início. */
  burst: number;
  /** Partículas por segundo enquanto emite. */
  rate: number;
  /** Até quando emite, em milissegundos; depois, só deixa as vivas se apagarem. */
  emitUntil: number;
  /** Rastro: emite conforme o alvo anda (partículas por unidade), não por tempo. */
  perUnit?: number;
  /** Vida de cada partícula, em ms. */
  life: readonly [number, number];
  /** Velocidade inicial, em unidades por segundo. */
  speed: readonly [number, number];
  direction: EmitDirection;
  /** Raio do disco de nascimento, em múltiplos do raio do alvo. */
  spawnRadius: number;
  /** Altura de nascimento acima do centro, em múltiplos do raio. */
  spawnHeight: readonly [number, number];
  /** Aceleração vertical, em unidades/s² (positivo sobe). */
  gravity: number;
  /** Amortecimento da velocidade, por segundo. */
  drag: number;
  /** Tamanho no início e no fim da vida, em múltiplos do raio. */
  size: readonly [number, number];
  color: readonly [Color, Color];
  alpha: readonly [number, number];
}

const VERTEX_SHADER = /* glsl */ `
attribute float size;
attribute vec4 tint;
uniform float pixelScale;
varying vec4 vTint;
void main() {
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelScale / -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
varying vec4 vTint;
void main() {
  vec4 texel = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint.rgb, vTint.a * texel.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Campos por partícula no buffer de estado. */
const STATE = 9; // x, y, z, vx, vy, vz, idade, vida, escala

const drawingSize = new Vector2();
/** Deslocamento por quadro abaixo do qual o alvo do rastro conta como parado. */
const TRAIL_STILL_DISTANCE = 0.002;
/** Tempo parado que encerra o rastro, em ms. */
const TRAIL_REST_MS = 300;

/** Emissor de partículas: um `Points` com buffers de tamanho fixo. */
export function createEmitter(context: PartContext, spec: EmitterSpec): EffectPart {
  const { resources, radius, rng, budget } = context;
  const intensity = context.intensity;
  const lifeMax = spec.life[1];
  const capacity = Math.max(
    1,
    Math.ceil(
      spec.burst * intensity + (spec.rate * intensity * Math.min(spec.emitUntil, lifeMax)) / 1000,
    ) + (spec.perUnit ? Math.ceil(spec.perUnit * 40 * intensity) : 0),
  );

  const texture = resources.acquireTexture(spec.texture);
  const geometry = resources.track(new BufferGeometry());
  const positions = new Float32Array(capacity * 3);
  const tints = new Float32Array(capacity * 4);
  const sizes = new Float32Array(capacity);
  const positionAttribute = new BufferAttribute(positions, 3);
  const tintAttribute = new BufferAttribute(tints, 4);
  const sizeAttribute = new BufferAttribute(sizes, 1);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('tint', tintAttribute);
  geometry.setAttribute('size', sizeAttribute);
  geometry.setDrawRange(0, 0);

  const material = resources.track(
    new ShaderMaterial({
      uniforms: { map: { value: texture }, pixelScale: { value: 1 } },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: spec.blending === 'additive' ? AdditiveBlending : NormalBlending,
    }),
  );
  const points = new Points(geometry, material);
  // As partículas se espalham: o volume de recorte mudaria a cada quadro.
  points.frustumCulled = false;
  points.renderOrder = 3;
  // Tamanho em unidades do mundo convertido em pixels, com a câmera do quadro.
  points.onBeforeRender = (renderer, _scene, camera) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    renderer.getDrawingBufferSize(drawingSize);
    material.uniforms.pixelScale!.value =
      drawingSize.y / (2 * Math.tan((camera.fov * Math.PI) / 180 / 2));
  };

  const state = new Float32Array(capacity * STATE);
  let alive = 0;
  let carry = 0;
  let started = false;
  let last: Vec3 | undefined;
  /** Rastro: se o alvo já andou e há quanto tempo está parado. */
  let hasMoved = false;
  let stillFor = 0;
  const between = (range: readonly [number, number]) => lerp(range[0], range[1], randomFloat(rng));

  const spawn = (count: number, anchor: Vec3) => {
    const allowed = budget.take(Math.min(count, capacity - alive));
    for (let n = 0; n < allowed; n++) {
      const i = alive++ * STATE;
      const angle = randomFloat(rng) * Math.PI * 2;
      const distance = Math.sqrt(randomFloat(rng)) * spec.spawnRadius * radius;
      state[i] = anchor.x + Math.cos(angle) * distance;
      state[i + 1] = anchor.y + between(spec.spawnHeight) * radius;
      state[i + 2] = anchor.z + Math.sin(angle) * distance;
      let dx: number;
      let dy: number;
      let dz: number;
      switch (spec.direction) {
        case 'sphere': {
          // Hemisfério de cima: nada atravessa a mesa.
          const u = randomFloat(rng);
          const t = randomFloat(rng) * Math.PI * 2;
          const s = Math.sqrt(1 - u * u);
          [dx, dy, dz] = [Math.cos(t) * s, u, Math.sin(t) * s];
          break;
        }
        case 'up':
          [dx, dy, dz] = [(randomFloat(rng) - 0.5) * 0.5, 1, (randomFloat(rng) - 0.5) * 0.5];
          break;
        case 'down':
          [dx, dy, dz] = [(randomFloat(rng) - 0.5) * 0.4, -1, (randomFloat(rng) - 0.5) * 0.4];
          break;
        case 'ring':
          [dx, dy, dz] = [Math.cos(angle), 0.15, Math.sin(angle)];
          break;
      }
      const length = Math.hypot(dx, dy, dz) || 1;
      const speed = between(spec.speed);
      state[i + 3] = (dx / length) * speed;
      state[i + 4] = (dy / length) * speed;
      state[i + 5] = (dz / length) * speed;
      state[i + 6] = 0;
      state[i + 7] = between(spec.life);
      state[i + 8] = lerp(0.7, 1.3, randomFloat(rng));
    }
  };

  const write = () => {
    const [c0, c1] = spec.color;
    for (let p = 0; p < alive; p++) {
      const i = p * STATE;
      const t = Math.min(state[i + 6]! / state[i + 7]!, 1);
      positions[p * 3] = state[i]!;
      positions[p * 3 + 1] = state[i + 1]!;
      positions[p * 3 + 2] = state[i + 2]!;
      tints[p * 4] = lerp(c0.r, c1.r, t);
      tints[p * 4 + 1] = lerp(c0.g, c1.g, t);
      tints[p * 4 + 2] = lerp(c0.b, c1.b, t);
      tints[p * 4 + 3] = Math.min(
        lerp(spec.alpha[0], spec.alpha[1], t) * Math.max(intensity, 0.35),
        1,
      );
      sizes[p] = lerp(spec.size[0], spec.size[1], t) * radius * state[i + 8]!;
    }
    geometry.setDrawRange(0, alive);
    positionAttribute.needsUpdate = true;
    tintAttribute.needsUpdate = true;
    sizeAttribute.needsUpdate = true;
  };

  return {
    object: points,
    animated: true,
    get particles() {
      return alive;
    },
    update({ elapsed, dt, anchor }) {
      const seconds = dt / 1000;
      // Envelhece e move as vivas; as que morrem trocam de lugar com a última.
      const damping = Math.exp(-spec.drag * seconds);
      for (let p = 0; p < alive;) {
        const i = p * STATE;
        state[i + 6] = state[i + 6]! + dt;
        if (state[i + 6]! >= state[i + 7]!) {
          alive--;
          state.copyWithin(i, alive * STATE, alive * STATE + STATE);
          budget.give(1);
          continue;
        }
        state[i + 3] = state[i + 3]! * damping;
        state[i + 4] = state[i + 4]! * damping + spec.gravity * seconds;
        state[i + 5] = state[i + 5]! * damping;
        state[i] = state[i]! + state[i + 3]! * seconds;
        state[i + 1] = Math.max(state[i + 1]! + state[i + 4]! * seconds, 0.02);
        state[i + 2] = state[i + 2]! + state[i + 5]! * seconds;
        p++;
      }

      // O rastro se encerra quando o dado, depois de andar, fica parado.
      const resting = spec.perUnit !== undefined && hasMoved && stillFor > TRAIL_REST_MS;
      const emitting = elapsed < spec.emitUntil && anchor !== undefined && !resting;
      if (emitting) {
        if (!started) {
          started = true;
          spawn(Math.round(spec.burst * intensity), anchor);
        }
        if (spec.perUnit !== undefined) {
          // Rastro: só nasce partícula onde o alvo passou.
          if (last) {
            const moved = Math.hypot(anchor.x - last.x, anchor.y - last.y, anchor.z - last.z);
            carry += moved * spec.perUnit * intensity;
            if (moved > TRAIL_STILL_DISTANCE) {
              hasMoved = true;
              stillFor = 0;
            } else {
              stillFor += dt;
            }
          }
          last = { ...anchor };
        } else {
          carry += spec.rate * intensity * seconds;
        }
        const count = Math.floor(carry);
        carry -= count;
        if (count > 0) spawn(count, anchor);
      }
      write();
      return emitting || alive > 0;
    },
    dispose() {
      points.removeFromParent();
      budget.give(alive);
      alive = 0;
      geometry.dispose();
      material.dispose();
      resources.releaseTexture(spec.texture);
    },
  };
}
