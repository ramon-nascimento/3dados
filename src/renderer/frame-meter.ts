import type { FrameSession, RenderQuality, TimingSummary } from './types';

/** Quadros iniciais de cada trecho fora da medição: compilam shaders e enviam texturas. */
export const WARMUP_FRAMES = 5;
/** Intervalos acima disto não são quadros lentos: a aba estava em segundo plano. */
export const MAX_FRAME_INTERVAL_MS = 1000;
/** Amostras guardadas por trecho; passando disso, as mais antigas saem. */
const MAX_SAMPLES = 4096;

/** Mediana, percentil 95 e máximo de uma série. Série vazia: zeros. */
export function summarize(values: readonly number[]): TimingSummary {
  if (values.length === 0) return { p50: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! };
}

/**
 * Mede os quadros de um trecho de animação: o intervalo entre quadros
 * desenhados e o tempo de CPU de cada um. Não conhece o navegador: recebe os
 * instantes de quem o usa.
 */
export class FrameMeter {
  private open = false;
  /** Quadros recebidos no trecho, inclusive os de aquecimento. */
  private seen = 0;
  private previous: number | undefined;
  private intervals: number[] = [];
  private cpu: number[] = [];

  /** Abre um trecho. Um trecho já aberto é descartado. */
  begin(): void {
    this.open = true;
    this.seen = 0;
    this.previous = undefined;
    this.intervals = [];
    this.cpu = [];
  }

  /** Registra um quadro desenhado no instante `time`, que custou `cpuMs` de CPU. */
  frame(time: number, cpuMs: number): void {
    if (!this.open) return;
    this.seen++;
    const previous = this.previous;
    this.previous = time;
    if (this.seen <= WARMUP_FRAMES || previous === undefined) return;
    const interval = time - previous;
    if (interval <= 0 || interval > MAX_FRAME_INTERVAL_MS) return;
    if (this.intervals.length >= MAX_SAMPLES) {
      this.intervals.splice(0, MAX_SAMPLES / 2);
      this.cpu.splice(0, MAX_SAMPLES / 2);
    }
    this.intervals.push(interval);
    this.cpu.push(cpuMs);
  }

  /** Esquece o quadro anterior: o próximo intervalo não é medido (houve uma pausa). */
  skipNextInterval(): void {
    this.previous = undefined;
  }

  /** As medições do trecho até aqui, ou `null` sem nenhum intervalo medido. */
  snapshot(): FrameSession | null {
    if (!this.open || this.intervals.length === 0) return null;
    const durationMs = this.intervals.reduce((sum, value) => sum + value, 0);
    return {
      frames: this.seen,
      durationMs,
      fps: (1000 * this.intervals.length) / durationMs,
      frameMs: summarize(this.intervals),
      cpuMs: summarize(this.cpu),
    };
  }

  /** Fecha o trecho e devolve as medições dele. */
  end(): FrameSession | null {
    const session = this.snapshot();
    this.open = false;
    return session;
  }
}

/** Folga, em ms, para o relógio do navegador não derrubar um quadro que chegou na hora. */
const PACER_TOLERANCE_MS = 1;

/**
 * Limita a taxa de quadros: diz, a cada quadro oferecido pelo navegador, se
 * ele deve ser desenhado. Sem limite, aceita todos.
 */
export class FramePacer {
  private readonly intervalMs: number;
  private last: number | undefined;

  constructor(maxFps: number | undefined) {
    this.intervalMs = maxFps === undefined ? 0 : 1000 / maxFps;
  }

  accept(time: number): boolean {
    if (this.intervalMs === 0) return true;
    if (this.last === undefined) {
      this.last = time;
      return true;
    }
    const elapsed = time - this.last;
    if (elapsed < this.intervalMs - PACER_TOLERANCE_MS) return false;
    // Avança um intervalo exato, para a média bater com o teto mesmo quando a
    // taxa do monitor não é múltipla dele; depois de uma pausa longa, recomeça.
    this.last = elapsed >= 2 * this.intervalMs ? time : this.last + this.intervalMs;
    return true;
  }

  reset(): void {
    this.last = undefined;
  }
}

/**
 * Intervalo médio entre quadros, em ms, acima do qual uma animação conta como
 * lenta: 25 quadros por segundo.
 */
export const SLOW_FRAME_MS = 40;
/** Quadros medidos e duração mínimos para um trecho dizer algo sobre a máquina. */
export const MIN_SESSION_SAMPLES = 10;
export const MIN_SESSION_MS = 500;
/** Trechos lentos seguidos antes de descer um nível. */
export const SLOW_SESSIONS_TO_DROP = 2;

const LOWER: Readonly<Record<RenderQuality, RenderQuality | undefined>> = {
  high: 'medium',
  medium: 'low',
  low: undefined,
};

/** Limite de animação lenta para um teto de quadros: o teto não pode parecer lentidão. */
export function slowFrameThreshold(maxFps: number | undefined): number {
  return maxFps === undefined ? SLOW_FRAME_MS : Math.max(SLOW_FRAME_MS, 1500 / maxFps + 5);
}

/**
 * Qualidade automática: desce um nível quando dois trechos de animação
 * seguidos ficam abaixo de 25 quadros por segundo (intervalo médio acima do
 * limite). A média, e não um percentil, porque uma animação lenta tem poucos
 * quadros: a 15 quadros por segundo, uma rolagem de 1,5 s tem cerca de 20, e
 * um único engasgo decidiria o percentil. Nunca sobe: a mesma máquina, com a
 * mesma cena, voltaria a ficar lenta.
 */
export class AdaptiveQuality {
  private level: RenderQuality;
  private readonly thresholdMs: number;
  private slowSessions = 0;

  constructor(level: RenderQuality, thresholdMs: number = SLOW_FRAME_MS) {
    this.level = level;
    this.thresholdMs = thresholdMs;
  }

  get quality(): RenderQuality {
    return this.level;
  }

  /** Recebe um trecho encerrado. Devolve o nível novo se for hora de descer. */
  observe(session: FrameSession): RenderQuality | undefined {
    const samples = Math.max(session.frames - WARMUP_FRAMES, 0);
    if (samples < MIN_SESSION_SAMPLES || session.durationMs < MIN_SESSION_MS) return undefined;
    if (1000 / session.fps <= this.thresholdMs) {
      this.slowSessions = 0;
      return undefined;
    }
    this.slowSessions++;
    const lower = LOWER[this.level];
    if (this.slowSessions < SLOW_SESSIONS_TO_DROP || lower === undefined) return undefined;
    this.slowSessions = 0;
    this.level = lower;
    return lower;
  }
}
