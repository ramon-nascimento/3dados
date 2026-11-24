import { beforeAll, describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { D20 } from '../../src/core/dice/platonic';
import type { DieDefinition } from '../../src/core/die-definition';
import { FLAT_ALIGNMENT_MIN, readFace } from '../../src/core/face-reading';
import { rotateVector, vec3 } from '../../src/core/math';
import { createDieDefinition } from '../../src/core/polyhedron';
import { acceptableLandings, isFaceTransitive } from '../../src/core/symmetry';
import { finalPosition, finalRotation } from '../../src/core/trajectory';
import { validateDieDefinition } from '../../src/core/validate-die';
import type { PhysicsConfig } from '../../src/physics/config';
import {
  createPhysicsSimulator,
  type PhysicsSimulator,
  type SimulationResult,
} from '../../src/physics/simulator';
import { createHarness } from './helpers/engine-harness';

const DENSE = { width: 8, depth: 8 };
const WIDE = { width: 26, depth: 15 };

function dice(definition: DieDefinition, count: number) {
  return Array.from({ length: count }, (_, i) => ({ dieId: `die-${i}`, definition }));
}

/** Tijolo 1 × 1,6 × 1: quatro lados iguais e duas pontas menores, não equivalentes aos lados. */
const BRICK = validateDieDefinition(
  createDieDefinition(
    'tijolo',
    [-0.5, 0.5].flatMap((x) => [-0.8, 0.8].flatMap((y) => [-0.5, 0.5].map((z) => vec3(x, y, z)))),
    (face) => ({ value: face.index + 1, id: `f${face.index}` }),
  ),
);
const isEnd = (faceId: string) =>
  Math.abs(BRICK.faces.find((face) => face.id === faceId)!.readDirection.y) > 0.5;

/** Todo dado de um resultado aceito está assentado e sobre a mesa. */
function expectAllSettled(result: SimulationResult, definition: DieDefinition): void {
  for (const trajectory of result.recording.dice) {
    const rotation = finalRotation(trajectory);
    const position = finalPosition(trajectory);
    const lowest = Math.min(
      ...definition.vertices.map((vertex) => position.y + rotateVector(rotation, vertex).y),
    );

    expect(readFace(definition, rotation).alignment).toBeGreaterThanOrEqual(FLAT_ALIGNMENT_MIN);
    expect(lowest).toBeCloseTo(0, 1);
  }
}

describe('recuperação de rolagens que não convergem', () => {
  /** Em 12 rolagens densas (20 d6 em 8×8), quantas falham com a configuração dada. */
  async function denseFailures(config: Partial<PhysicsConfig>): Promise<number> {
    const simulator = await createPhysicsSimulator(config);
    let failures = 0;
    for (let seed = 1; seed <= 12; seed++) {
      try {
        expectAllSettled(await simulator.simulate({ dice: dice(D6, 20), area: DENSE, seed }), D6);
      } catch (error) {
        expect(error).toMatchObject({ code: 'SIMULATION_FAILED' });
        failures++;
      }
    }
    return failures;
  }

  it('sem empurrões, rolagens densas quase nunca convergem; com eles, quase sempre', async () => {
    const without = await denseFailures({ maxNudges: 0 });
    const withNudges = await denseFailures({});

    expect(without).toBeGreaterThanOrEqual(9);
    expect(withNudges).toBeLessThanOrEqual(3);
  });

  it('marca como recuperados só os dados que receberam empurrão', async () => {
    const simulator = await createPhysicsSimulator({ cleanAttempts: 0 });
    let recoveredDice = 0;

    for (let seed = 1; seed <= 6; seed++) {
      const result = await simulator.simulate({ dice: dice(D6, 16), area: DENSE, seed });

      expect(result.recovered).toHaveLength(16);
      expectAllSettled(result, D6);
      recoveredDice += result.recovered.filter(Boolean).length;
    }

    expect(recoveredDice).toBeGreaterThan(0);
    expect(recoveredDice).toBeLessThan(6 * 16);
  });

  it('rolagens folgadas saem sem nenhuma intervenção', async () => {
    const simulator = await createPhysicsSimulator();

    for (let seed = 1; seed <= 40; seed++) {
      const result = await simulator.simulate({ dice: dice(D6, 3), area: WIDE, seed });

      expect(result.recovered).toEqual([false, false, false]);
    }
  });

  it('as primeiras tentativas nunca usam empurrões', async () => {
    // Com todas as tentativas "limpas", o comportamento é o de sem recuperação.
    const simulator = await createPhysicsSimulator({ cleanAttempts: 12 });

    for (let seed = 1; seed <= 6; seed++) {
      try {
        const result = await simulator.simulate({ dice: dice(D20, 20), area: WIDE, seed });
        expect(result.recovered.every((flag) => !flag)).toBe(true);
      } catch (error) {
        expect(error).toMatchObject({ code: 'SIMULATION_FAILED' });
      }
    }
  });

  it('20 d20 em tela cheia convergem sempre com a configuração padrão', async () => {
    const simulator = await createPhysicsSimulator();

    for (let seed = 1; seed <= 25; seed++) {
      expectAllSettled(await simulator.simulate({ dice: dice(D20, 20), area: WIDE, seed }), D20);
    }
  });
});

describe('dados sem simetria entre todas as faces', () => {
  let simulator: PhysicsSimulator;

  beforeAll(async () => {
    simulator = await createPhysicsSimulator();
  });

  it('o tijolo não tem todas as faces equivalentes; os dados padrão têm', () => {
    expect(isFaceTransitive(BRICK)).toBe(false);
    expect(isFaceTransitive(D6)).toBe(true);
    expect(isFaceTransitive(D20)).toBe(true);
    expect(acceptableLandings(D6, D6.faces[0]!)).toBeUndefined();
  });

  it('uma face só pode ser exibida se o corpo cair em uma face equivalente', () => {
    for (const target of BRICK.faces) {
      const landings = acceptableLandings(BRICK, target)!;

      // Pontas só trocam com pontas (2); lados só com lados (4).
      expect(landings.size).toBe(isEnd(target.id) ? 2 : 4);
      expect(landings.has(target.id)).toBe(true);
      for (const id of landings) expect(isEnd(id)).toBe(isEnd(target.id));
    }
  });

  it('a simulação repete até o dado cair em uma face aceitável', async () => {
    const ends = new Set(BRICK.faces.filter((face) => isEnd(face.id)).map((face) => face.id));
    let attempts = 0;

    for (let seed = 1; seed <= 15; seed++) {
      const result = await simulator.simulate({
        dice: dice(BRICK, 1),
        area: WIDE,
        seed,
        acceptableFaces: [ends],
      });

      expect(ends.has(result.landedFaces[0]!.id)).toBe(true);
      expect(result.rejections.every((reason) => reason === 'wrong-face')).toBe(true);
      attempts += result.attempts;
    }

    // Cair de ponta é raro: a busca de fato precisou repetir.
    expect(attempts).toBeGreaterThan(15);
  });

  it('sem restrição, qualquer face serve e não há busca', async () => {
    const result = await simulator.simulate({
      dice: dice(BRICK, 2),
      area: WIDE,
      seed: 3,
      acceptableFaces: [undefined, undefined],
    });

    expect(result.attempts).toBe(1);
  });

  it('falha com SIMULATION_FAILED quando o orçamento de busca se esgota', async () => {
    const short = await createPhysicsSimulator({ maxAttempts: 2, searchAttempts: 5 });

    await expect(
      short.simulate({ dice: dice(D6, 1), area: WIDE, seed: 1, acceptableFaces: [new Set()] }),
    ).rejects.toMatchObject({
      code: 'SIMULATION_FAILED',
      details: { rejections: Array.from({ length: 5 }, () => 'wrong-face') },
    });
  });
});

describe('DiceEngine: recuperação e dados sem simetria', () => {
  it('rolagem densa recuperada exibe exatamente os valores pedidos', async () => {
    const simulator = await createPhysicsSimulator({ cleanAttempts: 0 });
    const { engine, renderer, play } = createHarness(simulator, { area: DENSE });
    const values = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6, 1, 2, 3, 4];

    const outcome = await play(engine.roll({ id: 'r', seed: 4, dice: [{ type: 'd6', values }] }));

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.dice.map((die) => die.value)).toEqual(values);
    expect(Object.values(renderer.displayed())).toEqual(values);
    // Houve recuperação, e ela não atingiu todos os dados.
    expect(outcome.dice.some((die) => die.recovered)).toBe(true);
    expect(outcome.dice.some((die) => !die.recovered)).toBe(true);
  });

  it('rolagem folgada não marca nenhum dado como recuperado', async () => {
    const { engine, play } = createHarness(await createPhysicsSimulator());

    const outcome = await play(engine.roll({ dice: [{ type: 'd20', count: 3 }] }));

    expect(outcome.status).toBe('completed');
    if (outcome.status === 'completed') {
      expect(outcome.dice.every((die) => !die.recovered)).toBe(true);
    }
  });

  it('dado sem simetria: exibe cada um dos seus valores quando pedido', async () => {
    const { engine, renderer, play } = createHarness(await createPhysicsSimulator());
    engine.registerDie(BRICK);

    for (const face of BRICK.faces) {
      const outcome = await play(
        engine.roll({
          id: 'r',
          seed: 100 + face.value,
          dice: [{ type: 'tijolo', values: [face.value] }],
        }),
      );

      expect(outcome).toMatchObject({ status: 'completed', total: face.value });
      expect(renderer.displayed()).toEqual({ 'r:0': face.value });
    }
  });

  it('dado sem simetria em modo autônomo: o valor exibido é o sorteado', async () => {
    const { engine, renderer, play } = createHarness(await createPhysicsSimulator(), { seed: 21 });
    engine.registerDie(BRICK);
    const seen = new Set<number>();

    for (let run = 0; run < 12; run++) {
      const outcome = await play(engine.roll({ id: 'r', dice: [{ type: 'tijolo', count: 2 }] }));

      expect(outcome.status).toBe('completed');
      if (outcome.status !== 'completed') continue;
      expect(Object.values(renderer.displayed())).toEqual(outcome.dice.map((die) => die.value));
      for (const die of outcome.dice) seen.add(die.value);
    }

    // O sorteio é uniforme entre as faces: as pontas aparecem como qualquer lado.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('getDiceOnTable devolve a posição e a orientação reais de cada dado físico', async () => {
    const { engine, renderer, play } = createHarness(await createPhysicsSimulator());
    expect(engine.getDiceOnTable()).toEqual([]);

    await play(engine.roll({ id: 'r', dice: [{ type: 'd20' }, { type: 'd100', values: [57] }] }));
    const table = engine.getDiceOnTable();

    expect(table.map((die) => [die.dieId, die.type])).toEqual([
      ['r:0', 'd20'],
      ['r:1:tens', 'd100:tens'],
      ['r:1:units', 'd100:units'],
    ]);
    for (const die of table) {
      expect(die.rotation).toEqual(renderer.dice.get(die.dieId)!.rotation);
      expect(die.position).toEqual(renderer.dice.get(die.dieId)!.position);
    }

    engine.clear();
    expect(engine.getDiceOnTable()).toEqual([]);
    engine.destroy();
    expect(engine.getDiceOnTable()).toEqual([]);
  });
});
