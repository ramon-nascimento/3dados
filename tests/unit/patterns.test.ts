import { describe, expect, it } from 'vitest';
import { generatePatternPixels, hexToRgb, type Rgb } from '../../src/renderer/patterns';

const SIZE = 64;
const PRIMARY: Rgb = [200, 150, 100];
const SECONDARY: Rgb = [40, 20, 10];
const KINDS = ['speckle', 'marble', 'wood-grain', 'stone'] as const;

/** Diferença média, por canal, entre duas colunas (ou linhas) de pixels. */
function lineDifference(pixels: Uint8ClampedArray, a: number, b: number, vertical: boolean) {
  let sum = 0;
  for (let i = 0; i < SIZE; i++) {
    const [x1, y1, x2, y2] = vertical ? [a, i, b, i] : [i, a, i, b];
    for (let c = 0; c < 3; c++) {
      sum += Math.abs(pixels[(y1 * SIZE + x1) * 4 + c]! - pixels[(y2 * SIZE + x2) * 4 + c]!);
    }
  }
  return sum / (SIZE * 3);
}

describe('padrões procedurais', () => {
  it('converte cores hexadecimais', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#0a0b0c')).toEqual([10, 11, 12]);
  });

  it.each(KINDS)('%s: determinístico, opaco e entre as duas cores', (kind) => {
    const a = generatePatternPixels(kind, SIZE, PRIMARY, SECONDARY, 7);
    const b = generatePatternPixels(kind, SIZE, PRIMARY, SECONDARY, 7);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i += 4) {
      expect(a[i + 3]).toBe(255);
      for (let c = 0; c < 3; c++) {
        const low = Math.min(PRIMARY[c]!, SECONDARY[c]!);
        const high = Math.max(PRIMARY[c]!, SECONDARY[c]!);
        expect(a[i + c]).toBeGreaterThanOrEqual(low);
        expect(a[i + c]).toBeLessThanOrEqual(high);
      }
    }
  });

  it.each(KINDS)('%s: usa as duas cores e muda com a semente', (kind) => {
    const a = generatePatternPixels(kind, SIZE, PRIMARY, SECONDARY, 1);
    const b = generatePatternPixels(kind, SIZE, PRIMARY, SECONDARY, 2);
    expect(a).not.toEqual(b);
    const reds = new Set<number>();
    for (let i = 0; i < a.length; i += 4) reds.add(a[i]!);
    expect(reds.size).toBeGreaterThan(8);
  });

  it.each(KINDS)('%s: repete sem emenda nas bordas', (kind) => {
    const pixels = generatePatternPixels(kind, SIZE, PRIMARY, SECONDARY, 3);
    for (const vertical of [true, false]) {
      // A emenda (última linha → primeira) não destoa mais que o pior par de
      // linhas vizinhas do interior.
      const seam = lineDifference(pixels, SIZE - 1, 0, vertical);
      let worst = 0;
      for (let i = 0; i < SIZE - 1; i++) {
        worst = Math.max(worst, lineDifference(pixels, i, i + 1, vertical));
      }
      expect(seam).toBeLessThanOrEqual(worst);
    }
  });

  it('padrões diferentes dão imagens diferentes', () => {
    const images = KINDS.map((kind) =>
      generatePatternPixels(kind, SIZE, PRIMARY, SECONDARY, 5).join(','),
    );
    expect(new Set(images).size).toBe(KINDS.length);
  });
});
