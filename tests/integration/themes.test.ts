import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DiceError } from '../../src/core/errors';
import type { DieSpec, RollCompleted, RollOutcome } from '../../src/core/types';
import {
  DEFAULT_THEME,
  MATERIAL_PRESETS,
  MATERIALS,
  type MaterialKind,
  type ThemeConfig,
} from '../../src/customization';
import type { EngineSimulator } from '../../src/integration/engine';
import {
  createPhysicsSimulator,
  type SimulationRequest,
  type SimulationResult,
} from '../../src/physics/simulator';
import { createHarness } from './helpers/engine-harness';

function themeOf(material: MaterialKind, id: string = material): ThemeConfig {
  return {
    schemaVersion: 1,
    id,
    name: material,
    material,
    colors: { primary: '#3a5f8a', secondary: '#c0a060', numbers: '#ffffff' },
  };
}

/** O que importa de um desfecho para comparar rolagens: valores e faces, sem tempos. */
function summary(outcome: RollOutcome) {
  expect(outcome.status).toBe('completed');
  const { dice, total } = outcome as RollCompleted;
  return {
    total,
    dice: dice.map(({ dieId, type, value, faceId, source, components }) => ({
      dieId,
      type,
      value,
      faceId,
      source,
      components,
    })),
  };
}

/** Simulador real que guarda os pedidos recebidos e as gravações produzidas. */
function recording(simulator: EngineSimulator) {
  const requests: SimulationRequest[] = [];
  const results: SimulationResult[] = [];
  const wrapped: EngineSimulator = {
    simulate: async (request) => {
      requests.push(request);
      const result = await simulator.simulate(request);
      results.push(result);
      return result;
    },
  };
  return { requests, results, simulator: wrapped };
}

const DICE: DieSpec[] = [
  { type: 'd4', count: 2 },
  { type: 'd6', count: 2 },
  { type: 'd8' },
  { type: 'd10' },
  { type: 'd12', count: 2 },
  { type: 'd20', count: 2 },
  { type: 'd100' },
];

describe('temas e resultados', () => {
  let physics: EngineSimulator;

  beforeAll(async () => {
    physics = await createPhysicsSimulator();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Rola o mesmo pedido com cada tema, cada um em um motor novo com o mesmo RNG. */
  async function rollWithEachTheme(dice: DieSpec[], seed: number) {
    const outcomes = new Map<string, ReturnType<typeof summary>>();
    const trajectories = new Map<string, string>();
    for (const material of ['none', ...MATERIALS] as const) {
      const { results, simulator } = recording(physics);
      const { engine, renderer, play } = createHarness(simulator, { seed: 4242 });
      if (material !== 'none') engine.registerTheme(themeOf(material));
      const themed = dice.map((spec) =>
        material === 'none' ? spec : { ...spec, theme: material },
      );
      const outcome = await play(engine.roll({ dice: themed, seed }));
      outcomes.set(material, summary(outcome));
      // O que a tela exibe, lido das malhas, também precisa ser igual.
      expect(Object.values(renderer.displayed()).length).toBeGreaterThan(0);
      // Trajetória gravada: onde cada dado parou, em que passo.
      trajectories.set(
        material,
        results[0]!.recording.dice
          .map((die) => {
            const last = die.settledStep;
            return [die.positions[last * 3], die.positions[last * 3 + 2], last].join(',');
          })
          .join(';'),
      );
    }
    return { outcomes, trajectories };
  }

  it('modo controlado: os seis materiais exibem exatamente os mesmos valores', async () => {
    const values: DieSpec[] = [
      { type: 'd4', values: [1, 4] },
      { type: 'd6', values: [6, 2] },
      { type: 'd8', values: [7] },
      { type: 'd10', values: [10] },
      { type: 'd12', values: [12, 1] },
      { type: 'd20', values: [20, 13] },
      { type: 'd100', values: [100] },
    ];
    const { outcomes } = await rollWithEachTheme(values, 77);
    const reference = outcomes.get('none')!;
    expect(reference.dice.map((die) => die.value)).toEqual([1, 4, 6, 2, 7, 10, 12, 1, 20, 13, 100]);
    for (const [material, outcome] of outcomes) {
      expect(outcome, material).toEqual(reference);
    }
  });

  it('modo autônomo: o tema não consome o RNG nem muda o sorteio', async () => {
    const { outcomes } = await rollWithEachTheme(DICE, 91);
    const reference = outcomes.get('none')!;
    expect(reference.dice.every((die) => die.source === 'rng')).toBe(true);
    for (const [material, outcome] of outcomes) {
      expect(outcome, material).toEqual(reference);
    }
  });

  it('o material muda a física (a trajetória), não o resultado', async () => {
    const { outcomes, trajectories } = await rollWithEachTheme([{ type: 'd20', count: 3 }], 5);
    expect(new Set(trajectories.values()).size).toBe(MATERIALS.length);
    expect(new Set([...outcomes.values()].map((o) => JSON.stringify(o))).size).toBe(1);
  });

  it('o simulador recebe a resposta física do material de cada dado', async () => {
    const { requests, simulator } = recording(physics);
    const { engine, play } = createHarness(simulator);
    engine.registerTheme(themeOf('metal', 'hope'));
    engine.registerTheme(themeOf('wood', 'fear'));
    await play(
      engine.roll({
        dice: [
          { type: 'd12', theme: 'hope', role: 'hope' },
          { type: 'd12', theme: 'fear', role: 'fear' },
          { type: 'd6' },
        ],
      }),
    );
    expect(requests[0]!.dice.map((die) => die.material)).toEqual([
      MATERIAL_PRESETS.metal.physics,
      MATERIAL_PRESETS.wood.physics,
      MATERIAL_PRESETS.plastic.physics,
    ]);
  });

  it('dois d12 com temas diferentes recebem aparências diferentes', async () => {
    const { engine, renderer, play } = createHarness(physics);
    const hope = {
      ...themeOf('metal', 'hope'),
      colors: { ...themeOf('metal').colors, primary: '#e8c25a' },
    };
    const fear = {
      ...themeOf('crystal', 'fear'),
      colors: { ...themeOf('crystal').colors, primary: '#3b1f5c' },
    };
    engine.registerTheme(hope);
    engine.registerTheme(fear);
    const outcome = await play(
      engine.roll({
        dice: [
          { type: 'd12', theme: 'hope', role: 'hope', ids: ['h'] },
          { type: 'd12', theme: 'fear', role: 'fear', ids: ['f'] },
        ],
      }),
    );
    expect(outcome.status).toBe('completed');
    const h = renderer.dice.get('h')!.appearance;
    const f = renderer.dice.get('f')!.appearance;
    expect(h.material).toBe('metal');
    expect(h.colors.primary).toBe('#e8c25a');
    expect(f.material).toBe('crystal');
    expect(f.colors.primary).toBe('#3b1f5c');
    // As fontes das duas aparências são preparadas antes de os dados aparecerem.
    expect(renderer.prepared[0]).toEqual([h, f]);
  });

  it('as duas partes do d100 usam o tema do dado', async () => {
    const { engine, renderer, play } = createHarness(physics);
    engine.registerTheme(themeOf('stone'));
    await play(engine.roll({ dice: [{ type: 'd100', theme: 'stone', ids: ['p'] }] }));
    expect(renderer.dice.get('p:tens')!.appearance.material).toBe('stone');
    expect(renderer.dice.get('p:units')!.appearance.material).toBe('stone');
  });

  it('tema não registrado: usa o padrão, avisa uma vez e a rolagem conclui', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { engine, renderer, play } = createHarness(physics);
    for (let i = 0; i < 2; i++) {
      const outcome = await play(
        engine.roll({ dice: [{ type: 'd6', values: [3], theme: 'inexistente', ids: ['x'] }] }),
      );
      expect(summary(outcome).dice[0]!.value).toBe(3);
      expect(renderer.dice.get('x')!.appearance.colors).toEqual(DEFAULT_THEME.colors);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/Tema "inexistente" não registrado/);
  });

  it('tema padrão: aparência marfim e física de plástico', async () => {
    const { requests, simulator } = recording(physics);
    const { engine, renderer, play } = createHarness(simulator);
    await play(engine.roll({ dice: [{ type: 'd6', ids: ['a'] }] }));
    expect(renderer.dice.get('a')!.appearance.colors).toEqual(DEFAULT_THEME.colors);
    expect(requests[0]!.dice[0]!.material).toEqual(MATERIAL_PRESETS.plastic.physics);
  });

  it('setDefaultTheme muda o padrão e recusa tema não registrado', async () => {
    const { engine, renderer, play } = createHarness(physics);
    expect(() => engine.setDefaultTheme('nada')).toThrow(/Tema não registrado: "nada"/);
    engine.registerTheme(themeOf('glass'));
    engine.setDefaultTheme('glass');
    await play(engine.roll({ dice: [{ type: 'd8', ids: ['g'] }] }));
    expect(renderer.dice.get('g')!.appearance.material).toBe('glass');
  });

  it('registerTheme recusa tema inválido com INVALID_THEME', () => {
    const { engine } = createHarness(physics);
    try {
      engine.registerTheme({ ...themeOf('metal'), opacity: 3 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DiceError);
      expect((error as DiceError).code).toBe('INVALID_THEME');
    }
    // O tema inválido não foi registrado.
    expect(engine.getTheme('metal')).toBeUndefined();
  });

  it('getTheme devolve uma cópia', () => {
    const { engine } = createHarness(physics);
    engine.registerTheme(themeOf('wood'));
    const copy = engine.getTheme('wood')!;
    copy.colors.primary = '#000000';
    expect(engine.getTheme('wood')!.colors.primary).toBe('#3a5f8a');
    expect(engine.getTheme('default')).toEqual(DEFAULT_THEME);
  });

  it('trocar o tema com dados na mesa só redesenha: nada se move nem muda de valor', async () => {
    const { engine, renderer, play, tick } = createHarness(physics);
    engine.registerTheme(themeOf('plastic', 'mesa'));
    const outcome = await play(
      engine.roll({ dice: [{ type: 'd20', values: [17], theme: 'mesa', ids: ['m'] }] }),
    );
    const before = renderer.dice.get('m')!;
    const displayed = renderer.displayed();

    engine.registerTheme({
      ...themeOf('crystal', 'mesa'),
      colors: { ...before.appearance.colors },
    });
    await tick();
    const after = renderer.dice.get('m')!;
    expect(after.appearance.material).toBe('crystal');
    expect(after.position).toEqual(before.position);
    expect(after.rotation).toEqual(before.rotation);
    expect(renderer.displayed()).toEqual(displayed);
    expect(summary(outcome).dice[0]!.value).toBe(17);
  });
});
