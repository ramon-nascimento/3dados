import { describe, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import type { PhysicsConfig } from '../../src/physics/config';
import { createPhysicsSimulator } from '../../src/physics/simulator';

// Medições reais da pré-simulação. Não faz asserções: imprime números para
// calibrar parâmetros e alimentar docs/BENCHMARKS.md. Rodar com `npm run bench`.
// Variáveis: BENCH_RUNS, BENCH_COUNTS ("1,2,5"), BENCH_AREA ("26x15") e BENCH_CONFIG
// (JSON de PhysicsConfig).
const [AREA_WIDTH = 26, AREA_DEPTH = 15] = (process.env.BENCH_AREA ?? '')
  .split('x')
  .filter(Boolean)
  .map(Number);
const AREA = { width: AREA_WIDTH, depth: AREA_DEPTH };
const RUNS = Number(process.env.BENCH_RUNS ?? 200);
const COUNTS = (process.env.BENCH_COUNTS ?? '1,2,5,10,20').split(',').map(Number);
const CONFIG = JSON.parse(process.env.BENCH_CONFIG ?? '{}') as Partial<PhysicsConfig>;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN;
}

describe('estatísticas da pré-simulação', () => {
  it.each(COUNTS)('%i d6', async (count) => {
    const simulator = await createPhysicsSimulator(CONFIG);
    const dice = Array.from({ length: count }, (_, i) => ({ dieId: `d${i}`, definition: D6 }));
    const cpu: number[] = [];
    const duration: number[] = [];
    const rejections = new Map<string, number>();
    let attempts = 0;
    let failures = 0;

    for (let seed = 1; seed <= RUNS; seed++) {
      try {
        const result = await simulator.simulate({ dice, area: AREA, seed: seed * 7919 });
        cpu.push(result.cpuTimeMs);
        duration.push(result.recording.stepCount * result.recording.timestep);
        attempts += result.attempts;
        for (const reason of result.rejections)
          rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
      } catch {
        failures++;
      }
    }

    cpu.sort((a, b) => a - b);
    duration.sort((a, b) => a - b);
    const f = (n: number) => n.toFixed(2);
    console.log(
      [
        `${count} d6 × ${RUNS} rolagens (área ${AREA.width}×${AREA.depth})`,
        `  CPU ms      mediana ${f(percentile(cpu, 0.5))}  p95 ${f(percentile(cpu, 0.95))}  máx ${f(cpu.at(-1) ?? NaN)}`,
        `  duração s   mediana ${f(percentile(duration, 0.5))}  p95 ${f(percentile(duration, 0.95))}  máx ${f(duration.at(-1) ?? NaN)}`,
        `  tentativas  média ${f(attempts / Math.max(cpu.length, 1))}  descartes ${JSON.stringify(Object.fromEntries(rejections))}  falhas ${failures}`,
      ].join('\n'),
    );
  });
});
