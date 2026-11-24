import { DiceError } from '../core/errors';
import type { TextureKind } from '../customization/theme';
import type { AtlasLayout } from './die-mesh-data';
import { generatePatternPixels, hexToRgb } from './patterns';

export interface AtlasStyle {
  /** Cor do corpo. */
  primary: string;
  /** Cor do padrão; com `texture: 'none'`, cor da célula do chanfro. */
  secondary: string;
  /** Cor dos números. */
  numbers: string;
  texture: TextureKind;
  /** Opacidade do corpo no atlas (0 a 1). Os números são sempre opacos. */
  bodyAlpha: number;
  fontFamily: string;
  /** Lado de cada célula, em pixels. */
  cellSize: number;
  /** Semente do padrão: dados diferentes do mesmo tema podem variar. */
  seed: number;
}

export interface PaintedAtlas {
  /** Cor e transparência de cada face. */
  color: HTMLCanvasElement;
  /** Números em branco sobre preto: base dos mapas de emissão, transmissão e metal. */
  mask: HTMLCanvasElement;
}

/** Textos com dois ou mais caracteres são reduzidos para caber na mesma área. */
const MULTI_CHARACTER_SCALE = 0.8;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new DiceError('UNSUPPORTED_ENVIRONMENT', 'Canvas 2D não está disponível.');
  }
  return context;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Ladrilho do padrão, do tamanho de uma célula, que se repete sem emenda. */
function patternTile(style: AtlasStyle): HTMLCanvasElement | undefined {
  if (style.texture === 'none') return undefined;
  const size = style.cellSize;
  const tile = createCanvas(size, size);
  const pixels = generatePatternPixels(
    style.texture,
    size,
    hexToRgb(style.primary),
    hexToRgb(style.secondary),
    style.seed,
  );
  context2d(tile).putImageData(new ImageData(pixels, size, size), 0, 0);
  return tile;
}

/** Desenha os números de todas as células com a cor atual de `context`. */
function drawLabels(
  context: CanvasRenderingContext2D,
  layout: AtlasLayout,
  style: AtlasStyle,
): void {
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  layout.cells.forEach((labels, index) => {
    const left = (index % layout.columns) * style.cellSize;
    const top = Math.floor(index / layout.columns) * style.cellSize;

    for (const label of labels) {
      const scale = label.text.length > 1 ? MULTI_CHARACTER_SCALE : 1;
      const fontSize = label.height * style.cellSize * scale;
      context.save();
      // `y` cresce para cima na célula e para baixo no canvas; daí os sinais.
      context.translate(left + label.x * style.cellSize, top + (1 - label.y) * style.cellSize);
      context.rotate(-label.angle);
      context.font = `700 ${fontSize.toFixed(1)}px ${style.fontFamily}`;
      // Centraliza pela caixa real do glifo, não pela linha de base.
      const metrics = context.measureText(label.text);
      const ascent = metrics.actualBoundingBoxAscent;
      const descent = metrics.actualBoundingBoxDescent;
      const baseline = (ascent - descent) / 2;
      context.fillText(label.text, 0, baseline);
      if (label.underline) {
        const width = metrics.width * 0.9;
        const thickness = Math.max(fontSize * 0.07, 1);
        context.fillRect(-width / 2, baseline + descent + fontSize * 0.08, width, thickness);
      }
      context.restore();
    }
  });
}

/**
 * Desenha o atlas de um dado: uma célula por face, com o corpo (cor lisa ou
 * padrão) e os números posicionados e girados, mais as células livres usadas
 * pelo chanfro. Devolve também a máscara dos números.
 */
export function paintAtlas(layout: AtlasLayout, style: AtlasStyle): PaintedAtlas {
  const width = layout.columns * style.cellSize;
  const height = layout.rows * style.cellSize;
  const color = createCanvas(width, height);
  const context = context2d(color);
  const faceCount = layout.cells.length;
  const tile = patternTile(style);

  context.globalAlpha = style.bodyAlpha;
  for (let index = 0; index < layout.columns * layout.rows; index++) {
    const left = (index % layout.columns) * style.cellSize;
    const top = Math.floor(index / layout.columns) * style.cellSize;
    if (tile) {
      // Cada célula pega um trecho diferente do padrão, para as faces não
      // parecerem carimbadas.
      const pattern = context.createPattern(tile, 'repeat');
      if (!pattern)
        throw new DiceError('UNSUPPORTED_ENVIRONMENT', 'Padrão de canvas indisponível.');
      const offset = (index * 0.618034) % 1;
      pattern.setTransform(
        new DOMMatrix().translate(
          left + offset * style.cellSize,
          top + ((index * 0.381966) % 1) * style.cellSize,
        ),
      );
      context.fillStyle = pattern;
    } else {
      context.fillStyle = index < faceCount ? style.primary : style.secondary;
    }
    context.fillRect(left, top, style.cellSize, style.cellSize);
  }
  context.globalAlpha = 1;
  context.fillStyle = style.numbers;
  drawLabels(context, layout, style);

  const mask = createCanvas(width, height);
  const maskContext = context2d(mask);
  maskContext.fillStyle = '#000000';
  maskContext.fillRect(0, 0, width, height);
  maskContext.fillStyle = '#ffffff';
  drawLabels(maskContext, layout, style);

  return { color, mask };
}

/** Cópia da máscara com as cores invertidas: corpo em branco, números em preto. */
export function invertMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  const inverted = createCanvas(mask.width, mask.height);
  const context = context2d(inverted);
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = 'difference';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, mask.width, mask.height);
  return inverted;
}
