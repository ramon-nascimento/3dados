import type { TextureKind } from '../customization/theme';

/** Cor RGB, de 0 a 255 por canal. */
export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Inteiro pseudoaleatório de 32 bits a partir de coordenadas inteiras. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

function lattice(x: number, y: number, periodX: number, periodY: number, seed: number): number {
  return hash(wrap(x, periodX), wrap(y, periodY), seed) / 0x100000000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Ruído de valor periódico: `u` e `v` de 0 a 1 dão uma volta completa, então
 * a imagem se repete sem emenda. Os períodos são a quantidade de células da
 * grade em cada eixo; períodos diferentes esticam o ruído.
 */
function valueNoise(
  u: number,
  v: number,
  periodX: number,
  seed: number,
  periodY: number = periodX,
): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = lattice(x0, y0, periodX, periodY, seed);
  const b = lattice(x0 + 1, y0, periodX, periodY, seed);
  const c = lattice(x0, y0 + 1, periodX, periodY, seed);
  const d = lattice(x0 + 1, y0 + 1, periodX, periodY, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Soma de oitavas de ruído, normalizada para 0 a 1. Continua periódica. */
function fbm(u: number, v: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u, v, period << o, seed + o * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum / total;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function smoothstep(edge0: number, edge1: number, t: number): number {
  return smooth(clamp01((t - edge0) / (edge1 - edge0)));
}

/** Quanto da cor secundária entra em cada ponto do padrão (0 a 1). */
type Blend = (u: number, v: number, seed: number) => number;

const BLENDS: Record<Exclude<TextureKind, 'none' | 'speckle'>, Blend> = {
  // Veios finos e sinuosos sobre uma base levemente nublada.
  marble: (u, v, seed) => {
    const warp = fbm(u, v, 4, 5, seed);
    const vein = 1 - Math.abs(Math.sin(Math.PI * (2 * u + v + 3 * warp)));
    const cloud = fbm(u, v, 3, 3, seed + 7);
    return clamp01(Math.pow(vein, 10) * 0.9 + (cloud - 0.5) * 0.25);
  },
  // Anéis de crescimento deformados, com fibras ao longo do veio.
  'wood-grain': (u, v, seed) => {
    const warp = fbm(u, v, 3, 4, seed);
    const rings = 0.5 + 0.5 * Math.sin(2 * Math.PI * (5 * v + 1.8 * warp));
    // Fibras compridas: poucas células na direção do veio, muitas na outra.
    const fiber = valueNoise(u, v, 4, seed + 3, 96);
    return clamp01(Math.pow(rings, 2.5) * 0.7 + fiber * 0.3);
  },
  // Manchas irregulares com poros escuros.
  stone: (u, v, seed) => {
    const body = smoothstep(0.38, 0.68, fbm(u, v, 4, 6, seed));
    const pores = smoothstep(0.78, 0.9, valueNoise(u, v, 48, seed + 11));
    return clamp01(body * 0.75 + pores * 0.6);
  },
};

/**
 * Gera, em RGBA, um ladrilho quadrado do padrão que se repete sem emenda.
 * Determinístico: a mesma entrada dá sempre os mesmos pixels, em qualquer máquina.
 */
export function generatePatternPixels(
  kind: Exclude<TextureKind, 'none'>,
  size: number,
  primary: Rgb,
  secondary: Rgb,
  seed: number,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const mix = (index: number, t: number) => {
    for (let c = 0; c < 3; c++) {
      pixels[index + c] = primary[c]! + (secondary[c]! - primary[c]!) * t;
    }
    pixels[index + 3] = 255;
  };

  if (kind === 'speckle') {
    for (let i = 0; i < size * size; i++) mix(i * 4, 0);
    // Pontos de tamanhos variados; os que passam da borda continuam do outro lado.
    const count = Math.round((size * size) / 160);
    for (let n = 0; n < count; n++) {
      const cx = (hash(n, 1, seed) / 0x100000000) * size;
      const cy = (hash(n, 2, seed) / 0x100000000) * size;
      const radius = 0.7 + (hash(n, 3, seed) / 0x100000000) * 1.6;
      const strength = 0.65 + (hash(n, 4, seed) / 0x100000000) * 0.35;
      const reach = Math.ceil(radius + 1);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const px = Math.floor(cx) + dx;
          const py = Math.floor(cy) + dy;
          const distance = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
          const coverage = clamp01(radius + 0.5 - distance) * strength;
          if (coverage <= 0) continue;
          const x = ((px % size) + size) % size;
          const y = ((py % size) + size) % size;
          const index = (y * size + x) * 4;
          for (let c = 0; c < 3; c++) {
            pixels[index + c] =
              pixels[index + c]! + (secondary[c]! - pixels[index + c]!) * coverage;
          }
        }
      }
    }
    return pixels;
  }

  const blend = BLENDS[kind];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      mix((y * size + x) * 4, blend((x + 0.5) / size, (y + 0.5) / size, seed));
    }
  }
  return pixels;
}
