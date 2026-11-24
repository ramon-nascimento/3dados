import { describe, it } from 'vitest';
import { DiceAudio, planRollSounds, synthesize, SAMPLE_GROUPS } from '../../src/audio';
import { STANDARD_DICE } from '../../src/core/dice/standard';
import { createPhysicsSimulator } from '../../src/physics/simulator';
import { createFakeEnvironment } from '../unit/helpers/fake-audio';

// Custo do áudio na CPU: planejar os sons de uma rolagem (inclui encontrar os
// tombos na trajetória) e sintetizar o banco de reserva. Sem asserções: imprime
// números para docs/BENCHMARKS.md. Variáveis: BENCH_RUNS, BENCH_COUNTS ("1,5,20,30").
const RUNS = Number(process.env.BENCH_RUNS ?? 100);
const COUNTS = (process.env.BENCH_COUNTS ?? '1,5,10,20,30').split(',').map(Number);
const TYPES = ['d6', 'd20', 'd8', 'd12', 'd10', 'd4'];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN;
}

describe('custo do áudio', () => {
  it.each(COUNTS)('planejar os sons de %i dados', async (count) => {
    const simulator = await createPhysicsSimulator();
    const dice = Array.from({ length: count }, (_, i) => ({
      dieId: `d${i}`,
      definition: STANDARD_DICE.find((die) => die.type === TYPES[i % TYPES.length])!,
    }));
    const times: number[] = [];
    const sounds: number[] = [];
    const voiceLimited: number[] = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const { recording } = await simulator.simulate({
        dice,
        area: { width: 26, depth: 15 },
        seed,
      });
      const start = performance.now();
      const events = planRollSounds({
        recording,
        dice: dice.map((die) => ({ ...die, profile: 'plastic' as const })),
        surface: 'wood',
        seed,
      });
      times.push(performance.now() - start);
      sounds.push(events.length);

      // Quantos sons o limite padrão (16 vozes) descarta ou interrompe.
      const env = createFakeEnvironment();
      const audio = new DiceAudio({}, env, { surface: 'wood' });
      await audio.unlock();
      await audio.ready();
      audio.scheduleRoll(events);
      const stats = audio.getStats();
      voiceLimited.push((stats.dropped + stats.stolen) / Math.max(1, events.length));
    }
    times.sort((a, b) => a - b);
    sounds.sort((a, b) => a - b);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    console.info(
      `[áudio] ${count} dados, ${RUNS} rolagens: planejamento mediana ${percentile(times, 0.5).toFixed(2)} ms, p95 ${percentile(times, 0.95).toFixed(2)} ms, máx ${times.at(-1)!.toFixed(2)} ms; sons por rolagem mediana ${percentile(sounds, 0.5)}, máx ${sounds.at(-1)}; afetados pelo limite de vozes ${(100 * mean(voiceLimited)).toFixed(1)}%`,
    );
  });

  it('sintetizar o banco de reserva inteiro', () => {
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const start = performance.now();
      for (const group of SAMPLE_GROUPS) for (let v = 0; v < 3; v++) synthesize(group, v, 48_000);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    console.info(
      `[áudio] síntese do banco (até 3 variações por grupo, 48 kHz): mediana ${percentile(times, 0.5).toFixed(1)} ms, máx ${times.at(-1)!.toFixed(1)} ms`,
    );
  });
});
