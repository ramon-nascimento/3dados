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

/** Desenha o atlas de rótulos: uma célula por face, com o texto centralizado. */
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
  context.font = `700 ${Math.round(style.cellSize * 0.62)}px ${style.fontFamily}`;

  layout.labels.forEach((label, index) => {
    const centerX = ((index % layout.columns) + 0.5) * style.cellSize;
    const centerY = (Math.floor(index / layout.columns) + 0.5) * style.cellSize;
    // Centraliza pela caixa real do glifo, não pela linha de base.
    const metrics = context.measureText(label);
    const baseline =
      centerY + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
    context.fillText(label, centerX, baseline);
  });

  return canvas;
}
