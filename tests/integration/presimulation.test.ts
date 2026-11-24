import { beforeAll, describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { FLAT_ALIGNMENT_MIN, readFace } from '../../src/core/face-reading';
import { rotateVector } from '../../src/core/math';
import { finalPosition, finalRotation, frameCount } from '../../src/core/trajectory';
import {
  createPhysicsSimulator,
  type PhysicsSimulator,
  type SimulationRequest,
} from '../../src/physics/simulator';

const AREA = { width: 26, depth: 15 };

function request(count: number, seed: number): SimulationRequest {
  return {
    dice: Array.from({ length: count }, (_, i) => ({ dieId: `die-${i}`, definition: D6 })),
    area: AREA,
    seed,
  };
}

describe('pré-simulação do d6', () => {
  let simulator: PhysicsSimulator;

  beforeAll(async () => {
    simulator = await createPhysicsSimulator();
  });

  it('1.000 pré-simulações: nenhum resultado ambíguo é aceito e a leitura é a face de cima', async () => {
    const faceCounts = new Map<number, number>();
    let diceChecked = 0;
    let diceExpected = 0;

    for (let run = 0; run < 1_000; run++) {
      const count = 1 + (run % 6);
      diceExpected += count;
      const result = await simulator.simulate(request(count, 1_000_003 * (run + 1)));
      const { recording, landedFaces } = result;

      expect(recording.dice).toHaveLength(count);
      expect(landedFaces).toHaveLength(count);

      recording.dice.forEach((trajectory, i) => {
        const rotation = finalRotation(trajectory);
        const position = finalPosition(trajectory);
        const reading = readFace(D6, rotation);
        const landed = landedFaces[i]!;

        // Sem ambiguidade: assentado em uma face, com folga para a segunda melhor.
        expect(reading.alignment).toBeGreaterThanOrEqual(FLAT_ALIGNMENT_MIN);
        expect(reading.margin).toBeGreaterThan(0.9);
        expect(reading.face.id).toBe(landed.id);

        // Verificação geométrica independente da leitura por direção:
        // os quatro vértices da face lida são os mais altos, a uma aresta da mesa.
        const heights = D6.vertices.map((vertex) => position.y + rotateVector(rotation, vertex).y);
        const faceHeights = landed.vertexIndices.map((index) => heights[index]!);
        const otherHeights = heights.filter((_, index) => !landed.vertexIndices.includes(index));
        expect(Math.min(...faceHeights)).toBeGreaterThan(Math.max(...otherHeights) + 0.9);
        for (const height of faceHeights) expect(height).toBeCloseTo(1, 1);
        expect(Math.min(...heights)).toBeCloseTo(0, 1);

        // Dentro da área e com a gravação bem formada.
        expect(Math.abs(position.x)).toBeLessThanOrEqual(AREA.width / 2);
        expect(Math.abs(position.z)).toBeLessThanOrEqual(AREA.depth / 2);
        expect(frameCount(trajectory)).toBe(recording.stepCount + 1);
        expect(trajectory.rotations).toHaveLength((recording.stepCount + 1) * 4);
        expect(trajectory.settledStep).toBeGreaterThan(0);
        expect(trajectory.settledStep).toBeLessThanOrEqual(recording.stepCount);

        faceCounts.set(landed.value, (faceCounts.get(landed.value) ?? 0) + 1);
        diceChecked++;
      });
    }

    expect(diceChecked).toBe(diceExpected);
    expect(diceChecked).toBeGreaterThan(3_000);
    // Sanidade: a física não favorece grosseiramente nenhuma face. (Os valores
    // oficiais não vêm daqui: vêm do RNG, testado à parte.)
    expect([...faceCounts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of faceCounts.values()) expect(count).toBeGreaterThan(diceChecked / 6 / 2);
  });

  it('registra colisões em ordem, com intensidade entre 0 e 1', async () => {
    const { recording } = await simulator.simulate(request(4, 42));
    const ids = new Set(recording.dice.map((die) => die.dieId));

    expect(recording.collisions.length).toBeGreaterThan(0);
    expect(recording.collisions.some((collision) => collision.otherDieId === null)).toBe(true);
    let previousStep = 0;
    for (const collision of recording.collisions) {
      expect(collision.step).toBeGreaterThanOrEqual(previousStep);
      expect(collision.step).toBeLessThanOrEqual(recording.stepCount);
      expect(collision.intensity).toBeGreaterThan(0);
      expect(collision.intensity).toBeLessThanOrEqual(1);
      expect(ids.has(collision.dieId)).toBe(true);
      if (collision.otherDieId !== null) expect(ids.has(collision.otherDieId)).toBe(true);
      previousStep = collision.step;
    }
  });

  it('a mesma semente reproduz a mesma trajetória na mesma máquina', async () => {
    const a = await simulator.simulate(request(3, 2026));
    const b = await simulator.simulate(request(3, 2026));

    expect(b.recording.stepCount).toBe(a.recording.stepCount);
    expect(b.recording.dice[0]!.positions).toEqual(a.recording.dice[0]!.positions);
    expect(b.landedFaces.map((face) => face.id)).toEqual(a.landedFaces.map((face) => face.id));
  });

  it('sementes diferentes produzem trajetórias diferentes', async () => {
    const a = await simulator.simulate(request(1, 1));
    const b = await simulator.simulate(request(1, 2));

    expect(finalPosition(b.recording.dice[0]!)).not.toEqual(finalPosition(a.recording.dice[0]!));
  });

  it.each([
    [2, 1],
    [12, 77],
    [20, 5],
    [20, 6],
    [20, 7],
    [20, 8],
  ])('%i dados (semente %i) começam separados, sem sobreposição inicial', async (count, seed) => {
    const { recording } = await simulator.simulate(request(count, seed));
    const starts = recording.dice.map((die) => ({
      x: die.positions[0]!,
      y: die.positions[1]!,
      z: die.positions[2]!,
    }));

    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const a = starts[i]!;
        const b = starts[j]!;
        // Esferas que contêm dois d6 (raio √3/2) não se tocam acima de √3.
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(Math.sqrt(3));
      }
    }
  });

  it('falha com SIMULATION_FAILED quando nenhuma tentativa converge', async () => {
    const impossible = await createPhysicsSimulator({ maxDuration: 0.05, maxAttempts: 3 });

    await expect(impossible.simulate(request(2, 5))).rejects.toMatchObject({
      code: 'SIMULATION_FAILED',
      details: { rejections: ['timeout', 'timeout', 'timeout'] },
    });
  });
});
