import { DiceError } from '../core/errors';
import type { AtlasLayout } from './die-mesh-data';

export interface LabelStyle {
  /** Cor de fundo das faces. */
  background: string;
  /** Cor dos números. */
  foreground: string;
  fontFamily: string;
  /** Lado de cada célula, em pixels. */
  cellSize: number;
}

/** Textos com dois ou mais caracteres são reduzidos para caber na mesma área. */
const MULTI_CHARACTER_SCALE = 0.8;

/** Desenha o atlas de rótulos: uma célula por face, com seus textos posicionados e girados. */
export function paintLabelAtlas(layout: AtlasLayout, style: LabelStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = layout.columns * style.cellSize;
  canvas.height = layout.rows * style.cellSize;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new DiceError('UNSUPPORTED_ENVIRONMENT', 'Canvas 2D não está disponível.');
  }

  context.fillStyle = style.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = style.foreground;
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

  return canvas;
}
