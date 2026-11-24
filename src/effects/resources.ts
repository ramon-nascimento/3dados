import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { createSeededRandomSource, randomFloat } from '../core/random';

/** Texturas dos efeitos, todas geradas por código (sem arquivos de imagem). */
export type EffectTextureKind = 'soft' | 'ring' | 'spark' | 'smoke';

const TEXTURE_SIZE = 64;

/** Ruído de valor suave e periódico, para a fumaça não ser um disco perfeito. */
function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const rng = createSeededRandomSource(seed);
  const grid = Array.from({ length: cells * cells }, () => randomFloat(rng));
  const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]!;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const tx = gx - x0;
      const ty = gy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
      const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      out[y * size + x] = top * (1 - sy) + bottom * sy;
    }
  }
  return out;
}

/**
 * Alfa de cada textura em função da distância ao centro (`r` de 0 a 1, 1 na
 * borda). A cor é branca: quem colore é o material.
 */
export function textureAlpha(kind: EffectTextureKind, r: number, noise = 0.5): number {
  if (r >= 1) return 0;
  switch (kind) {
    case 'soft':
      return Math.exp(-r * r * 5) * (1 - r);
    case 'ring':
      return Math.exp(-(((r - 0.72) / 0.11) ** 2)) * (1 - r ** 8);
    case 'spark':
      return Math.min(1, (1 - r) ** 4 * 1.6 + Math.exp(-r * r * 60));
    case 'smoke':
      return Math.exp(-r * r * 3.5) * (1 - r) * (0.55 + 0.9 * noise);
  }
}

function createTexture(kind: EffectTextureKind): DataTexture {
  const size = TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const noise = kind === 'smoke' ? valueNoise(size, 6, 0x5eed) : undefined;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const alpha = textureAlpha(kind, r, noise?.[y * size + x]);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(Math.min(Math.max(alpha, 0), 1) * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

type Disposable = BufferGeometry | Material | Texture;

/**
 * Contabilidade dos recursos de GPU dos efeitos. Toda geometria, material e
 * textura criados passam por `track`; o evento `dispose` do three marca a
 * liberação. Assim os testes conferem, sem GPU, que nada ficou para trás.
 * As texturas são compartilhadas entre efeitos e liberadas quando o último
 * efeito que as usa termina.
 */
export class EffectResources {
  created = 0;
  disposed = 0;
  private readonly textures = new Map<EffectTextureKind, { texture: Texture; users: number }>();

  track<T extends Disposable>(resource: T): T {
    this.created++;
    let done = false;
    // Os três tipos aceitam o evento `dispose`; a união não tipa o método.
    (
      resource as unknown as { addEventListener(type: 'dispose', listener: () => void): void }
    ).addEventListener('dispose', () => {
      if (done) return;
      done = true;
      this.disposed++;
    });
    return resource;
  }

  acquireTexture(kind: EffectTextureKind): Texture {
    let entry = this.textures.get(kind);
    if (!entry) {
      entry = { texture: this.track(createTexture(kind)), users: 0 };
      this.textures.set(kind, entry);
    }
    entry.users++;
    return entry.texture;
  }

  releaseTexture(kind: EffectTextureKind): void {
    const entry = this.textures.get(kind);
    if (!entry) return;
    if (--entry.users <= 0) {
      this.textures.delete(kind);
      entry.texture.dispose();
    }
  }

  /** Recursos ainda vivos. */
  get live(): number {
    return this.created - this.disposed;
  }

  dispose(): void {
    for (const { texture } of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
