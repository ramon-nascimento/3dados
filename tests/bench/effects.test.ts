import { describe, it } from 'vitest';
import { DiceEffects, type EffectsHost } from '../../src/effects';

// Custo dos efeitos na CPU, por quadro: atualizar partículas, anéis e halos e
// escrever os buffers. Não inclui a GPU (ver BENCHMARKS.md). Sem asserções:
// imprime números para docs/BENCHMARKS.md. Variáveis: BENCH_FRAMES, BENCH_COUNTS.
const FRAMES = Number(process.env.BENCH_FRAMES ?? 150);
const COUNTS = (process.env.BENCH_COUNTS ?? '1,10,30').split(',').map(Number);

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN;
}

function measure(effect: string, count: number, maxParticles = 2000) {
  let time = 0;
  const dice = Array.from({ length: count }, (_, i) => `d${i}`);
  const host: EffectsHost = {
    attach: () => undefined,
    detach: () => undefined,
    resolveDice: (ids) => dice.filter((id) => !ids || ids.includes(id)),
    dieInfo: (id) => ({
      position: {
        x: (Number(id.slice(1)) % 6) * 2 - 5,
        y: 0.6,
        z: Math.floor(Number(id.slice(1)) / 6),
      },
      radius: 0.87,
    }),
    now: () => time,
    changed: () => undefined,
  };
  const effects = new DiceEffects(
    { level: 'full', maxParticles },
    { prefersReducedMotion: () => false, onReducedMotionChange: () => () => undefined },
    host,
  );
  const spawn = performance.now();
  effects.trigger(effect);
  const spawnMs = performance.now() - spawn;
  const times: number[] = [];
  let peak = 0;
  for (let frame = 0; frame < FRAMES; frame++) {
    time += 1000 / 60;
    const start = performance.now();
    effects.update();
    times.push(performance.now() - start);
    peak = Math.max(peak, effects.getStats().particles);
  }
  effects.dispose();
  times.sort((a, b) => a - b);
  return { spawnMs, times, peak };
}

describe('custo dos efeitos', () => {
  it.each(COUNTS)('critical em %i dados', (count) => {
    measure('critical', count); // aquecimento do JIT
    const { spawnMs, times, peak } = measure('critical', count);
    console.info(
      `[efeitos] critical em ${count} dados, ${FRAMES} quadros: criação ${spawnMs.toFixed(2)} ms; atualização mediana ${percentile(times, 0.5).toFixed(3)} ms, p95 ${percentile(times, 0.95).toFixed(3)} ms, máx ${times.at(-1)!.toFixed(3)} ms; pico de ${peak} partículas`,
    );
  });

  it('pior caso: fire em 30 dados com o teto de partículas cheio', () => {
    measure('fire', 30, 20_000);
    const { times, peak } = measure('fire', 30, 20_000);
    console.info(
      `[efeitos] fire em 30 dados, teto 20.000: atualização mediana ${percentile(times, 0.5).toFixed(3)} ms, p95 ${percentile(times, 0.95).toFixed(3)} ms; pico de ${peak} partículas`,
    );
  });
});
