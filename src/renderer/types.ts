/**
 * Tipos públicos do renderer, sem dependência do three. Ficam fora de
 * `dice-renderer.ts` para que as declarações publicadas (`.d.ts`) não exijam
 * `@types/three` de quem usa a biblioteca.
 */

/** Qualidade efetiva do render. */
export type RenderQuality = 'low' | 'medium' | 'high';

export type QualitySetting = RenderQuality | 'auto';

export type Presentation = 'overlay' | 'tray';

/** Faixa aceita de `maxFps`. */
export const MAX_FPS_LIMITS = { min: 10, max: 240 } as const;

/**
 * Objeto que outro módulo coloca na cena (o grupo dos efeitos): um `Object3D`
 * do three, visto de fora só pelo que o identifica.
 */
export interface SceneObject {
  readonly isObject3D: true;
}

/** Resumo de uma série de tempos medidos, em milissegundos. */
export interface TimingSummary {
  /** Mediana. */
  p50: number;
  /** Percentil 95. */
  p95: number;
  max: number;
}

/**
 * Medições de um trecho contínuo de animação: do instante em que o laço de
 * render liga (uma rolagem ou um efeito começa) até ele desligar.
 */
export interface FrameSession {
  /** Quadros desenhados no trecho. */
  frames: number;
  /** Tempo entre o primeiro e o último quadro medido, em milissegundos. */
  durationMs: number;
  /** Quadros por segundo: intervalos medidos sobre a soma deles. */
  fps: number;
  /** Intervalo entre quadros desenhados. */
  frameMs: TimingSummary;
  /**
   * Tempo de CPU por quadro: atualizar a cena e emitir os comandos de desenho.
   * Não inclui o trabalho da GPU, que o navegador não deixa medir.
   */
  cpuMs: TimingSummary;
}

/** Medições do render. Todos os valores são medidos ou contados, nunca estimados. */
export interface RenderStats {
  /** O laço de render está ligado. */
  active: boolean;
  /** Quadros desenhados pelo laço desde a criação do motor. */
  frames: number;
  /** O trecho de animação em curso, ou `null` com o laço parado ou sem dois quadros ainda. */
  current: FrameSession | null;
  /** O último trecho de animação encerrado, ou `null` antes do primeiro. */
  lastSession: FrameSession | null;
  /** Chamadas de desenho do último quadro (inclui a passada de sombras). */
  drawCalls: number;
  /** Triângulos do último quadro. */
  triangles: number;
  /** Geometrias vivas na GPU, pela contagem do three. */
  geometries: number;
  /** Texturas vivas na GPU, pela contagem do three. */
  textures: number;
  /** Tamanho do canvas em pixels do dispositivo e a densidade de pixels aplicada. */
  canvas: { width: number; height: number; pixelRatio: number };
  /** Qualidade efetiva. */
  quality: RenderQuality;
  /** Qualidade pedida na criação. */
  qualitySetting: QualitySetting;
  /** Teto de quadros por segundo, ou `null` (taxa do monitor). */
  maxFps: number | null;
  context: 'active' | 'lost';
  /** Vezes em que o contexto gráfico foi perdido. */
  contextLosses: number;
  /** Vezes em que ele voltou. */
  contextRestores: number;
  /** Vezes em que a qualidade automática desceu um nível. */
  qualityDrops: number;
}

/** O que o renderer avisa a quem o usa. */
export type RendererEvent =
  | { type: 'contextLost' }
  | { type: 'contextRestored'; lostForMs: number }
  | {
      type: 'qualityChanged';
      from: RenderQuality;
      to: RenderQuality;
      /** Quadros por segundo do trecho de animação que motivou a mudança. */
      fps: number;
      /** Intervalo entre quadros desse trecho. */
      frameMs: TimingSummary;
    };
