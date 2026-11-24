import { beforeAll, describe, expect, it } from 'vitest';
import { isDiceError } from '../../src/core/errors';
import type { RollOutcome } from '../../src/core/types';
import type { EngineSimulator } from '../../src/integration/engine';
import { parseRollOptions } from '../../src/integration/options';
import { createPhysicsSimulator } from '../../src/physics/simulator';
import { createHarness } from './helpers/engine-harness';

let physics: EngineSimulator;

beforeAll(async () => {
  physics = await createPhysicsSimulator();
});

/** Acompanha o desfecho sem esperar por ele. */
function track(result: Promise<RollOutcome>): { outcome: RollOutcome | undefined } {
  const box: { outcome: RollOutcome | undefined } = { outcome: undefined };
  void result.then((outcome) => (box.outcome = outcome));
  return box;
}

describe('rolagens simultâneas: fila (padrão)', () => {
  it('a segunda espera a primeira terminar e o tempo mínimo na mesa', async () => {
    const h = createHarness(physics, { queue: { holdMs: 1500 } });
    const first = h.engine.roll({ id: 'a', dice: [{ type: 'd6', values: [3] }] });
    const second = h.engine.roll({ id: 'b', dice: [{ type: 'd20', values: [17] }] });
    const secondState = track(second.result);
    let completedAt = Number.NaN;
    h.engine.on('rollCompleted', ({ rollId }) => {
      if (rollId === 'a') completedAt = h.now();
    });
    expect(h.engine.getState()).toMatchObject({
      status: 'rolling',
      activeRoll: { rollId: 'a', phase: 'simulating' },
      queue: [{ rollId: 'b', phase: 'queued' }],
    });

    expect(await h.play(first)).toMatchObject({ status: 'completed', total: 3 });
    // Os dados da primeira ficam na mesa; a segunda ainda espera.
    expect(h.engine.getState()).toMatchObject({
      activeRoll: null,
      tableRollId: 'a',
      diceOnTable: 1,
      queue: [{ rollId: 'b' }],
    });
    expect(h.renderer.displayed()).toEqual({ 'a:0': 3 });
    expect(secondState.outcome).toBeUndefined();

    // O temporizador da fila só dispara depois do tempo mínimo.
    expect(h.flushTimers()).toBe(true);
    // Folga para o arredondamento: o relógio do teste soma frações de quadro.
    expect(h.now() - completedAt).toBeGreaterThanOrEqual(1500 - 1e-6);
    expect(h.engine.getState().activeRoll?.rollId).toBe('b');
    expect(await h.play(second)).toMatchObject({ status: 'completed', total: 17 });
    expect(h.renderer.displayed()).toEqual({ 'b:0': 17 });
    expect(h.engine.getStats().rolls).toMatchObject({ requested: 2, completed: 2, queuePeak: 1 });
  });

  it('os eventos seguem a ordem: a segunda só começa depois de a primeira concluir', async () => {
    const h = createHarness(physics);
    const first = h.engine.roll({ id: 'a', dice: [{ type: 'd6' }] });
    const second = h.engine.roll({ id: 'b', dice: [{ type: 'd6' }] });
    await h.play(first);
    await h.play(second);
    const lifecycle = h.events
      .filter(({ name }) => name === 'rollStarted' || name === 'rollCompleted')
      .map(({ name, payload }) => `${name}:${(payload as { rollId: string }).rollId}`);
    expect(lifecycle).toEqual([
      'rollStarted:a',
      'rollCompleted:a',
      'rollStarted:b',
      'rollCompleted:b',
    ]);
  });

  it('uma rolagem pedida logo depois de outra concluir respeita o tempo mínimo', async () => {
    const h = createHarness(physics, { queue: { holdMs: 800 } });
    await h.play(h.engine.roll({ id: 'a', dice: [{ type: 'd6' }] }));
    const next = h.engine.roll({ id: 'b', dice: [{ type: 'd6' }] });
    expect(h.engine.getState().queue).toEqual([{ rollId: 'b', phase: 'queued' }]);
    expect(h.flushTimers()).toBe(true);
    expect(h.engine.getState().activeRoll?.rollId).toBe('b');
    expect((await h.play(next)).status).toBe('completed');
  });

  it('valores autônomos são decididos no pedido, não quando a rolagem sai da fila', async () => {
    // Mesma semente, mesmos pedidos: com ou sem espera, os mesmos valores.
    const values = async (holdMs: number) => {
      const h = createHarness(physics, { seed: 5, queue: { holdMs } });
      const first = h.engine.roll({ dice: [{ type: 'd20', count: 3 }] });
      const second = h.engine.roll({ dice: [{ type: 'd20', count: 3 }] });
      await h.play(first);
      while (h.engine.getState().activeRoll === null && h.flushTimers());
      const outcome = await h.play(second);
      return outcome.status === 'completed' ? outcome.dice.map((d) => d.value) : [];
    };
    expect(await values(0)).toEqual(await values(2000));
  });

  it('cancelar uma rolagem da fila não mexe na que está na mesa', async () => {
    const h = createHarness(physics);
    const first = h.engine.roll({ id: 'a', dice: [{ type: 'd6' }] });
    const second = h.engine.roll({ id: 'b', dice: [{ type: 'd6' }] });
    const third = h.engine.roll({ id: 'c', dice: [{ type: 'd6' }] });
    second.cancel();
    expect(await second.result).toMatchObject({ status: 'cancelled', reason: 'caller' });
    expect(h.engine.cancel('c')).toBe(true);
    expect(await third.result).toMatchObject({ status: 'cancelled', reason: 'caller' });
    expect(h.engine.cancel('c')).toBe(false);
    expect((await h.play(first)).status).toBe('completed');
    expect(h.engine.getState()).toMatchObject({ status: 'idle', queue: [] });
  });

  it('cancelar a rolagem na mesa passa logo para a próxima', async () => {
    const h = createHarness(physics, { queue: { holdMs: 5000 } });
    const first = h.engine.roll({ id: 'a', dice: [{ type: 'd6' }] });
    const second = h.engine.roll({ id: 'b', dice: [{ type: 'd6', values: [6] }] });
    await h.tick();
    expect(h.engine.cancel()).toBe(true);
    expect(await first.result).toMatchObject({ status: 'cancelled', reason: 'caller' });
    // Sem dados concluídos na mesa, não há tempo mínimo a esperar.
    expect(h.engine.getState().activeRoll?.rollId).toBe('b');
    expect(await h.play(second)).toMatchObject({ status: 'completed', total: 6 });
  });

  it('fila cheia: a mais antiga que espera é cancelada como `superseded`', async () => {
    const h = createHarness(physics, { queue: { maxPending: 2 } });
    const active = h.engine.roll({ id: 'a', dice: [{ type: 'd6' }] });
    const waiting = ['b', 'c', 'd'].map((id) => h.engine.roll({ id, dice: [{ type: 'd6' }] }));
    expect(await waiting[0]!.result).toMatchObject({ status: 'cancelled', reason: 'superseded' });
    expect(h.engine.getState().queue.map((roll) => roll.rollId)).toEqual(['c', 'd']);
    expect(h.engine.getStats().rolls.queuePeak).toBe(3);
    expect((await h.play(active)).status).toBe('completed');
  });

  it('`clear` cancela a rolagem na mesa e a fila', async () => {
    const h = createHarness(physics);
    const handles = ['a', 'b', 'c'].map((id) => h.engine.roll({ id, dice: [{ type: 'd6' }] }));
    await h.tick();
    h.engine.clear();
    for (const handle of handles) {
      expect(await handle.result).toMatchObject({ status: 'cancelled', reason: 'cleared' });
    }
    expect(h.engine.getState()).toMatchObject({
      status: 'idle',
      activeRoll: null,
      queue: [],
      diceOnTable: 0,
      tableRollId: null,
    });
  });

  it('`destroy` cancela a fila e nenhuma rolagem começa depois', async () => {
    const h = createHarness(physics);
    const handles = ['a', 'b'].map((id) => h.engine.roll({ id, dice: [{ type: 'd6' }] }));
    h.engine.destroy();
    for (const handle of handles) {
      expect(await handle.result).toMatchObject({ status: 'cancelled', reason: 'destroyed' });
    }
    expect(h.pendingTimers()).toBe(0);
    expect(h.engine.getState()).toMatchObject({ status: 'destroyed', queue: [] });
  });

  it('um pedido inválido falha na hora e não entra na fila', async () => {
    const h = createHarness(physics);
    const first = h.engine.roll({ dice: [{ type: 'd6' }] });
    const invalid = h.engine.roll({ dice: [{ type: 'd7' }] });
    expect(await invalid.result).toMatchObject({ status: 'failed' });
    expect(h.engine.getState().queue).toEqual([]);
    expect((await h.play(first)).status).toBe('completed');
    expect(h.engine.getStats().rolls).toMatchObject({ requested: 2, completed: 1, failed: 1 });
  });
});

describe('rolagens simultâneas: substituição', () => {
  it('a rolagem nova cancela a anterior (`superseded`)', async () => {
    const h = createHarness(physics, { concurrency: 'replace' });
    const first = h.engine.roll({ id: 'a', dice: [{ type: 'd6' }] });
    const second = h.engine.roll({ id: 'b', dice: [{ type: 'd6', values: [2] }] });
    expect(await first.result).toMatchObject({ status: 'cancelled', reason: 'superseded' });
    expect(h.engine.getState()).toMatchObject({ concurrency: 'replace', queue: [] });
    expect(await h.play(second)).toMatchObject({ status: 'completed', total: 2 });
  });
});

describe('opções da fila', () => {
  it.each([
    [{ concurrency: 'serial' }, 'concurrency'],
    [{ queue: { maxPending: 0 } }, 'queue.maxPending'],
    [{ queue: { maxPending: 2.5 } }, 'queue.maxPending'],
    [{ queue: { holdMs: -1 } }, 'queue.holdMs'],
    [{ queue: { holdMs: 20_000 } }, 'queue.holdMs'],
    [{ queue: { size: 3 } }, 'queue.size'],
    [{ queue: 3 }, 'queue'],
    [{ remote: { maxAgeMs: -5 } }, 'remote.maxAgeMs'],
    [{ remote: { strict: true } }, 'remote.strict'],
  ])('%j é recusado em %s', (options, path) => {
    try {
      parseRollOptions(options);
      throw new Error('aceito');
    } catch (error) {
      expect(isDiceError(error) && error.code).toBe('INVALID_ARGUMENT');
      expect(isDiceError(error) && error.details?.path).toBe(path);
    }
  });

  it('padrões: fila de 8, 1500 ms na mesa, sem idade máxima', () => {
    expect(parseRollOptions({})).toEqual({
      concurrency: 'queue',
      maxPending: 8,
      holdMs: 1500,
      maxAgeMs: undefined,
    });
  });
});
