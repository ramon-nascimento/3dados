import { describe, it } from 'vitest';
import { vec3 } from '../../src/core/math';
import { createDieDefinition } from '../../src/core/polyhedron';
import { acceptableLandings } from '../../src/core/symmetry';
import { createPhysicsSimulator } from '../../src/physics/simulator';

// Mede a busca para dados sem simetria: um tijolo 1 × 1,6 × 1 que precisa
// terminar de ponta (raro) ou de lado (comum). Rodar com `npm run bench`.
const AREA = { width: 26, depth: 15 };
const RUNS = Number(process.env.BENCH_RUNS ?? 200);

const BRICK = createDieDefinition(
  'tijolo',
  [-0.5, 0.5].flatMap((x) => [-0.8, 0.8].flatMap((y) => [-0.5, 0.5].map((z) => vec3(x, y, z)))),
  (face) => ({ value: face.index + 1, id: `f${face.index}` }),
);
const END = BRICK.faces.find((face) => Math.abs(face.readDirection.y) > 0.5)!;
const SIDE = BRICK.faces.find((face) => Math.abs(face.readDirection.y) < 0.5)!;

describe('busca para dados sem simetria (tijolo)', () => {
  it.each([
    { name: 'ponta', target: END, count: 1 },
    { name: 'ponta', target: END, count: 3 },
    { name: 'ponta', target: END, count: 6 },
    { name: 'lado', target: SIDE, count: 1 },
    { name: 'lado', target: SIDE, count: 6 },
  ])('$count tijolo(s) terminando de $name', async ({ name, target, count }) => {
    const simulator = await createPhysicsSimulator();
    const dice = Array.from({ length: count }, (_, i) => ({ dieId: `d${i}`, definition: BRICK }));
    const acceptableFaces = dice.map(() => acceptableLandings(BRICK, target));
    const attempts: number[] = [];
    const cpu: number[] = [];
    let failures = 0;

    for (let seed = 1; seed <= RUNS; seed++) {
      try {
        const result = await simulator.simulate({
          dice,
          area: AREA,
          seed: seed * 7919,
          acceptableFaces,
        });
        attempts.push(result.attempts);
        cpu.push(result.cpuTimeMs);
      } catch {
        failures++;
      }
    }

    attempts.sort((a, b) => a - b);
    cpu.sort((a, b) => a - b);
    const median = (values: number[]) => values[Math.floor(values.length / 2)] ?? Number.NaN;
    const firstTry = attempts.filter((n) => n === 1).length;
    console.log(
      [
        `${count} tijolo(s) de ${name} × ${RUNS} rolagens`,
        `  tentativas  mediana ${median(attempts)}  máx ${attempts.at(-1) ?? NaN}  na primeira ${((100 * firstTry) / RUNS).toFixed(0)}%`,
        `  CPU ms      mediana ${median(cpu).toFixed(1)}  máx ${(cpu.at(-1) ?? NaN).toFixed(1)}`,
        `  falhas ${failures}`,
      ].join('\n'),
    );
  });
});
