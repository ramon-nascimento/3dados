import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DiceAudio, planRollSounds, type AudioOptions, type SoundProfile } from '../../src/audio';
import { D6 } from '../../src/core/dice/d6';
import { D8, D12, D20 } from '../../src/core/dice/platonic';
import type { RollCompleted, RollOutcome } from '../../src/core/types';
import type { ThemeConfig } from '../../src/customization';
import type { EngineSimulator } from '../../src/integration/engine';
import {
  createPhysicsSimulator,
  type SimulationRequest,
  type SimulationResult,
} from '../../src/physics/simulator';
import { createFakeEnvironment, flush, type FakeAudioContext } from '../unit/helpers/fake-audio';
import { createHarness } from './helpers/engine-harness';

let physics: EngineSimulator;
beforeAll(async () => {
  physics = await createPhysicsSimulator();
});

/** Simulador real que guarda as gravações. */
function recorded(simulator: EngineSimulator) {
  const results: SimulationResult[] = [];
  const requests: SimulationRequest[] = [];
  return {
    results,
    requests,
    simulator: {
      simulate: async (request: SimulationRequest) => {
        requests.push(request);
        const result = await simulator.simulate(request);
        results.push(result);
        return result;
      },
    } satisfies EngineSimulator,
  };
}

async function runningAudio(options: AudioOptions = {}) {
  const env = createFakeEnvironment();
  const audio = new DiceAudio(options, env, { surface: 'wood' });
  await audio.unlock();
  await audio.ready();
  return { audio, env, context: env.contexts[0] as FakeAudioContext };
}

function summary(outcome: RollOutcome) {
  expect(outcome.status).toBe('completed');
  return (outcome as RollCompleted).dice.map(({ dieId, value, faceId }) => ({
    dieId,
    value,
    faceId,
  }));
}

/** Simula 20 dados na área de referência e devolve a gravação. */
async function twentyDice(seed: number) {
  const types = [D6, D20, D8, D12];
  const dice = Array.from({ length: 20 }, (_, i) => ({
    dieId: `die-${i}`,
    definition: types[i % types.length]!,
  }));
  const result = await physics.simulate({ dice, area: { width: 26, depth: 15 }, seed });
  return { dice, recording: result.recording };
}

describe('limite de vozes com 20 dados (física real)', () => {
  it.each([16, 8, 4])('com %i vozes, nunca passa do limite em 10 rolagens', async (maxVoices) => {
    let exercised = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { dice, recording } = await twentyDice(seed);
      const profiles: SoundProfile[] = ['plastic', 'metal', 'glass', 'wood', 'stone'];
      const events = planRollSounds({
        recording,
        dice: dice.map((die, i) => ({ ...die, profile: profiles[i % profiles.length]! })),
        surface: 'wood',
        seed,
      });
      const { audio, context } = await runningAudio({ maxVoices });
      audio.scheduleRoll(events);
      expect(context.maxConcurrent()).toBeLessThanOrEqual(maxVoices);
      const stats = audio.getStats();
      if (stats.dropped + stats.stolen > 0) exercised++;
      expect(stats.scheduled).toBeGreaterThan(0);
    }
    // O teste só prova algo se o limite foi de fato atingido. Com 4 e 8 vozes
    // isso acontece sempre; com 16, os números ficam registrados no relatório.
    if (maxVoices <= 8) expect(exercised).toBe(10);
  });

  it('as rolagens têm sons de lançamento, impacto, tombo e estabilização', async () => {
    const { dice, recording } = await twentyDice(3);
    const events = planRollSounds({
      recording,
      dice: dice.map((die) => ({ ...die, profile: 'plastic' as const })),
      surface: 'wood',
      seed: 3,
    });
    const kinds = new Set(events.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['impact', 'launch', 'roll', 'settle']);
    // Quanto som por rolagem: registrado para o relatório da etapa.
    const count = (kind: string) => events.filter((e) => e.kind === kind).length;
    console.info(
      `[áudio] 20 dados: ${events.length} sons (${count('impact')} impactos, ${count('roll')} tombos, ${count('settle')} estabilizações), ${recording.collisions.length} colisões gravadas`,
    );
  });
});

describe('áudio no motor', () => {
  it('ligar o áudio não muda valores, faces nem trajetórias', async () => {
    const request = {
      dice: [{ type: 'd20', count: 3 }, { type: 'd6', count: 4 }, { type: 'd100' }],
    };
    const silent = recorded(physics);
    const withAudio = recorded(physics);
    const { audio, context } = await runningAudio();

    const a = createHarness(silent.simulator, { seed: 21 });
    const b = createHarness(withAudio.simulator, { seed: 21, audio });
    const outcomeA = await a.play(a.engine.roll(request));
    const outcomeB = await b.play(b.engine.roll(request));

    expect(summary(outcomeB)).toEqual(summary(outcomeA));
    expect(withAudio.requests[0]!.seed).toBe(silent.requests[0]!.seed);
    expect(withAudio.results[0]!.recording.dice.map((d) => [...d.positions])).toEqual(
      silent.results[0]!.recording.dice.map((d) => [...d.positions]),
    );
    // E o som tocou de fato.
    expect(audio.getStats().scheduled).toBeGreaterThan(0);
    expect(context.audible().length).toBeGreaterThan(0);
  });

  it('com o áudio desligado, o motor não cria AudioContext', async () => {
    const env = createFakeEnvironment();
    const audio = new DiceAudio({ enabled: false }, env, { surface: 'wood' });
    const { engine, play } = createHarness(physics, { audio });
    env.userActivation = true;
    await play(engine.roll({ dice: [{ type: 'd6', count: 20 }] }));
    await engine.audio.unlock();
    engine.audio.setVolume(0.5);
    engine.destroy();
    await flush();
    expect(env.contexts).toHaveLength(0);
  });

  it('o motor sem áudio informado começa desligado', () => {
    const { engine } = createHarness(physics);
    expect(engine.audio.enabled).toBe(false);
    expect(engine.audio.state).toBe('off');
  });

  it('cancelar e limpar interrompem os sons agendados', async () => {
    const { audio, context } = await runningAudio();
    const { engine, tick } = createHarness(physics, { audio });
    const handle = engine.roll({ dice: [{ type: 'd6', count: 6 }] });
    for (let i = 0; i < 10 && audio.getStats().scheduled === 0; i++) await tick();
    expect(audio.getStats().scheduled).toBeGreaterThan(0);
    handle.cancel();
    expect(context.audible()).toHaveLength(0);
  });

  it('o perfil vem do tema, ou do material; perfil desconhecido avisa uma vez', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { audio } = await runningAudio();
    const schedule = vi.spyOn(audio, 'scheduleRoll');
    const { engine, play } = createHarness(physics, { audio });
    const theme = (id: string, extra: Partial<ThemeConfig>): ThemeConfig => ({
      schemaVersion: 1,
      id,
      name: id,
      material: 'metal',
      colors: { primary: '#888888', secondary: '#444444', numbers: '#ffffff' },
      ...extra,
    });
    engine.registerTheme(theme('metal', {}));
    engine.registerTheme(theme('vidro-no-metal', { soundProfile: 'glass' }));
    engine.registerTheme(theme('estranho', { soundProfile: 'borracha' }));

    const groupsOf = async (themeId: string) => {
      schedule.mockClear();
      await play(engine.roll({ dice: [{ type: 'd20', count: 4, theme: themeId }] }));
      const events = schedule.mock.calls[0]![0];
      return new Set(events.filter((e) => e.kind === 'impact').map((e) => e.group.split('-')[0]));
    };
    expect(await groupsOf('metal')).toEqual(new Set(['metal']));
    expect(await groupsOf('vidro-no-metal')).toEqual(new Set(['glass']));
    expect(await groupsOf('estranho')).toEqual(new Set(['metal']));
    await groupsOf('estranho');
    expect(warn.mock.calls.filter(([m]) => String(m).includes('borracha'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('destroy fecha o AudioContext', async () => {
    const { audio, context } = await runningAudio();
    const { engine } = createHarness(physics, { audio });
    engine.destroy();
    await flush();
    expect(context.state).toBe('closed');
  });
});
