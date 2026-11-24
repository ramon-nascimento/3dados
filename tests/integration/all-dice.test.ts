import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { COMPOSITE_PART_DICE, STANDARD_DICE } from '../../src/core/dice/standard';
import { dieRadius, type DieDefinition } from '../../src/core/die-definition';
import { FLAT_ALIGNMENT_MIN, readFace } from '../../src/core/face-reading';
import { rotateVector, vec3, vecScale } from '../../src/core/math';
import { finalPosition, finalRotation } from '../../src/core/trajectory';
import type { RollRequest } from '../../src/core/types';
import { createPhysicsSimulator, type PhysicsSimulator } from '../../src/physics/simulator';
import { createHarness } from './helpers/engine-harness';

const PHYSICAL_DICE = [...STANDARD_DICE, ...COMPOSITE_PART_DICE];
const AREA = { width: 26, depth: 15 };

describe('todos os dados, com física real', () => {
  let simulator: PhysicsSimulator;

  beforeAll(async () => {
    simulator = await createPhysicsSimulator();
  });

  it.each(PHYSICAL_DICE)('$type: o Rapier cria o casco convexo', (die) => {
    const points = new Float32Array(die.vertices.flatMap((v) => [v.x, v.y, v.z]));

    expect(RAPIER.ColliderDesc.convexHull(points)).not.toBeNull();
  });

  it.each(STANDARD_DICE)(
    '$type: 200 pré-simulações terminam assentadas, sobre a mesa e sem ambiguidade',
    async (die) => {
      const landed = new Set<string>();
      let checked = 0;

      for (let run = 0; run < 200; run++) {
        const count = 1 + (run % 5);
        const { recording, landedFaces } = await simulator.simulate({
          dice: Array.from({ length: count }, (_, i) => ({ dieId: `die-${i}`, definition: die })),
          area: AREA,
          seed: 7_000_003 * (run + 1),
        });

        recording.dice.forEach((trajectory, i) => {
          const rotation = finalRotation(trajectory);
          const position = finalPosition(trajectory);
          const reading = readFace(die, rotation);
          const heights = die.vertices.map(
            (vertex) => position.y + rotateVector(rotation, vertex).y,
          );

          expect(reading.alignment).toBeGreaterThanOrEqual(FLAT_ALIGNMENT_MIN);
          expect(reading.margin).toBeGreaterThan(0.1);
          expect(reading.face.id).toBe(landedFaces[i]!.id);
          // Apoiado na mesa, dentro da área.
          expect(Math.min(...heights)).toBeCloseTo(0, 1);
          expect(Math.abs(position.x)).toBeLessThanOrEqual(AREA.width / 2);
          expect(Math.abs(position.z)).toBeLessThanOrEqual(AREA.depth / 2);
          landed.add(reading.face.id);
          checked++;
        });
      }

      expect(checked).toBe(600);
      // A física alcança todas as posições de repouso do dado.
      expect(landed.size).toBe(die.faces.length);
    },
  );

  it('dados de tipos diferentes começam separados, qualquer que seja o tamanho', async () => {
    const dice = PHYSICAL_DICE.flatMap((definition, i) => [
      { dieId: `a${i}`, definition },
      { dieId: `b${i}`, definition },
    ]);

    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { recording } = await simulator.simulate({ dice, area: AREA, seed });
      const starts = recording.dice.map((die, i) => ({
        x: die.positions[0]!,
        y: die.positions[1]!,
        z: die.positions[2]!,
        radius: dieRadius(dice[i]!.definition),
      }));

      for (let i = 0; i < starts.length; i++) {
        for (let j = i + 1; j < starts.length; j++) {
          const a = starts[i]!;
          const b = starts[j]!;
          expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(a.radius + b.radius);
        }
      }
    }
  });
});

describe('DiceEngine com todos os dados', () => {
  let simulator: PhysicsSimulator;

  beforeAll(async () => {
    simulator = await createPhysicsSimulator();
  });

  /** Rola e confere que cada malha exibe o valor da face-alvo e que o desfecho traz os valores pedidos. */
  async function rollAndCheck(request: RollRequest, expected: number[]) {
    const { engine, renderer, play } = createHarness(simulator);
    const outcome = await play(engine.roll(request));

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return outcome;
    expect(outcome.dice.map((die) => die.value)).toEqual(expected);
    expect(outcome.total).toBe(expected.reduce((a, b) => a + b, 0));

    // O que cada malha mostra, lido da orientação final, bate com o resultado.
    const displayed = renderer.displayed();
    for (const die of outcome.dice) {
      if (die.components) {
        for (const part of die.components) expect(displayed[part.dieId]).toBe(part.value);
      } else {
        expect(displayed[die.dieId]).toBe(die.value);
      }
    }
    return outcome;
  }

  it.each(STANDARD_DICE)('$type: exibe cada um dos seus valores quando pedido', async (die) => {
    const values = die.faces.map((face) => face.value).sort((a, b) => a - b);

    await rollAndCheck({ id: 'r', seed: 31, dice: [{ type: die.type, values }] }, values);
  });

  it('d100: exibe todos os valores de 1 a 100, com dezena e unidade corretas', async () => {
    for (let start = 1; start <= 100; start += 10) {
      const values = Array.from({ length: 10 }, (_, i) => start + i);
      const outcome = await rollAndCheck(
        { id: 'r', seed: start, dice: [{ type: 'd100', values }] },
        values,
      );

      if (outcome.status !== 'completed') continue;
      for (const die of outcome.dice) {
        const [tens, units] = die.components!;
        expect(tens).toMatchObject({ dieId: `${die.dieId}:tens`, type: 'd100:tens' });
        expect(units).toMatchObject({ dieId: `${die.dieId}:units`, type: 'd100:units' });
        expect(tens!.value + units!.value || 100).toBe(die.value);
        expect(die.faceId).toBe(`${tens!.faceId}+${units!.faceId}`);
      }
    }
  });

  it('modo autônomo com todos os tipos: valores dentro da faixa de cada dado', async () => {
    const { engine, renderer, play, events } = createHarness(simulator, { seed: 99 });
    const types = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
    const max = [4, 6, 8, 10, 12, 20, 100];

    const outcome = await play(
      engine.roll({ id: 'mix', dice: types.map((type) => ({ type, count: 2 })) }),
    );

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.dice.map((die) => die.type)).toEqual(types.flatMap((type) => [type, type]));
    outcome.dice.forEach((die, i) => {
      expect(Number.isInteger(die.value)).toBe(true);
      expect(die.value).toBeGreaterThanOrEqual(1);
      expect(die.value).toBeLessThanOrEqual(max[Math.floor(i / 2)]!);
      expect(die.source).toBe('rng');
    });
    // 12 dados simples + 2 d100 (dois dados físicos cada) = 16 malhas.
    expect(renderer.dice.size).toBe(16);
    expect(events.filter((event) => event.name === 'diceSettled')).toHaveLength(16);
  });

  it('d10: a face "0" é exibida e vale 10', async () => {
    const outcome = await rollAndCheck({ dice: [{ type: 'd10', values: [10, 1, 9] }] }, [10, 1, 9]);

    if (outcome.status === 'completed') {
      expect(outcome.dice.map((die) => die.faceId)).toEqual(['0', '1', '9']);
    }
  });

  it('dado personalizado registrado rola e exibe os valores pedidos, mesmo repetidos', async () => {
    const { engine, renderer, play } = createHarness(simulator);
    const fudge: DieDefinition = {
      type: 'dF',
      vertices: D6.vertices,
      faces: D6.faces.map((face, i) => ({
        ...face,
        id: `f${i}`,
        value: [1, 1, 0, 0, -1, -1][i]!,
        labels: [
          {
            text: ['+', '+', '', '', '−', '−'][i]!,
            anchor: vecScale(face.readDirection, 0.5),
            up: face.readDirection.y === 0 ? vec3(0, 1, 0) : vec3(0, 0, 1),
            height: 0.6,
          },
        ],
      })),
    };
    engine.registerDie(fudge);

    const outcome = await play(engine.roll({ dice: [{ type: 'dF', values: [1, 0, -1, -1] }] }));

    expect(outcome).toMatchObject({ status: 'completed', total: -1 });
    expect(Object.values(renderer.displayed())).toEqual([1, 0, -1, -1]);
  });

  it('registerDie recusa definição inválida e tipo já existente', () => {
    const { engine } = createHarness(simulator);
    const broken = { ...D6, type: 'quebrado', faces: D6.faces.slice(0, 5) };

    expect(() => engine.registerDie(broken)).toThrow(
      expect.objectContaining({ code: 'INVALID_DIE_DEFINITION' }),
    );
    expect(() => engine.registerDie({ ...D6, type: 'd20' })).toThrow(
      expect.objectContaining({ code: 'INVALID_DIE_DEFINITION' }),
    );
    expect(() => engine.registerDie({ ...D6, type: 'd100' })).toThrow(
      expect.objectContaining({ code: 'INVALID_DIE_DEFINITION' }),
    );
  });

  it('um tipo não registrado continua desconhecido', async () => {
    const { engine } = createHarness(simulator);

    const outcome = await engine.roll({ dice: [{ type: 'dF' }] }).result;

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'UNKNOWN_DIE_TYPE' } });
  });
});
