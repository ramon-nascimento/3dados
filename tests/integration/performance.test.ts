import { beforeAll, describe, expect, it, vi } from 'vitest';
import { D6 } from '../../src/core/dice/d6';
import { D20 } from '../../src/core/dice/platonic';
import type { DieDefinition } from '../../src/core/die-definition';
import { isDiceError } from '../../src/core/errors';
import type { DiceEffects } from '../../src/effects';
import type { EngineSimulator } from '../../src/integration/engine';
import { DEFAULT_PHYSICS_CONFIG } from '../../src/physics/config';
import { loadRapier, type RapierModule } from '../../src/physics/rapier';
import {
  PhysicsSimulator,
  SLICE_BUDGET_MS,
  createPhysicsSimulator,
  type SimulationRequest,
} from '../../src/physics/simulator';
import { createHarness } from './helpers/engine-harness';

const WIDE = { width: 26, depth: 15 };

function dice(definition: DieDefinition, count: number) {
  return Array.from({ length: count }, (_, i) => ({ dieId: `die-${i}`, definition }));
}

/** Conta quantas vezes o laço de eventos rodou enquanto `work` estava em curso. */
async function countTurns<T>(work: () => Promise<T>): Promise<{ result: T; turns: number }> {
  let turns = 0;
  let running = true;
  const spin = () => {
    if (!running) return;
    turns++;
    setImmediate(spin);
  };
  setImmediate(spin);
  try {
    return { result: await work(), turns };
  } finally {
    running = false;
  }
}

let rapier: RapierModule;
let physics: PhysicsSimulator;

beforeAll(async () => {
  rapier = await loadRapier();
  // O orçamento real: os demais testes de integração rodam sem pausas (setup.ts).
  physics = new PhysicsSimulator(rapier, {}, { sliceBudgetMs: SLICE_BUDGET_MS });
});

describe('pré-simulação fatiada', () => {
  // 30 d20: várias tentativas e empurrões, dezenas de milissegundos.
  const heavy: SimulationRequest = { dice: dice(D20, 30), area: WIDE, seed: 4242 };

  it('uma simulação longa devolve o controle ao hospedeiro várias vezes', async () => {
    const { result, turns } = await countTurns(() => physics.simulate(heavy));
    expect(result.cpuTimeMs).toBeGreaterThan(SLICE_BUDGET_MS * 2);
    expect(turns).toBeGreaterThanOrEqual(2);
    // O maior trecho sem pausa é uma fração do trabalho total.
    expect(result.longestTaskMs).toBeGreaterThan(0);
    expect(result.longestTaskMs).toBeLessThan(result.cpuTimeMs);
  });

  it('sem estourar o orçamento de tempo, não há pausa nenhuma', async () => {
    // Relógio parado: nenhum trecho chega ao orçamento, por mais lenta que a máquina esteja.
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      const { result, turns } = await countTurns(() => physics.simulate(heavy));
      expect(turns).toBe(0);
      expect(result.longestTaskMs).toBe(result.cpuTimeMs);
    } finally {
      clock.mockRestore();
    }
  });

  it('as pausas não mudam a física: mesma semente, mesma gravação', async () => {
    const alone = await physics.simulate(heavy);
    // Duas simulações intercaladas pelas pausas, cada uma com o seu mundo.
    const [again, other] = await Promise.all([
      physics.simulate(heavy),
      physics.simulate({ ...heavy, seed: 99 }),
    ]);
    expect(again.attempts).toBe(alone.attempts);
    expect(again.landedFaces.map((face) => face.id)).toEqual(
      alone.landedFaces.map((face) => face.id),
    );
    expect(again.recording).toEqual(alone.recording);
    expect(other.recording).not.toEqual(alone.recording);
  });

  it('uma simulação abandonada para na pausa seguinte', async () => {
    let asked = 0;
    const error: unknown = await physics
      .simulate({ ...heavy, aborted: () => ++asked >= 2 })
      .catch((e: unknown) => e);
    expect(isDiceError(error) && error.code).toBe('SIMULATION_FAILED');
    expect(isDiceError(error) && error.details).toEqual({ aborted: true });
    expect(asked).toBe(2);
  });

  it('libera todo mundo de física que cria, inclusive em falhas e abandonos', async () => {
    let created = 0;
    let freed = 0;
    const counting = <T extends new (...args: never[]) => { free(): void }>(Original: T): T =>
      new Proxy(Original, {
        construct(target, args) {
          const instance = Reflect.construct(target, args) as { free(): void };
          created++;
          const free = instance.free.bind(instance);
          instance.free = () => {
            freed++;
            free();
          };
          return instance;
        },
      });
    // O módulo do Rapier com `World` e `EventQueue` contados; o resto vem do original.
    const tracked = Object.create(rapier, {
      World: { value: counting(rapier.World) },
      EventQueue: { value: counting(rapier.EventQueue) },
    }) as RapierModule;
    const simulator = new PhysicsSimulator(tracked, {}, { sliceBudgetMs: SLICE_BUDGET_MS });
    let failures = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const count = 1 + (seed % 6);
      await simulator.simulate({ dice: dice(seed % 2 ? D6 : D20, count), area: WIDE, seed });
    }
    // Falha por tempo e abandono no meio: o mundo da tentativa também é liberado.
    const impossible = new PhysicsSimulator(tracked, { maxDuration: 0.05, maxAttempts: 3 });
    await impossible.simulate({ dice: dice(D6, 2), area: WIDE, seed: 5 }).catch(() => failures++);
    await simulator.simulate({ ...heavy, aborted: () => true }).catch(() => failures++);
    expect(failures).toBe(2);
    // Um mundo e uma fila de eventos por tentativa.
    expect(created).toBeGreaterThanOrEqual(2 * 204);
    expect(freed).toBe(created);
  });
});

describe('ajuste da física', () => {
  const request: SimulationRequest = { dice: dice(D6, 4), area: WIDE, seed: 31 };
  const seconds = (result: { recording: { stepCount: number; timestep: number } }) =>
    result.recording.stepCount * result.recording.timestep;

  it('configure vale para as simulações seguintes e devolve os parâmetros em vigor', async () => {
    const simulator = new PhysicsSimulator(rapier);
    const before = await simulator.simulate(request);
    expect(simulator.configure({ gravity: 40 })).toEqual({
      ...DEFAULT_PHYSICS_CONFIG,
      gravity: 40,
    });
    const slow = await simulator.simulate(request);
    // Com menos gravidade os dados demoram mais a parar.
    expect(seconds(slow)).toBeGreaterThan(seconds(before) * 1.3);
    simulator.configure({ gravity: DEFAULT_PHYSICS_CONFIG.gravity });
    expect((await simulator.simulate(request)).recording).toEqual(before.recording);
  });

  it('uma simulação em curso termina com os parâmetros com que começou', async () => {
    const heavy: SimulationRequest = { dice: dice(D20, 30), area: WIDE, seed: 77 };
    const simulator = new PhysicsSimulator(rapier, {}, { sliceBudgetMs: SLICE_BUDGET_MS });
    const reference = await simulator.simulate(heavy);
    const running = simulator.simulate(heavy);
    simulator.configure({ gravity: 30, friction: 1.5 });
    expect((await running).recording).toEqual(reference.recording);
  });

  it('recusa valores fora da faixa sem mudar nada', () => {
    const simulator = new PhysicsSimulator(rapier);
    expect(() => simulator.configure({ gravity: 0 })).toThrow(/physics\.gravity/);
    expect(simulator.getConfig()).toEqual(DEFAULT_PHYSICS_CONFIG);
    expect(() => new PhysicsSimulator(rapier, { timestep: 1 })).toThrow(/physics\.timestep/);
  });

  it('engine.setPhysics muda a rolagem seguinte, nunca o valor', async () => {
    const simulator = await createPhysicsSimulator();
    const { engine, play } = createHarness(simulator, { seed: 5 });
    expect(engine.getPhysics()).toEqual(DEFAULT_PHYSICS_CONFIG);
    const roll = () => play(engine.roll({ dice: [{ type: 'd20', values: [17, 3, 20] }] }));

    const normal = await roll();
    expect(engine.setPhysics({ gravity: 30 })).toMatchObject({ gravity: 30, friction: 0.3 });
    expect(engine.getPhysics().gravity).toBe(30);
    const floaty = await roll();

    for (const outcome of [normal, floaty]) {
      expect(outcome).toMatchObject({ status: 'completed', total: 40 });
    }
    if (normal.status !== 'completed' || floaty.status !== 'completed') throw new Error('falhou');
    expect(floaty.durationMs).toBeGreaterThan(normal.durationMs * 1.3);
    // A cópia devolvida não é o estado do motor.
    engine.getPhysics().gravity = 999;
    expect(engine.getPhysics().gravity).toBe(30);
  });

  it('engine.setPhysics recusa valor inválido e motor destruído', async () => {
    const { engine } = createHarness(await createPhysicsSimulator());
    const failure = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        if (isDiceError(error)) return { code: error.code, ...error.details };
      }
      return undefined;
    };
    expect(failure(() => engine.setPhysics({ restitution: 2 }))).toMatchObject({
      code: 'INVALID_ARGUMENT',
      path: 'physics.restitution',
    });
    expect(failure(() => engine.setPhysics({ peso: 1 } as never))).toMatchObject({
      code: 'INVALID_ARGUMENT',
      path: 'physics.peso',
    });
    expect(engine.getPhysics()).toEqual(DEFAULT_PHYSICS_CONFIG);
    engine.destroy();
    expect(failure(() => engine.setPhysics({ gravity: 10 }))).toEqual({ code: 'ENGINE_DESTROYED' });
  });
});

describe('medições e avisos do renderer no motor', () => {
  let simulator: EngineSimulator;
  beforeAll(async () => {
    simulator = await createPhysicsSimulator();
  });

  it('rollStarted e getStats trazem o maior trecho da pré-simulação', async () => {
    const { engine, play, events } = createHarness(simulator);
    await play(engine.roll({ dice: [{ type: 'd6', count: 3 }] }));
    const started = events.find(({ name }) => name === 'rollStarted')!.payload as {
      simulation: { attempts: number; cpuTimeMs: number; longestTaskMs: number };
    };
    expect(started.simulation.longestTaskMs).toBeGreaterThan(0);
    expect(started.simulation.longestTaskMs).toBeLessThanOrEqual(started.simulation.cpuTimeMs);
    const stats = engine.getStats();
    expect(stats.simulation.last).toEqual(started.simulation);
    expect(stats.simulation.longestTaskMs).toBe(started.simulation.longestTaskMs);
    expect(stats.render).toMatchObject({ context: 'active', quality: 'high', frames: 0 });
    // Serializável, como o resto das estatísticas.
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });

  it('cancelar durante a pré-simulação avisa o simulador para parar', async () => {
    let request: SimulationRequest | undefined;
    const spy: EngineSimulator = {
      simulate(received) {
        request = received;
        return simulator.simulate(received);
      },
    };
    const { engine, tick } = createHarness(spy);
    const handle = engine.roll({ dice: [{ type: 'd6', count: 2 }] });
    expect(request?.aborted?.()).toBe(false);
    handle.cancel();
    expect(request?.aborted?.()).toBe(true);
    expect(await handle.result).toMatchObject({ status: 'cancelled', reason: 'caller' });
    await tick();
    expect(engine.getState().diceOnTable).toBe(0);
  });

  it('sem contexto gráfico a rolagem conclui e os efeitos em andamento param', async () => {
    const { engine, renderer, play, tick, events } = createHarness(simulator, {
      effects: { level: 'full' },
    });
    const seen: unknown[] = [];
    engine.on('contextLost', (payload) => seen.push(['lost', payload]));
    engine.on('contextRestored', (payload) => seen.push(['restored', payload]));

    const handle = engine.roll({
      id: 'r1',
      dice: [{ type: 'd20', values: [20] }],
      effects: [{ effect: 'trail', on: 'start' }],
    });
    for (let i = 0; i < 50 && engine.getState().activeRoll?.phase !== 'animating'; i++)
      await tick();
    expect(engine.effects.getStats().active).toBe(1);

    renderer.emit({ type: 'contextLost' });
    expect(seen).toEqual([['lost', { activeRollId: 'r1' }]]);
    expect(engine.getState().context).toBe('lost');
    expect(engine.getStats().render.context).toBe('lost');
    // Os efeitos viviam na GPU perdida.
    const stats = engine.effects.getStats();
    expect(stats.active).toBe(0);
    expect(stats.created).toBe(stats.disposed);

    // O valor já estava decidido: a rolagem segue e conclui com a leitura da cena.
    const outcome = await play(handle);
    expect(outcome).toMatchObject({ status: 'completed', total: 20 });
    expect(renderer.displayed()).toEqual({ 'r1:0': 20 });
    expect(events.map(({ name }) => name)).toContain('rollCompleted');

    renderer.emit({ type: 'contextRestored', lostForMs: 1234 });
    expect(seen[1]).toEqual(['restored', { lostForMs: 1234 }]);
    expect(engine.getState().context).toBe('active');
    // Os dados continuam na mesa, e uma rolagem nova funciona.
    expect(engine.getState().diceOnTable).toBe(1);
    expect(await play(engine.roll({ dice: [{ type: 'd6', values: [4] }] }))).toMatchObject({
      status: 'completed',
      total: 4,
    });
  });

  it('perda de contexto com a mesa parada e sem rolagem', () => {
    const { engine, renderer } = createHarness(simulator);
    const lost: unknown[] = [];
    engine.on('contextLost', (payload) => lost.push(payload));
    renderer.emit({ type: 'contextLost' });
    expect(lost).toEqual([{ activeRollId: null }]);
    engine.destroy();
    // Depois de destruído, avisos do renderer não chegam a ninguém.
    renderer.emit({ type: 'contextRestored', lostForMs: 1 });
    expect(engine.getState().status).toBe('destroyed');
  });

  it('a qualidade do render define o teto de partículas dos efeitos', () => {
    const { engine, renderer } = createHarness(simulator, { effects: { level: 'full' } });
    const layer = engine.effects as DiceEffects;
    const changes: unknown[] = [];
    engine.on('qualityChanged', (payload) => changes.push(payload));
    expect(layer.particleLimit).toBe(2000);

    const frameMs = { p50: 30, p95: 70, max: 90 };
    const fps = 18;
    renderer.emit({ type: 'qualityChanged', from: 'high', to: 'medium', fps, frameMs });
    expect(layer.particleLimit).toBe(1200);
    expect(engine.quality).toBe('medium');
    expect(engine.getState().quality).toBe('medium');
    renderer.emit({ type: 'qualityChanged', from: 'medium', to: 'low', fps, frameMs });
    expect(layer.particleLimit).toBe(600);
    expect(engine.effects.getStats().particleLimit).toBe(600);
    expect(changes).toEqual([
      { from: 'high', to: 'medium', fps, frameMs },
      { from: 'medium', to: 'low', fps, frameMs },
    ]);
    // O evento leva uma cópia das medições.
    expect((changes[0] as { frameMs: object }).frameMs).not.toBe(frameMs);
  });

  it('um motor criado em qualidade baixa já começa com o teto reduzido', () => {
    const harness = createHarness(simulator, { effects: { level: 'full', maxParticles: 1000 } });
    expect((harness.engine.effects as DiceEffects).particleLimit).toBe(1000);
    harness.renderer.emit({
      type: 'qualityChanged',
      from: 'high',
      to: 'low',
      fps: 10,
      frameMs: { p50: 1, p95: 1, max: 1 },
    });
    expect((harness.engine.effects as DiceEffects).particleLimit).toBe(300);
  });
});

describe('uso prolongado sem acúmulo', () => {
  it('200 rolagens seguidas deixam o motor como depois da primeira', async () => {
    const simulator = await createPhysicsSimulator();
    const { engine, renderer, play, pendingTimers } = createHarness(simulator, {
      seed: 3,
      effects: { level: 'full' },
    });
    const types = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
    const roll = async (i: number) => {
      const outcome = await play(
        engine.roll({
          dice: [{ type: types[i % types.length]!, count: 1 + (i % 4) }],
          effects: [
            { effect: 'trail', on: 'start' },
            { effect: 'burst', on: 'completed' },
          ],
        }),
      );
      expect(outcome.status).toBe('completed');
    };
    await roll(0);
    for (let i = 1; i <= 200; i++) await roll(i);

    engine.clear();
    const stats = engine.getStats();
    expect(stats.rolls).toMatchObject({ requested: 201, completed: 201, failed: 0, cancelled: 0 });
    expect(renderer.dice.size).toBe(0);
    expect(renderer.objects.size).toBeLessThanOrEqual(1);
    expect(stats.effects.active).toBe(0);
    expect(stats.effects.particles).toBe(0);
    expect(stats.effects.created).toBe(stats.effects.disposed);
    expect(engine.getState()).toMatchObject({ status: 'idle', queue: [], diceOnTable: 0 });
    expect(pendingTimers()).toBe(0);
  });
});
