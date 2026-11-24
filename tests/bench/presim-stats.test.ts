import { describe, it } from 'vitest';
import { STANDARD_DICE } from '../../src/core/dice/standard';
import { MATERIAL_PRESETS, type MaterialKind } from '../../src/customization';
import type { PhysicsConfig } from '../../src/physics/config';
import { createPhysicsSimulator } from '../../src/physics/simulator';

// Medições reais da pré-simulação. Não faz asserções: imprime números para
// calibrar parâmetros e alimentar docs/BENCHMARKS.md. Rodar com `npm run bench`.
// Variáveis: BENCH_RUNS, BENCH_COUNTS ("1,2,5"), BENCH_AREA ("26x15"), BENCH_TYPES ("d6,d20"),
// BENCH_MATERIALS ("plastic,metal"; padrão: só plástico) e BENCH_CONFIG (JSON de PhysicsConfig).
// "CPU" é o tempo trabalhado; "maior trecho" é o quanto a simulação segurou a thread de uma vez
// (ela pausa a cada 8 ms).
const [AREA_WIDTH = 26, AREA_DEPTH = 15] = (process.env.BENCH_AREA ?? '')
  .split('x')
  .filter(Boolean)
  .map(Number);
const AREA = { width: AREA_WIDTH, depth: AREA_DEPTH };
const RUNS = Number(process.env.BENCH_RUNS ?? 200);
const COUNTS = (process.env.BENCH_COUNTS ?? '1,2,5,10,20').split(',').map(Number);
const TYPES = (process.env.BENCH_TYPES ?? 'd6').split(',');
const MATERIALS = (process.env.BENCH_MATERIALS ?? 'plastic').split(',') as MaterialKind[];
const CONFIG = JSON.parse(process.env.BENCH_CONFIG ?? '{}') as Partial<PhysicsConfig>;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN;
}

describe('estatísticas da pré-simulação', () => {
  const CASES = MATERIALS.flatMap((material) =>
    TYPES.flatMap((type) => COUNTS.map((count) => ({ material, type, count }))),
  );

  it.each(CASES)('$count $type ($material)', async ({ material, type, count }) => {
    const definition = STANDARD_DICE.find((die) => die.type === type);
    if (!definition) throw new Error(`Tipo desconhecido: ${type}`);
    const simulator = await createPhysicsSimulator(CONFIG);
    const preset = MATERIAL_PRESETS[material];
    if (!preset) throw new Error(`Material desconhecido: ${material}`);
    const dice = Array.from({ length: count }, (_, i) => ({
      dieId: `d${i}`,
      definition,
      material: preset.physics,
    }));
    const cpu: number[] = [];
    const longest: number[] = [];
    const duration: number[] = [];
    const rejections = new Map<string, number>();
    let attempts = 0;
    let failures = 0;
    let recoveredRolls = 0;
    let recoveredDice = 0;

    for (let seed = 1; seed <= RUNS; seed++) {
      try {
        const result = await simulator.simulate({ dice, area: AREA, seed: seed * 7919 });
        cpu.push(result.cpuTimeMs);
        longest.push(result.longestTaskMs);
        duration.push(result.recording.stepCount * result.recording.timestep);
        attempts += result.attempts;
        const nudged = result.recovered.filter(Boolean).length;
        recoveredDice += nudged;
        if (nudged > 0) recoveredRolls++;
        for (const reason of result.rejections)
          rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
      } catch {
        failures++;
      }
    }

    cpu.sort((a, b) => a - b);
    longest.sort((a, b) => a - b);
    duration.sort((a, b) => a - b);
    const f = (n: number) => n.toFixed(2);
    console.log(
      [
        `${count} ${type} de ${material} × ${RUNS} rolagens (área ${AREA.width}×${AREA.depth})`,
        `  CPU ms      mediana ${f(percentile(cpu, 0.5))}  p95 ${f(percentile(cpu, 0.95))}  máx ${f(cpu.at(-1) ?? NaN)}`,
        `  maior trecho mediana ${f(percentile(longest, 0.5))}  p95 ${f(percentile(longest, 0.95))}  máx ${f(longest.at(-1) ?? NaN)} ms (sem pausa)`,
        `  duração s   mediana ${f(percentile(duration, 0.5))}  p95 ${f(percentile(duration, 0.95))}  máx ${f(duration.at(-1) ?? NaN)}`,
        `  tentativas  média ${f(attempts / Math.max(cpu.length, 1))}  descartes ${JSON.stringify(Object.fromEntries(rejections))}  falhas ${failures}`,
        `  recuperação rolagens ${((100 * recoveredRolls) / Math.max(cpu.length, 1)).toFixed(0)}%  dados ${((100 * recoveredDice) / Math.max(cpu.length * count, 1)).toFixed(1)}%`,
      ].join('\n'),
    );
  });
});
