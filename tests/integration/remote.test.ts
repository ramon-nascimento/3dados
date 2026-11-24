import { beforeAll, describe, expect, it } from 'vitest';
import type { RollEnvelope } from '../../src/core/remote';
import type { RollOutcome } from '../../src/core/types';
import type { EngineSimulator, RollHandle } from '../../src/integration/engine';
import { createPhysicsSimulator } from '../../src/physics/simulator';
import { WALL_CLOCK_EPOCH, createHarness } from './helpers/engine-harness';

let physics: EngineSimulator;

beforeAll(async () => {
  physics = await createPhysicsSimulator();
});

const ROOM = 'mesa-1';

function requested(
  sequence: number,
  values: number[],
  extra: Partial<Extract<RollEnvelope, { type: 'roll.requested' }>> = {},
): RollEnvelope {
  return {
    protocolVersion: 1,
    type: 'roll.requested',
    roomId: ROOM,
    playerId: 'ana',
    sequence,
    sentAt: WALL_CLOCK_EPOCH,
    rollId: `r${sequence}`,
    payload: { dice: [{ type: 'd20', values }] },
    ...extra,
  };
}
function cancelled(sequence: number, rollId: string): RollEnvelope {
  return {
    protocolVersion: 1,
    type: 'roll.cancelled',
    roomId: ROOM,
    playerId: 'mestre',
    sequence,
    sentAt: WALL_CLOCK_EPOCH,
    rollId,
  };
}
function cleared(sequence: number): RollEnvelope {
  return {
    protocolVersion: 1,
    type: 'table.cleared',
    roomId: ROOM,
    playerId: 'mestre',
    sequence,
    sentAt: WALL_CLOCK_EPOCH,
  };
}

/** Ids das rolagens que chegaram a começar, na ordem. */
function started(events: { name: string; payload: unknown }[]): string[] {
  return events
    .filter(({ name }) => name === 'rollStarted')
    .map(({ payload }) => (payload as { rollId: string }).rollId);
}

/** Avança a fila e as animações até a mesa ficar parada. */
async function settle(h: ReturnType<typeof createHarness>): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    const { activeRoll, queue } = h.engine.getState();
    if (activeRoll) {
      await h.runFrames(3_000);
      await h.tick();
    } else if (queue.length > 0) {
      h.flushTimers();
    } else {
      return;
    }
  }
  throw new Error('a mesa não parou');
}

function rollOf(receipt: { roll?: unknown }): RollHandle {
  if (!receipt.roll) throw new Error('a mensagem não criou rolagem');
  return receipt.roll as RollHandle;
}

describe('engine.remote: pedidos', () => {
  it('exibe os valores do servidor e repassa os dados do envelope em `metadata`', async () => {
    const h = createHarness(physics);
    const receipt = h.engine.remote.receive(
      requested(1, [20], {
        visibility: 'blind',
        payload: { dice: [{ type: 'd20', values: [20], role: 'test' }], metadata: { ação: 'x' } },
      }),
    );
    expect(receipt).toMatchObject({ status: 'applied', type: 'roll.requested', rollId: 'r1' });
    const outcome = await h.play(rollOf(receipt));
    expect(outcome).toMatchObject({
      status: 'completed',
      rollId: 'r1',
      total: 20,
      dice: [{ value: 20, role: 'test', source: 'predetermined' }],
      metadata: {
        ação: 'x',
        playerId: 'ana',
        roomId: ROOM,
        visibility: 'blind',
        sequence: 1,
        sentAt: WALL_CLOCK_EPOCH,
      },
    });
    expect(h.renderer.displayed()).toEqual({ 'r1:0': 20 });
  });

  it('`visibility` ausente vira `public`; a aplicação não sobrescreve os campos do envelope', async () => {
    const h = createHarness(physics);
    const receipt = h.engine.remote.receive(
      requested(1, [4], {
        payload: {
          dice: [{ type: 'd20', values: [4] }],
          metadata: { playerId: 'impostor', sequence: 99 },
        },
      }),
    );
    const outcome = await h.play(rollOf(receipt));
    expect(outcome.metadata).toMatchObject({ playerId: 'ana', sequence: 1, visibility: 'public' });
  });
});

describe('engine.remote: mensagens duplicadas', () => {
  it('a mesma mensagem duas vezes gera uma rolagem só', async () => {
    const h = createHarness(physics);
    const message = requested(1, [7]);
    const first = h.engine.remote.receive(message);
    expect(h.engine.remote.receive(message)).toMatchObject({
      status: 'duplicate',
      reason: 'same-sequence',
    });
    // Reenvio do servidor com outra sequência e o mesmo rollId.
    expect(h.engine.remote.receive({ ...message, sequence: 2 })).toMatchObject({
      status: 'duplicate',
      reason: 'same-roll',
    });
    await h.play(rollOf(first));
    // Depois de concluída, a repetição continua sem efeito: os dados ficam como estão.
    expect(h.engine.remote.receive(message).status).toBe('duplicate');
    await settle(h);
    expect(started(h.events)).toEqual(['r1']);
    expect(h.engine.getState()).toMatchObject({ tableRollId: 'r1', queue: [] });
    expect(h.engine.remote.getStats()).toEqual({
      received: 4,
      applied: 1,
      duplicate: 3,
      stale: 0,
      cancelled: 0,
      rejected: 0,
    });
  });
});

describe('engine.remote: mensagens fora de ordem', () => {
  it('um pedido mais antigo que o último aplicado nunca aparece', async () => {
    const h = createHarness(physics);
    h.engine.remote.receive(requested(1, [1]));
    h.engine.remote.receive(requested(3, [3]));
    expect(h.engine.remote.receive(requested(2, [2]))).toMatchObject({
      status: 'stale',
      reason: 'out-of-order',
    });
    await settle(h);
    expect(started(h.events)).toEqual(['r1', 'r3']);
    expect(h.renderer.displayed()).toEqual({ 'r3:0': 3 });
  });

  it('dois clientes que recebem em ordens diferentes terminam com a mesma mesa', async () => {
    const messages = [requested(1, [11]), requested(2, [12]), requested(4, [14])];
    const orders = [
      [0, 1, 2],
      [2, 0, 1],
      [1, 0, 2, 1],
      [0, 2, 0, 1, 2],
    ];
    const tables = [];
    for (const order of orders) {
      const h = createHarness(physics);
      for (const index of order) h.engine.remote.receive(messages[index]!);
      await settle(h);
      tables.push({ table: h.engine.getState().tableRollId, shown: h.renderer.displayed() });
    }
    for (const table of tables) expect(table).toEqual({ table: 'r4', shown: { 'r4:0': 14 } });
  });

  it('um pedido anterior a `table.cleared` é ignorado', async () => {
    const h = createHarness(physics);
    expect(h.engine.remote.receive(cleared(5)).status).toBe('applied');
    expect(h.engine.remote.receive(requested(4, [4]))).toMatchObject({
      status: 'stale',
      reason: 'before-clear',
    });
    await settle(h);
    expect(started(h.events)).toEqual([]);
  });

  it('uma limpeza atrasada não apaga uma rolagem mais nova', async () => {
    const h = createHarness(physics);
    const receipt = h.engine.remote.receive(requested(6, [6]));
    expect(h.engine.remote.receive(cleared(5))).toMatchObject({
      status: 'stale',
      reason: 'out-of-order',
    });
    expect((await h.play(rollOf(receipt))).status).toBe('completed');
    expect(h.renderer.displayed()).toEqual({ 'r6:0': 6 });
  });

  it('mensagens mais velhas que `maxAgeMs` são descartadas', () => {
    const h = createHarness(physics, { remote: { maxAgeMs: 2_000 } });
    expect(
      h.engine.remote.receive(requested(1, [1], { sentAt: WALL_CLOCK_EPOCH - 2_500 })),
    ).toMatchObject({ status: 'stale', reason: 'expired' });
    expect(
      h.engine.remote.receive(requested(2, [2], { sentAt: WALL_CLOCK_EPOCH - 1_500 })).status,
    ).toBe('applied');
  });
});

describe('engine.remote: cancelamentos', () => {
  it('cancelamento que chega antes do pedido impede a rolagem', async () => {
    const h = createHarness(physics);
    expect(h.engine.remote.receive(cancelled(2, 'r1'))).toMatchObject({
      status: 'applied',
      reason: 'awaiting-request',
    });
    expect(h.engine.remote.receive(requested(1, [9]))).toMatchObject({
      status: 'cancelled',
      reason: 'cancelled-before-request',
    });
    await settle(h);
    expect(started(h.events)).toEqual([]);
    expect(h.events.map(({ name }) => name)).toEqual([]);
  });

  it('cancela a rolagem em andamento, com motivo `remote`', async () => {
    const h = createHarness(physics);
    const receipt = h.engine.remote.receive(requested(1, [5]));
    await h.tick();
    await h.runFrames(10);
    expect(h.engine.remote.receive(cancelled(2, 'r1')).status).toBe('applied');
    expect(await rollOf(receipt).result).toMatchObject({ status: 'cancelled', reason: 'remote' });
    expect(h.engine.getState().diceOnTable).toBe(0);
  });

  it('cancela uma rolagem que ainda espera na fila sem mexer na que está na mesa', async () => {
    const h = createHarness(physics);
    const first = rollOf(h.engine.remote.receive(requested(1, [1])));
    const second = rollOf(h.engine.remote.receive(requested(2, [2])));
    expect(h.engine.remote.receive(cancelled(3, 'r2')).status).toBe('applied');
    expect(await second.result).toMatchObject({ status: 'cancelled', reason: 'remote' });
    expect((await h.play(first)).status).toBe('completed');
    expect(h.renderer.displayed()).toEqual({ 'r1:0': 1 });
  });

  it('cancelamento obsoleto (a rolagem já terminou) não tira os dados da mesa', async () => {
    const h = createHarness(physics);
    const first = rollOf(h.engine.remote.receive(requested(1, [8])));
    await h.play(first);
    expect(h.engine.remote.receive(cancelled(2, 'r1'))).toMatchObject({
      status: 'stale',
      reason: 'already-finished',
    });
    expect(h.renderer.displayed()).toEqual({ 'r1:0': 8 });
    expect(h.events.some(({ name }) => name === 'rollCancelled')).toBe(false);
  });

  it('cancelamento de uma rolagem não afeta outra', async () => {
    const h = createHarness(physics);
    const first = rollOf(h.engine.remote.receive(requested(1, [3])));
    h.engine.remote.receive(cancelled(2, 'r9'));
    expect((await h.play(first)).status).toBe('completed');
  });
});

describe('engine.remote: limpeza da mesa', () => {
  it('`table.cleared` cancela a rolagem na mesa e a fila', async () => {
    const h = createHarness(physics);
    const handles = [1, 2, 3].map((n) => rollOf(h.engine.remote.receive(requested(n, [n]))));
    await h.tick();
    expect(h.engine.remote.receive(cleared(4)).status).toBe('applied');
    const outcomes: RollOutcome[] = await Promise.all(handles.map((handle) => handle.result));
    expect(outcomes.map((o) => o.status === 'cancelled' && o.reason)).toEqual([
      'cleared',
      'cleared',
      'cleared',
    ]);
    expect(h.engine.getState()).toMatchObject({ status: 'idle', diceOnTable: 0 });
  });
});

describe('engine.remote: mensagens recusadas', () => {
  it('rolagem com valor impossível: `invalid-roll` com o erro do pedido', () => {
    const h = createHarness(physics);
    const receipt = h.engine.remote.receive(requested(1, [21]));
    expect(receipt).toMatchObject({ status: 'rejected', reason: 'invalid-roll' });
    expect(receipt.error?.code).toBe('INVALID_REQUEST');
    expect(h.events.map(({ name }) => name)).toEqual(['rollFailed']);
  });

  it('sem valores, de versão desconhecida ou malformada: recusada sem lançar', () => {
    const h = createHarness(physics);
    const noValues = { ...requested(1, [1]), payload: { dice: [{ type: 'd6' }] } };
    expect(h.engine.remote.receive(noValues)).toMatchObject({
      status: 'rejected',
      reason: 'invalid-message',
      error: { code: 'INVALID_MESSAGE' },
    });
    expect(h.engine.remote.receive({ ...requested(2, [1]), protocolVersion: 2 })).toMatchObject({
      status: 'rejected',
      reason: 'unsupported-version',
    });
    expect(h.engine.remote.receive('{"type":"roll.requested"}').status).toBe('rejected');
    expect(h.engine.remote.receive(undefined).status).toBe('rejected');
    expect(h.engine.getState().status).toBe('idle');
    expect(h.engine.remote.getStats()).toMatchObject({ received: 4, rejected: 4 });
  });

  it('depois de `destroy`, recusa com `ENGINE_DESTROYED`', () => {
    const h = createHarness(physics);
    h.engine.destroy();
    expect(h.engine.remote.receive(requested(1, [1]))).toMatchObject({
      status: 'rejected',
      error: { code: 'ENGINE_DESTROYED' },
    });
  });
});

describe('getState e getStats', () => {
  it('o retrato é uma cópia serializável', () => {
    const h = createHarness(physics);
    const state = h.engine.getState();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state).toMatchObject({
      status: 'idle',
      activeRoll: null,
      tableRollId: null,
      diceOnTable: 0,
      concurrency: 'queue',
      presentation: 'overlay',
      quality: 'high',
      defaultTheme: 'default',
      themes: ['default'],
      audio: { enabled: false, state: 'off' },
      effects: { level: 'off', levelSetting: 'off' },
    });
    expect(state.dieTypes).toEqual(expect.arrayContaining(['d4', 'd6', 'd20', 'd100']));
    (state.queue as unknown[]).push('x');
    expect(h.engine.getState().queue).toEqual([]);
  });

  it('as estatísticas da simulação são as medidas em cada rolagem', async () => {
    const h = createHarness(physics);
    expect(h.engine.getStats().simulation.last).toBeNull();
    const simulations: { attempts: number; cpuTimeMs: number }[] = [];
    h.engine.on('rollStarted', ({ simulation }) => simulations.push(simulation));
    await h.play(h.engine.roll({ dice: [{ type: 'd6', count: 4 }] }));
    await h.play(h.engine.roll({ dice: [{ type: 'd12', count: 2 }] }));
    const stats = h.engine.getStats();
    expect(stats.simulation.last).toEqual(simulations[1]);
    expect(stats.simulation.totalAttempts).toBe(
      simulations[0]!.attempts + simulations[1]!.attempts,
    );
    expect(stats.simulation.totalCpuTimeMs).toBeCloseTo(
      simulations[0]!.cpuTimeMs + simulations[1]!.cpuTimeMs,
      9,
    );
    expect(stats.rolls).toEqual({
      requested: 2,
      completed: 2,
      cancelled: 0,
      failed: 0,
      recovered: 0,
      queuePeak: 1,
    });
    expect(stats.audio.state).toBe('off');
    expect(stats.effects.level).toBe('off');
  });
});
