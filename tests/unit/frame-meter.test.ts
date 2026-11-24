import { describe, expect, it } from 'vitest';
import {
  AdaptiveQuality,
  FrameMeter,
  FramePacer,
  MAX_FRAME_INTERVAL_MS,
  MIN_SESSION_MS,
  MIN_SESSION_SAMPLES,
  SLOW_FRAME_MS,
  WARMUP_FRAMES,
  slowFrameThreshold,
  summarize,
} from '../../src/renderer/frame-meter';
import type { FrameSession } from '../../src/renderer/types';

/** Registra `count` quadros com `interval` ms entre eles, a partir de `start`. */
function feed(meter: FrameMeter, count: number, interval: number, start = 0, cpu = 1): number {
  let time = start;
  for (let i = 0; i < count; i++) {
    meter.frame(time, cpu);
    time += interval;
  }
  return time;
}

describe('summarize', () => {
  it('devolve mediana, percentil 95 e máximo', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(summarize(values)).toEqual({ p50: 51, p95: 96, max: 100 });
  });

  it('não depende da ordem e não altera a série', () => {
    const values = [30, 10, 20];
    expect(summarize(values)).toEqual({ p50: 20, p95: 30, max: 30 });
    expect(values).toEqual([30, 10, 20]);
  });

  it('série vazia dá zeros', () => {
    expect(summarize([])).toEqual({ p50: 0, p95: 0, max: 0 });
  });
});

describe('FrameMeter', () => {
  it('ignora quadros fora de um trecho', () => {
    const meter = new FrameMeter();
    feed(meter, 50, 16);
    expect(meter.snapshot()).toBeNull();
    expect(meter.end()).toBeNull();
  });

  it('mede o intervalo entre quadros e o tempo de CPU, depois do aquecimento', () => {
    const meter = new FrameMeter();
    meter.begin();
    // O aquecimento é lento (shaders): não pode entrar na medição.
    const afterWarmup = feed(meter, WARMUP_FRAMES, 200, 0, 150);
    expect(meter.snapshot()).toBeNull();
    feed(meter, 60, 20, afterWarmup, 3);
    const session = meter.end()!;
    expect(session.frames).toBe(WARMUP_FRAMES + 60);
    // O primeiro intervalo medido ainda vem do último quadro de aquecimento.
    expect(session.frameMs).toEqual({ p50: 20, p95: 20, max: 200 });
    expect(session.cpuMs).toEqual({ p50: 3, p95: 3, max: 3 });
    expect(session.durationMs).toBe(200 + 59 * 20);
    expect(session.fps).toBeCloseTo((1000 * 60) / (200 + 59 * 20), 6);
  });

  it('descarta intervalos de aba em segundo plano', () => {
    const meter = new FrameMeter();
    meter.begin();
    const next = feed(meter, WARMUP_FRAMES + 10, 16);
    feed(meter, 10, 16, next + MAX_FRAME_INTERVAL_MS + 5000);
    const session = meter.end()!;
    expect(session.frameMs.max).toBe(16);
    expect(session.frames).toBe(WARMUP_FRAMES + 20);
  });

  it('skipNextInterval não mede o intervalo seguinte', () => {
    const meter = new FrameMeter();
    meter.begin();
    const next = feed(meter, WARMUP_FRAMES + 10, 16);
    meter.skipNextInterval();
    feed(meter, 10, 16, next + 500);
    expect(meter.end()!.frameMs.max).toBe(16);
  });

  it('begin descarta o trecho anterior e end o fecha', () => {
    const meter = new FrameMeter();
    meter.begin();
    feed(meter, 40, 50);
    meter.begin();
    const next = feed(meter, 40, 10);
    expect(meter.snapshot()!.frameMs.max).toBe(10);
    expect(meter.end()!.frames).toBe(40);
    feed(meter, 40, 10, next);
    expect(meter.snapshot()).toBeNull();
  });

  it('guarda um número limitado de amostras em trechos longos', () => {
    const meter = new FrameMeter();
    meter.begin();
    const next = feed(meter, 5000, 30);
    feed(meter, 3000, 10, next);
    const session = meter.end()!;
    expect(session.frames).toBe(8000);
    // As amostras de 30 ms, mais antigas, já saíram quase todas.
    expect(session.frameMs.p50).toBe(10);
    expect(session.durationMs).toBeLessThan(4096 * 30);
  });
});

describe('FramePacer', () => {
  /** Quadros aceitos em um segundo de um monitor de `hz` Hz. */
  const acceptedPerSecond = (maxFps: number | undefined, hz: number, seconds = 4) => {
    const pacer = new FramePacer(maxFps);
    let accepted = 0;
    for (let i = 0; i < hz * seconds; i++) if (pacer.accept((i * 1000) / hz)) accepted++;
    return accepted / seconds;
  };

  it('sem teto aceita todos os quadros', () => {
    expect(acceptedPerSecond(undefined, 60)).toBe(60);
    expect(acceptedPerSecond(undefined, 144)).toBe(144);
  });

  it.each([
    [30, 60],
    [30, 144],
    [20, 60],
    [50, 60],
    [60, 144],
    [60, 240],
  ])('teto de %i em um monitor de %i Hz', (maxFps, hz) => {
    const rate = acceptedPerSecond(maxFps, hz);
    expect(rate).toBeLessThanOrEqual(maxFps + 0.5);
    expect(rate).toBeGreaterThan(maxFps * 0.9);
  });

  it('teto acima da taxa do monitor não derruba quadros', () => {
    expect(acceptedPerSecond(120, 60)).toBe(60);
    // Relógio com tremor de menos de 1 ms: o quadro que chega na hora é aceito.
    const pacer = new FramePacer(60);
    const times = [0, 16.2, 33.1, 49.9, 66.8, 83.2];
    expect(times.map((time) => pacer.accept(time))).toEqual(Array(6).fill(true));
  });

  it('depois de uma pausa longa aceita o próximo quadro e recomeça', () => {
    const pacer = new FramePacer(30);
    expect(pacer.accept(0)).toBe(true);
    expect(pacer.accept(10_000)).toBe(true);
    expect(pacer.accept(10_016)).toBe(false);
    expect(pacer.accept(10_034)).toBe(true);
    pacer.reset();
    expect(pacer.accept(10_035)).toBe(true);
  });
});

describe('AdaptiveQuality', () => {
  /** Um trecho de animação com `fps` quadros por segundo, de `durationMs`. */
  const session = (fps: number, durationMs = 2000, worstFrameMs = 1000 / fps): FrameSession => ({
    frames: WARMUP_FRAMES + Math.round((fps * durationMs) / 1000),
    durationMs,
    fps,
    frameMs: { p50: 1000 / fps, p95: worstFrameMs, max: worstFrameMs },
    cpuMs: { p50: 1, p95: 2, max: 3 },
  });
  const slow = session(15);
  const fast = session(60);

  it('desce um nível só depois de dois trechos lentos seguidos', () => {
    const adaptive = new AdaptiveQuality('high');
    expect(adaptive.observe(slow)).toBeUndefined();
    expect(adaptive.observe(slow)).toBe('medium');
    expect(adaptive.quality).toBe('medium');
  });

  it('um trecho rápido no meio zera a contagem', () => {
    const adaptive = new AdaptiveQuality('high');
    expect(adaptive.observe(slow)).toBeUndefined();
    expect(adaptive.observe(fast)).toBeUndefined();
    expect(adaptive.observe(slow)).toBeUndefined();
    expect(adaptive.quality).toBe('high');
  });

  it('o limite é 25 quadros por segundo, exclusivo', () => {
    expect(SLOW_FRAME_MS).toBe(40);
    const adaptive = new AdaptiveQuality('high');
    for (let i = 0; i < 4; i++) expect(adaptive.observe(session(25))).toBeUndefined();
    expect(adaptive.observe(session(24.9))).toBeUndefined();
    expect(adaptive.observe(session(24.9))).toBe('medium');
  });

  it('engasgos isolados em uma animação rápida não contam', () => {
    // 60 qps com alguns quadros de 300 ms: o p95 e o máximo são altos, a média não.
    const hitchy = session(55, 2000, 300);
    const adaptive = new AdaptiveQuality('high');
    for (let i = 0; i < 6; i++) expect(adaptive.observe(hitchy)).toBeUndefined();
    expect(adaptive.quality).toBe('high');
  });

  it('uma animação lenta e curta, com poucos quadros, conta', () => {
    // 15 qps em 1,4 s: cerca de 21 quadros medidos.
    const shortSlow = session(15, 1400);
    expect(shortSlow.frames - WARMUP_FRAMES).toBeLessThan(30);
    const adaptive = new AdaptiveQuality('high');
    expect(adaptive.observe(shortSlow)).toBeUndefined();
    expect(adaptive.observe(shortSlow)).toBe('medium');
  });

  it('trechos curtos demais não contam nem zeram a contagem', () => {
    const adaptive = new AdaptiveQuality('high');
    const fewFrames = session(15, 2000);
    fewFrames.frames = WARMUP_FRAMES + MIN_SESSION_SAMPLES - 1;
    const brief = session(15, MIN_SESSION_MS - 1);
    brief.frames = WARMUP_FRAMES + 50;
    for (const tiny of [fewFrames, brief]) {
      expect(adaptive.observe(tiny)).toBeUndefined();
      expect(adaptive.observe(tiny)).toBeUndefined();
    }
    expect(adaptive.observe(slow)).toBeUndefined();
    expect(adaptive.observe(brief)).toBeUndefined();
    expect(adaptive.observe(slow)).toBe('medium');
  });

  it('desce até `low` e para; nunca sobe', () => {
    const adaptive = new AdaptiveQuality('high');
    const levels = Array.from({ length: 8 }, () => adaptive.observe(slow));
    expect(levels).toEqual([
      undefined,
      'medium',
      undefined,
      'low',
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    for (let i = 0; i < 10; i++) expect(adaptive.observe(fast)).toBeUndefined();
    expect(adaptive.quality).toBe('low');
  });

  it('com teto de quadros, o próprio teto não conta como lentidão', () => {
    expect(slowFrameThreshold(undefined)).toBe(SLOW_FRAME_MS);
    expect(slowFrameThreshold(60)).toBe(SLOW_FRAME_MS);
    // A 20 qps cada quadro leva 50 ms: o limite fica acima disso.
    expect(slowFrameThreshold(20)).toBe(80);
    const capped = new AdaptiveQuality('high', slowFrameThreshold(20));
    expect(capped.observe(session(19.5))).toBeUndefined();
    expect(capped.observe(session(19.5))).toBeUndefined();
    expect(capped.observe(session(10))).toBeUndefined();
    expect(capped.observe(session(10))).toBe('medium');
  });
});
