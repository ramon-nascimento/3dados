import { beforeAll, describe, expect, it } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { DieRegistry } from '../../src/core/die-definition';
import { DiceError } from '../../src/core/errors';
import type { DiceEventName } from '../../src/core/events';
import { readFace } from '../../src/core/face-reading';
import type { Quat, Vec3 } from '../../src/core/math';
import { createSeededRandomSource } from '../../src/core/random';
import type { RollOutcome } from '../../src/core/types';
import {
  DiceEngine,
  type EngineRenderer,
  type EngineSimulator,
  type RollHandle,
} from '../../src/integration/engine';
import { createPhysicsSimulator, type SimulationResult } from '../../src/physics/simulator';

/** Renderer sem GPU: guarda as transformações e deixa o teste avançar os quadros. */
class FakeRenderer implements EngineRenderer {
  readonly area = { width: 26, depth: 15 };
  readonly dice = new Map<string, { position: Vec3; rotation: Quat }>();
  loop: (() => void) | undefined;
  disposed = false;
  /** Quando definido, simula uma malha que exibe uma orientação diferente da pedida. */
  corruptRotation: Quat | undefined;

  addDie(dieId: string): void {
    this.dice.set(dieId, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
  }
  removeDie(dieId: string): void {
    this.dice.delete(dieId);
  }
  setDieTransform(dieId: string, position: Vec3, rotation: Quat): void {
    this.dice.set(dieId, { position, rotation });
  }
  getDieRotation(dieId: string): Quat {
    return this.corruptRotation ?? this.dice.get(dieId)!.rotation;
  }
  startLoop(onFrame: () => void): void {
    this.loop = onFrame;
  }
  stopLoop(): void {
    this.loop = undefined;
  }
  render(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

describe('DiceEngine', () => {
  let physics: EngineSimulator;

  beforeAll(async () => {
    physics = await createPhysicsSimulator();
  });

  function setup(simulator: EngineSimulator = physics, seed = 11) {
    const renderer = new FakeRenderer();
    let time = 0;
    const engine = new DiceEngine({
      renderer,
      simulator,
      rng: createSeededRandomSource(seed),
      registry: new DieRegistry([D6]),
      now: () => time,
    });
    const events: { name: DiceEventName; payload: unknown }[] = [];
    const names: DiceEventName[] = [
      'rollStarted',
      'diceCollided',
      'diceSettled',
      'rollCompleted',
      'rollCancelled',
      'rollFailed',
    ];
    for (const name of names) engine.on(name, (payload) => events.push({ name, payload }));

    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    /** Avança quadros de 1/60 s até a rolagem terminar. */
    const play = async (handle: RollHandle): Promise<RollOutcome> => {
      let done = false;
      void handle.result.then(() => (done = true));
      for (let frame = 0; frame < 2_000 && !done; frame++) {
        await tick();
        time += 1000 / 60;
        renderer.loop?.();
      }
      if (!done) throw new Error('a rolagem não terminou');
      return handle.result;
    };
    /** Espera a pré-simulação terminar e a animação começar. */
    const untilPlaying = async () => {
      for (let i = 0; i < 100 && !renderer.loop; i++) await tick();
      if (!renderer.loop) throw new Error('a animação não começou');
    };
    const displayed = () =>
      [...renderer.dice.values()].map(({ rotation }) => readFace(D6, rotation).face.value);
    const eventNames = () => events.map((event) => event.name);

    return { engine, renderer, events, eventNames, play, untilPlaying, displayed, tick };
  }

  it('modo autônomo: conclui com valores válidos, iguais aos exibidos', async () => {
    const { engine, play, displayed, eventNames } = setup();

    const outcome = await play(engine.roll({ id: 'r1', dice: [{ type: 'd6', count: 3 }] }));

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    const values = outcome.dice.map((die) => die.value);
    expect(values.every((value) => value >= 1 && value <= 6)).toBe(true);
    expect(displayed()).toEqual(values);
    expect(outcome.total).toBe(values.reduce((a, b) => a + b, 0));
    expect(outcome.dice.every((die) => die.source === 'rng' && !die.recovered)).toBe(true);
    expect(outcome.dice.map((die) => die.dieId)).toEqual(['r1:0', 'r1:1', 'r1:2']);
    expect(outcome.durationMs).toBeGreaterThan(0);

    const names = eventNames();
    expect(names[0]).toBe('rollStarted');
    expect(names.at(-1)).toBe('rollCompleted');
    expect(names.filter((name) => name === 'diceSettled')).toHaveLength(3);
    expect(names.filter((name) => name === 'diceCollided').length).toBeGreaterThan(0);
    expect(names.lastIndexOf('diceSettled')).toBeLessThan(names.indexOf('rollCompleted'));
  });

  it('modo controlado: exibe exatamente os valores pedidos', async () => {
    const { engine, play, displayed } = setup();

    const outcome = await play(
      engine.roll({ dice: [{ type: 'd6', values: [6, 1, 3, 4], role: 'damage' }] }),
    );

    expect(outcome).toMatchObject({
      status: 'completed',
      total: 14,
      dice: [
        { value: 6, source: 'predetermined', role: 'damage' },
        { value: 1, source: 'predetermined' },
        { value: 3, source: 'predetermined' },
        { value: 4, source: 'predetermined' },
      ],
    });
    expect(displayed()).toEqual([6, 1, 3, 4]);
  });

  it('modo controlado: todo valor é exibido a partir de qualquer face em que o dado caia', async () => {
    const pairs = new Set<string>();
    let lastSimulation: SimulationResult | undefined;
    const spy: EngineSimulator = {
      async simulate(request) {
        lastSimulation = await physics.simulate(request);
        return lastSimulation;
      },
    };
    const { engine, play, displayed } = setup(spy);

    for (let run = 0; run < 60; run++) {
      const values = [1, 2, 3, 4, 5, 6];
      const outcome = await play(
        engine.roll({ seed: 9_001 + run, dice: [{ type: 'd6', values }] }),
      );

      expect(outcome.status).toBe('completed');
      expect(displayed()).toEqual(values);
      lastSimulation!.landedFaces.forEach((landed, i) => pairs.add(`${values[i]}→${landed.value}`));
    }

    // As 36 combinações (valor pedido, face em que o corpo físico caiu) foram exercitadas.
    expect(pairs.size).toBe(36);
  });

  it('nunca conclui se a malha exibir um valor diferente do oficial', async () => {
    const { engine, renderer, play, eventNames } = setup();
    const handle = engine.roll({ dice: [{ type: 'd6', values: [1] }] });
    // Malha girada 90°: mostra outra face.
    renderer.corruptRotation = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

    const outcome = await play(handle);

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.error.code).toBe('RESULT_MISMATCH');
    expect(outcome.error.details).toMatchObject({ expected: 1 });
    expect(eventNames()).toContain('rollFailed');
    expect(eventNames()).not.toContain('rollCompleted');
    expect(renderer.dice.size).toBe(0);
  });

  it('também falha se a malha terminar inclinada', async () => {
    const { engine, renderer, play } = setup();
    const handle = engine.roll({ dice: [{ type: 'd6', values: [1] }] });
    const tilt = (10 * Math.PI) / 360;
    renderer.corruptRotation = { x: Math.sin(tilt), y: 0, z: 0, w: Math.cos(tilt) };

    const outcome = await play(handle);

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'RESULT_MISMATCH' } });
  });

  it('cancelar durante a animação remove os dados e emite rollCancelled', async () => {
    const { engine, renderer, untilPlaying, eventNames } = setup();
    const handle = engine.roll({ dice: [{ type: 'd6', count: 2 }], metadata: { playerId: 'p1' } });
    await untilPlaying();
    expect(renderer.dice.size).toBe(2);

    handle.cancel();
    const outcome = await handle.result;

    expect(outcome).toEqual({
      status: 'cancelled',
      rollId: handle.id,
      reason: 'caller',
      metadata: { playerId: 'p1' },
    });
    expect(renderer.dice.size).toBe(0);
    expect(renderer.loop).toBeUndefined();
    expect(eventNames()).toEqual(['rollStarted', 'rollCancelled']);
  });

  it('cancelar antes de a simulação terminar não mostra nenhum dado', async () => {
    const { engine, renderer, eventNames, tick } = setup();
    const handle = engine.roll({ dice: [{ type: 'd6' }] });

    expect(engine.cancel(handle.id)).toBe(true);
    const outcome = await handle.result;
    for (let i = 0; i < 20; i++) await tick();

    expect(outcome.status).toBe('cancelled');
    expect(renderer.dice.size).toBe(0);
    expect(renderer.loop).toBeUndefined();
    expect(eventNames()).toEqual(['rollCancelled']);
  });

  it('cancel devolve false para outra rolagem ou sem rolagem ativa', async () => {
    const { engine, play } = setup();
    expect(engine.cancel()).toBe(false);

    const handle = engine.roll({ dice: [{ type: 'd6' }] });
    expect(engine.cancel('outra')).toBe(false);
    const outcome = await play(handle);
    handle.cancel();

    expect(outcome.status).toBe('completed');
    expect(engine.cancel(handle.id)).toBe(false);
  });

  it('uma nova rolagem substitui a anterior e limpa a mesa', async () => {
    const { engine, renderer, play, untilPlaying } = setup();
    const first = engine.roll({ id: 'a', dice: [{ type: 'd6', count: 3 }] });
    await untilPlaying();

    const second = engine.roll({ id: 'b', dice: [{ type: 'd6' }] });

    expect(await first.result).toMatchObject({ status: 'cancelled', reason: 'superseded' });
    expect(await play(second)).toMatchObject({ status: 'completed', rollId: 'b' });
    expect([...renderer.dice.keys()]).toEqual(['b:0']);
  });

  it('os dados ficam na mesa após concluir, até clear()', async () => {
    const { engine, renderer, play } = setup();
    await play(engine.roll({ dice: [{ type: 'd6', count: 2 }] }));
    expect(renderer.dice.size).toBe(2);

    engine.clear();

    expect(renderer.dice.size).toBe(0);
  });

  it('clear() durante a rolagem cancela com o motivo "cleared"', async () => {
    const { engine, untilPlaying } = setup();
    const handle = engine.roll({ dice: [{ type: 'd6' }] });
    await untilPlaying();

    engine.clear();

    expect(await handle.result).toMatchObject({ status: 'cancelled', reason: 'cleared' });
  });

  it('destroy() cancela, libera o renderer e impede novas rolagens', async () => {
    const { engine, renderer, untilPlaying, events } = setup();
    const handle = engine.roll({ dice: [{ type: 'd6' }] });
    await untilPlaying();

    engine.destroy();
    engine.destroy();
    const after = await engine.roll({ dice: [{ type: 'd6' }] }).result;

    expect(await handle.result).toMatchObject({ status: 'cancelled', reason: 'destroyed' });
    expect(renderer.disposed).toBe(true);
    expect(renderer.dice.size).toBe(0);
    expect(after).toMatchObject({ status: 'failed', error: { code: 'ENGINE_DESTROYED' } });
    // Depois de destruído, nenhum ouvinte é chamado.
    expect(events.at(-1)?.name).toBe('rollCancelled');
  });

  it('pedido inválido falha sem interromper a rolagem em andamento', async () => {
    const { engine, play, untilPlaying, eventNames } = setup();
    const running = engine.roll({ dice: [{ type: 'd6' }] });
    await untilPlaying();

    const invalid = await engine.roll({ dice: [{ type: 'd6', values: [9] }] }).result;
    const unknown = await engine.roll({ dice: [{ type: 'd7' }] }).result;

    expect(invalid).toMatchObject({ status: 'failed', error: { code: 'INVALID_REQUEST' } });
    expect(unknown).toMatchObject({ status: 'failed', error: { code: 'UNKNOWN_DIE_TYPE' } });
    expect(eventNames().filter((name) => name === 'rollFailed')).toHaveLength(2);
    expect(await play(running)).toMatchObject({ status: 'completed' });
  });

  it('falha de simulação vira rollFailed com o erro original', async () => {
    const failing: EngineSimulator = {
      simulate: () => Promise.reject(new DiceError('SIMULATION_FAILED', 'não convergiu')),
    };
    const { engine, renderer, eventNames } = setup(failing);

    const outcome = await engine.roll({ dice: [{ type: 'd6' }] }).result;

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'SIMULATION_FAILED' } });
    expect(eventNames()).toEqual(['rollFailed']);
    expect(renderer.dice.size).toBe(0);
  });

  it('erro inesperado é embrulhado como INTERNAL_ERROR, com a causa', async () => {
    const cause = new Error('quebrou');
    const broken: EngineSimulator = { simulate: () => Promise.reject(cause) };
    const { engine } = setup(broken);

    const outcome = await engine.roll({ dice: [{ type: 'd6' }] }).result;

    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'INTERNAL_ERROR' } });
    if (outcome.status === 'failed') expect(outcome.error.cause).toBe(cause);
  });

  it('devolve metadata sem alteração em eventos e no desfecho', async () => {
    const { engine, play, events } = setup();
    const metadata = {
      playerId: 'p1',
      roomId: 'mesa',
      visibility: 'public' as const,
      extra: [1, 2],
    };

    const outcome = await play(engine.roll({ dice: [{ type: 'd6' }], metadata }));

    expect(outcome).toMatchObject({ metadata });
    expect(events.find((event) => event.name === 'rollStarted')?.payload).toMatchObject({
      metadata,
      simulation: {
        attempts: expect.any(Number) as number,
        cpuTimeMs: expect.any(Number) as number,
      },
    });
  });

  it('a mesma semente reproduz a mesma animação; os valores não dependem dela', async () => {
    const run = async (seed: number) => {
      const context = setup(physics, 5);
      const outcome = await context.play(
        context.engine.roll({ seed, dice: [{ type: 'd6', count: 2 }] }),
      );
      return {
        values: outcome.status === 'completed' ? outcome.dice.map((die) => die.value) : [],
        positions: [...context.renderer.dice.values()].map(({ position }) => position),
      };
    };
    const [a, b, c] = [await run(1), await run(1), await run(2)];

    expect(b.positions).toEqual(a.positions);
    expect(c.positions).not.toEqual(a.positions);
    expect(c.values).toEqual(a.values);
  });

  it('um ouvinte pode iniciar outra rolagem durante um evento', async () => {
    const { engine, play } = setup();
    let chained: RollHandle | undefined;
    engine.on('diceSettled', () => {
      chained ??= engine.roll({ id: 'encadeada', dice: [{ type: 'd6', values: [2] }] });
    });

    const first = await play(engine.roll({ id: 'primeira', dice: [{ type: 'd6', count: 2 }] }));

    expect(first).toMatchObject({ status: 'cancelled', reason: 'superseded' });
    expect(await play(chained!)).toMatchObject({ status: 'completed', total: 2 });
  });
});
