import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EffectTrigger } from '../../src/core/effect-trigger';
import type { RollCompleted, RollRequest } from '../../src/core/types';
import type { EffectLevelSetting } from '../../src/effects';
import type { ThemeConfig } from '../../src/customization';
import type { DiceEffects, EffectsOptions } from '../../src/effects';
import type { EngineSimulator } from '../../src/integration/engine';
import { createPhysicsSimulator } from '../../src/physics/simulator';
import { createHarness } from './helpers/engine-harness';

let physics: EngineSimulator;

beforeAll(async () => {
  physics = await createPhysicsSimulator();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Motor com efeitos e um registro, na ordem, de eventos e efeitos mostrados. */
function setup(effects: EffectsOptions = { level: 'full' }, seed = 11) {
  const harness = createHarness(physics, { seed, effects });
  const layer = harness.engine.effects as DiceEffects;
  const shown: { effect: string; dieIds: readonly string[]; at: number }[] = [];
  const spawn = layer.spawnOnDice.bind(layer);
  vi.spyOn(layer, 'spawnOnDice').mockImplementation((effect, dieIds, options, effectSeed) => {
    shown.push({ effect, dieIds, at: harness.now() });
    harness.events.push({ name: `effect:${effect}` as never, payload: dieIds });
    return spawn(effect, dieIds, options, effectSeed);
  });
  const order = () => harness.events.map(({ name }) => name as string);
  return { ...harness, layer, shown, order };
}

const critical = (type = 'd20', values = [20]): EffectTrigger[] => [
  { effect: 'critical', on: 'settled', when: { type, values } },
];

describe('disparo por evento', () => {
  it('`settled` dispara no quadro em que o dado para, logo depois de diceSettled', async () => {
    const { engine, play, shown, events, order } = setup();
    const settledAt: Record<string, number> = {};
    engine.on('diceSettled', ({ dieId }) => {
      settledAt[dieId] = shown.length;
    });
    const outcome = await play(
      engine.roll({ dice: [{ type: 'd20', values: [20], ids: ['a'] }], effects: critical() }),
    );
    expect(outcome.status).toBe('completed');
    expect(shown.map((s) => s.effect)).toEqual(['critical']);
    const names = order();
    const settled = names.indexOf('diceSettled');
    expect(names[settled + 1]).toBe('effect:critical');
    expect(names.indexOf('rollCompleted')).toBeGreaterThan(settled + 1);
    // Mesmo quadro: nenhum efeito tinha sido mostrado quando o dado parou.
    expect(settledAt.a).toBe(0);
    expect(events.filter((e) => e.name === 'diceCollided').length).toBeGreaterThan(0);
  });

  it('`start` junto com rollStarted e `completed` antes de rollCompleted', async () => {
    const { engine, play, order } = setup();
    await play(
      engine.roll({
        dice: [{ type: 'd6', count: 2 }],
        effects: [
          { effect: 'trail', on: 'start' },
          { effect: 'highlight', on: 'completed', when: { type: 'd6' } },
        ],
      }),
    );
    const names = order();
    expect(names.slice(0, 3)).toEqual(['rollStarted', 'effect:trail', 'effect:trail']);
    const completed = names.indexOf('rollCompleted');
    expect(names.slice(completed - 2, completed)).toEqual(['effect:highlight', 'effect:highlight']);
    expect(names.lastIndexOf('diceSettled')).toBeLessThan(completed - 2);
  });

  it('modo autônomo: o efeito aparece exatamente nos dados cujo valor atende à condição', async () => {
    const { engine, play, shown } = setup({ level: 'reduced' });
    let matched = 0;
    for (let i = 0; i < 12; i++) {
      shown.length = 0;
      const outcome = (await play(
        engine.roll({ dice: [{ type: 'd6', count: 3 }], effects: critical('d6', [5, 6]) }),
      )) as RollCompleted;
      // Cada efeito sai quando o seu dado para: a ordem é a de parada, não a do pedido.
      const expected = outcome.dice.filter((d) => d.value >= 5).map((d) => d.dieId);
      expect(shown.flatMap((s) => s.dieIds).sort()).toEqual(expected.sort());
      matched += expected.length;
    }
    // Com 36 dados, algum caiu em 5 ou 6: o teste não passou por vacuidade.
    expect(matched).toBeGreaterThan(0);
  });

  it('modo controlado e d100: o valor lógico dispara o efeito nas duas partes', async () => {
    const { engine, play, shown } = setup({ level: 'reduced' });
    await play(
      engine.roll({
        dice: [{ type: 'd100', values: [100, 37], ids: ['p', 'q'] }],
        effects: critical('d100', [100]),
      }),
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]!.dieIds).toEqual(['p:tens', 'p:units']);
  });

  it('efeitos do tema acompanham os dados: rastro no movimento, brilho no repouso', async () => {
    const { engine, play, order } = setup();
    const theme: ThemeConfig = {
      schemaVersion: 1,
      id: 'cometa',
      name: 'Cometa',
      material: 'plastic',
      colors: { primary: '#223344', secondary: '#112233', numbers: '#ffffff' },
      effects: ['trail', 'glow'],
    };
    engine.registerTheme(theme);
    await play(engine.roll({ dice: [{ type: 'd8', theme: 'cometa' }, { type: 'd8' }] }));
    const names = order();
    expect(names.filter((n) => n.startsWith('effect:'))).toEqual(['effect:trail', 'effect:glow']);
    expect(names.indexOf('effect:trail')).toBe(names.indexOf('rollStarted') + 1);
    expect(names.indexOf('effect:glow')).toBeGreaterThan(names.indexOf('diceSettled'));
  });

  it('efeito desconhecido no pedido ou no tema avisa e não falha a rolagem', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { engine, play } = setup();
    const outcome = await play(
      engine.roll({ dice: [{ type: 'd6' }], effects: [{ effect: 'laser' }] }),
    );
    expect(outcome.status).toBe('completed');
    expect(
      warn.mock.calls.some(([message]) => /Efeito "laser" desconhecido/.test(String(message))),
    ).toBe(true);
  });
});

describe('disparo por chamada', () => {
  it('trigger() depois da rolagem mantém o laço enquanto anima e o libera no fim', async () => {
    const { engine, renderer, play, runFrames } = setup();
    await play(engine.roll({ dice: [{ type: 'd6', count: 2 }] }));
    expect(renderer.loop).toBeUndefined();
    const handle = engine.effects.trigger('critical');
    expect(handle).not.toBeNull();
    expect(renderer.objects.size).toBe(1);
    expect(renderer.loop).toBeDefined();
    const frames = await runFrames(1000);
    expect(frames).toBeGreaterThan(100);
    expect(renderer.loop).toBeUndefined();
    const stats = engine.effects.getStats();
    expect(stats.active).toBe(0);
    expect(stats.disposed).toBe(stats.created);
  });

  it('efeito parado não liga o laço: é desenhado uma vez e removido por temporizador', async () => {
    const { engine, renderer, play, flushTimers, pendingTimers } = setup({ level: 'reduced' });
    await play(engine.roll({ dice: [{ type: 'd6' }] }));
    const renders = renderer.renders;
    engine.effects.trigger('highlight', { durationMs: 800 });
    expect(renderer.loop).toBeUndefined();
    expect(renderer.renders).toBe(renders + 1);
    expect(pendingTimers()).toBe(1);
    expect(flushTimers()).toBe(true);
    expect(engine.effects.getStats().active).toBe(0);
    expect(renderer.renders).toBe(renders + 2);
    expect(pendingTimers()).toBe(0);
  });

  it('dieIds aceita o dado pedido de um d100', async () => {
    const { engine, play } = setup({ level: 'reduced' });
    await play(
      engine.roll({
        dice: [
          { type: 'd100', ids: ['x'] },
          { type: 'd6', ids: ['y'] },
        ],
      }),
    );
    engine.effects.trigger('highlight', { dieIds: ['x'] });
    expect(engine.effects.getStats().objects).toBe(1 + 2);
  });
});

describe('nível off', () => {
  it('nenhum objeto de efeito é criado, nem o grupo', async () => {
    const { engine, renderer, play } = setup({ level: 'off' });
    engine.registerTheme({
      schemaVersion: 1,
      id: 'brilho',
      name: 'Brilho',
      material: 'glass',
      colors: { primary: '#ffffff', secondary: '#eeeeee', numbers: '#000000' },
      effects: ['aura', 'trail'],
    });
    for (let i = 0; i < 3; i++) {
      await play(
        engine.roll({
          dice: [{ type: 'd20', count: 3, theme: 'brilho' }],
          effects: [
            { effect: 'critical', on: 'start' },
            { effect: 'burst', on: 'settled' },
            { effect: 'glow', on: 'completed' },
          ],
        }),
      );
      for (const name of ['critical', 'trail', 'fire']) engine.effects.trigger(name);
    }
    const stats = engine.effects.getStats();
    expect(stats).toMatchObject({ level: 'off', created: 0, objects: 0, active: 0 });
    expect(renderer.objectsAdded).toBe(0);
    expect((engine.effects as DiceEffects).rootObject).toBeUndefined();
    expect(renderer.loop).toBeUndefined();
  });
});

describe('o efeito não muda o resultado', () => {
  it('mesmo pedido, com e sem efeitos: mesmos valores, faces e trajetórias', async () => {
    const request = (effects: boolean): RollRequest => ({
      seed: 77,
      dice: [{ type: 'd20', count: 4 }, { type: 'd100' }],
      ...(effects
        ? {
            effects: [
              { effect: 'critical', when: { values: [20] } },
              { effect: 'trail', on: 'start' },
              { effect: 'aura', on: 'completed' },
            ],
          }
        : {}),
    });
    const run = async (level: EffectLevelSetting, effects: boolean) => {
      const harness = setup({ level }, 5);
      const transforms: string[] = [];
      const outcome = (await harness.play(harness.engine.roll(request(effects)))) as RollCompleted;
      for (const die of harness.engine.getDiceOnTable()) {
        transforms.push(JSON.stringify([die.position, die.rotation]));
      }
      return { values: outcome.dice.map((d) => [d.value, d.faceId]), transforms, harness };
    };
    const plain = await run('off', false);
    for (const level of ['full', 'reduced'] as const) {
      const withEffects = await run(level, true);
      expect(withEffects.values).toEqual(plain.values);
      expect(withEffects.transforms).toEqual(plain.transforms);
    }
  });

  it('os dados não se mexem enquanto os efeitos animam depois da conclusão', async () => {
    const { engine, play, runFrames } = setup();
    await play(
      engine.roll({ dice: [{ type: 'd12', count: 3 }], effects: [{ effect: 'critical' }] }),
    );
    const before = JSON.stringify(engine.getDiceOnTable());
    expect(engine.effects.getStats().active).toBeGreaterThan(0);
    await runFrames(60);
    expect(JSON.stringify(engine.getDiceOnTable())).toBe(before);
  });
});

describe('descarte', () => {
  it.each(['full', 'reduced'] as const)(
    'nova rolagem, cancelar, limpar e destruir liberam os efeitos (%s)',
    async (level) => {
      const { engine, renderer, play, runFrames, tick } = setup({ level });
      const balanced = () => {
        const stats = engine.effects.getStats();
        return stats.created === stats.disposed && stats.active === 0;
      };
      const effects: EffectTrigger[] = [
        { effect: 'aura', on: 'start' },
        { effect: 'critical', on: 'settled' },
      ];

      // Nova rolagem no meio da animação: os efeitos dos dados antigos saem.
      const first = engine.roll({ dice: [{ type: 'd6', count: 3 }], effects });
      await tick();
      await runFrames(20);
      expect(engine.effects.getStats().created).toBeGreaterThan(0);
      await play(engine.roll({ dice: [{ type: 'd6' }], effects }));
      expect((await first.result).status).toBe('cancelled');

      // Cancelar no meio.
      const second = engine.roll({ dice: [{ type: 'd8', count: 2 }], effects });
      await tick();
      await runFrames(10);
      second.cancel();
      // Efeito num ponto da mesa sobrevive ao cancelamento, mas não ao clear.
      engine.effects.trigger('fire', { position: { x: 0, y: 0, z: 0 } });
      engine.clear();
      expect(balanced()).toBe(true);
      expect(renderer.loop).toBeUndefined();

      // 20 rolagens completas com efeitos, deixando cada uma terminar.
      for (let i = 0; i < 20; i++) {
        await play(engine.roll({ dice: [{ type: 'd20', count: 2 }], effects }));
      }
      await runFrames(2000);
      for (let i = 0; i < 10 && engine.effects.getStats().active > 0; i++) engine.effects.stopAll();
      expect(balanced()).toBe(true);

      engine.effects.trigger('critical');
      engine.destroy();
      expect(balanced()).toBe(true);
      expect(renderer.objects.size).toBe(0);
      expect(renderer.disposed).toBe(true);
    },
  );
});
