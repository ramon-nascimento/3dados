import { describe, expect, it, vi } from 'vitest';
import {
  DYNAMIC_RANGE_DB,
  DiceAudio,
  MIN_AUDIBLE_INTENSITY,
  SAMPLE_GROUPS,
  SAMPLE_GROUP_SIZES,
  crowdAttenuation,
  dbToGain,
  findRollingContacts,
  intensityToGain,
  parseAudioOptions,
  planRollSounds,
  repeatAttenuation,
  sampleFileName,
  synthDuration,
  synthesize,
  type AudioOptions,
  type SoundEvent,
} from '../../src/audio';
import { D6 } from '../../src/core/dice/d6';
import { quatMultiply, type Quat } from '../../src/core/math';
import type { DieTrajectory, SimulationRecording } from '../../src/core/trajectory';
import { createFakeEnvironment, flush } from './helpers/fake-audio';

function audio(options: AudioOptions = {}, env = createFakeEnvironment()) {
  const player = new DiceAudio(options, env, { surface: 'wood' });
  return { player, env, context: () => env.contexts[0] };
}

/** Um evento de som simples, para alimentar o reprodutor diretamente. */
function event(timeMs: number, gain: number): SoundEvent {
  return { timeMs, kind: 'impact', group: 'plastic-light', variant: 0, gain, rate: 1 };
}

describe('mapeamento de intensidade para ganho', () => {
  it('intensidade 1 toca a 0 dB e a faixa dinâmica é de 36 dB', () => {
    expect(intensityToGain(1)).toBe(1);
    expect(intensityToGain(0.25)).toBeCloseTo(dbToGain(-18), 10);
    expect(DYNAMIC_RANGE_DB).toBe(36);
  });

  it('é crescente e fica entre 0 e 1', () => {
    let previous = 0;
    for (let i = 0; i <= 200; i++) {
      const intensity = i / 200;
      const gain = intensityToGain(intensity);
      expect(gain).toBeGreaterThanOrEqual(previous);
      expect(gain).toBeLessThanOrEqual(1);
      previous = gain;
    }
  });

  it('silencia abaixo do limiar e ignora valores inválidos', () => {
    expect(intensityToGain(MIN_AUDIBLE_INTENSITY / 2)).toBe(0);
    expect(intensityToGain(0)).toBe(0);
    expect(intensityToGain(-1)).toBe(0);
    expect(intensityToGain(Number.NaN)).toBe(0);
    expect(intensityToGain(MIN_AUDIBLE_INTENSITY)).toBeGreaterThan(0);
    expect(intensityToGain(5)).toBe(1);
  });

  it('o primeiro som audível fica perto do fundo da faixa dinâmica', () => {
    const db = 20 * Math.log10(intensityToGain(MIN_AUDIBLE_INTENSITY));
    expect(db).toBeGreaterThan(-DYNAMIC_RANGE_DB);
    expect(db).toBeLessThan(-25);
  });

  it('atenua pela quantidade de dados em movimento', () => {
    expect(crowdAttenuation(0)).toBe(1);
    expect(crowdAttenuation(1)).toBe(1);
    expect(crowdAttenuation(20)).toBeCloseTo(20 ** -0.4, 10);
    for (let n = 2; n <= 30; n++) {
      expect(crowdAttenuation(n)).toBeLessThan(crowdAttenuation(n - 1));
      // A mesa cheia soma mais energia que um dado só: n × ganho² cresce.
      expect(n * crowdAttenuation(n) ** 2).toBeGreaterThan(1);
    }
  });

  it('atenua e descarta impactos em rajada do mesmo dado', () => {
    expect(repeatAttenuation(5)).toBe(0);
    expect(repeatAttenuation(14.9)).toBe(0);
    expect(repeatAttenuation(15)).toBeGreaterThan(0);
    expect(repeatAttenuation(30)).toBeLessThan(repeatAttenuation(45));
    expect(repeatAttenuation(60)).toBe(1);
    expect(repeatAttenuation(Infinity)).toBe(1);
  });
});

describe('opções de áudio', () => {
  it('aceita opções válidas', () => {
    expect(
      parseAudioOptions({
        enabled: false,
        volume: 0.5,
        baseUrl: '/sons',
        surface: 'felt',
        maxVoices: 8,
        autoUnlock: false,
      }),
    ).toEqual({
      enabled: false,
      volume: 0.5,
      baseUrl: '/sons',
      surface: 'felt',
      maxVoices: 8,
      autoUnlock: false,
    });
    expect(parseAudioOptions(undefined)).toEqual({});
  });

  it.each([
    [{ volume: 2 }, 'audio.volume'],
    [{ volume: Number.NaN }, 'audio.volume'],
    [{ enabled: 'sim' }, 'audio.enabled'],
    [{ surface: 'grama' }, 'audio.surface'],
    [{ maxVoices: 0 }, 'audio.maxVoices'],
    [{ maxVoices: 2.5 }, 'audio.maxVoices'],
    [{ baseUrl: '' }, 'audio.baseUrl'],
    [{ volumes: 1 }, 'audio.volumes'],
    ['alto', 'audio'],
  ])('recusa %j com mensagem sobre %s', (input, path) => {
    expect(() => parseAudioOptions(input)).toThrow(path);
    expect(() => parseAudioOptions(input)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});

describe('nenhum AudioContext com o áudio desligado', () => {
  it('não cria contexto, não baixa arquivos e não escuta gestos', async () => {
    const { player, env } = audio({ enabled: false, baseUrl: '/sons/' });
    env.gesture();
    env.userActivation = true;
    expect(await player.unlock()).toBe(false);
    player.unlockIfGesture();
    player.scheduleRoll([event(0, 1)]);
    expect(player.play('bell')).toBe(false);
    expect(player.playImpact({ profile: 'metal', intensity: 1 })).toBe(false);
    player.setVolume(0.3);
    player.setSurface('felt');
    player.stopAll();
    expect(player.getStats().state).toBe('off');
    player.dispose();
    await flush();

    expect(env.contexts).toHaveLength(0);
    expect(env.fetched).toHaveLength(0);
    expect(env.listeners).toBe(0);
  });

  it('desligar depois de ligado suspende o contexto e para os sons', async () => {
    const { player, env, context } = audio();
    env.gesture();
    await player.ready();
    player.scheduleRoll([event(0, 1), event(500, 1)]);
    player.setEnabled(false);
    await flush();
    expect(context()!.state).toBe('suspended');
    expect(context()!.sources).toHaveLength(2);
    expect(context()!.audible()).toHaveLength(0);
    expect(player.play('bell')).toBe(false);
  });
});

describe('desbloqueio e política de autoplay', () => {
  it('ligado, o contexto só nasce no primeiro gesto', async () => {
    const { player, env, context } = audio();
    expect(env.contexts).toHaveLength(0);
    expect(player.state).toBe('locked');
    expect(env.listeners).toBe(1);

    env.gesture();
    await flush();
    expect(env.contexts).toHaveLength(1);
    expect(context()!.state).toBe('running');
    expect(player.state).toBe('running');
    // Liberado, não escuta mais gestos.
    expect(env.listeners).toBe(0);
  });

  it('sem autoUnlock, nada acontece até unlock()', async () => {
    const { player, env } = audio({ autoUnlock: false });
    expect(env.listeners).toBe(0);
    env.userActivation = true;
    player.unlockIfGesture();
    expect(env.contexts).toHaveLength(0);
    expect(await player.unlock()).toBe(true);
    expect(env.contexts).toHaveLength(1);
  });

  it('fora de um gesto o navegador recusa e o próximo gesto tenta de novo', async () => {
    const env = createFakeEnvironment({ configure: (context) => (context.allowResume = false) });
    const { player } = audio({}, env);
    expect(await player.unlock()).toBe(false);
    expect(player.state).toBe('locked');
    expect(env.listeners).toBe(1);
    env.contexts[0]!.allowResume = true;
    env.gesture();
    await flush();
    expect(player.state).toBe('running');
    expect(env.contexts).toHaveLength(1);
  });

  it('sem Web Audio fica indisponível, sem erro', async () => {
    const { player } = audio({}, createFakeEnvironment({ webAudio: false }));
    expect(await player.unlock()).toBe(false);
    expect(player.state).toBe('unavailable');
  });

  it('ligar dentro de um clique já libera', async () => {
    const { player, env } = audio({ enabled: false });
    env.userActivation = true;
    player.setEnabled(true);
    await flush();
    expect(player.state).toBe('running');
  });
});

describe('banco de sons', () => {
  it('sem baseUrl, sintetiza tudo sem baixar nada', async () => {
    const { player, env } = audio();
    await player.unlock();
    await player.ready();
    expect(env.fetched).toHaveLength(0);
    expect(player.getStats().source).toBe('synth');
  });

  it('com baseUrl, baixa cada arquivo e sintetiza só o que falhar', async () => {
    const env = createFakeEnvironment();
    env.failing.add('/sons/bell.wav');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { player } = audio({ baseUrl: '/sons' }, env);
    const files = SAMPLE_GROUPS.flatMap((group) =>
      Array.from(
        { length: SAMPLE_GROUP_SIZES[group] },
        (_, v) => `/sons/${sampleFileName(group, v)}`,
      ),
    );
    // Baixa ao ser criado (permitido sem gesto); decodifica depois do desbloqueio.
    expect(env.fetched.sort()).toEqual(files.sort());
    await player.unlock();
    await player.ready();
    expect(player.getStats().source).toBe('mixed');
    expect(warn).toHaveBeenCalledOnce();
    expect(player.play('bell')).toBe(true);
    warn.mockRestore();
  });

  it('são 37 arquivos com os nomes do script de conversão', () => {
    const files = SAMPLE_GROUPS.flatMap((group) =>
      Array.from({ length: SAMPLE_GROUP_SIZES[group] }, (_, v) => sampleFileName(group, v)),
    );
    expect(files).toHaveLength(37);
    expect(files).toContain('plastic-light-1.wav');
    expect(files).toContain('bell.wav');
  });

  it('sons registrados pela aplicação tocam pelo nome; nome desconhecido é erro', async () => {
    const { player } = audio();
    await player.unlock();
    await player.registerSound('critico', '/meus/critico.mp3');
    await player.ready();
    expect(player.play('critico', { volume: 0.5 })).toBe(true);
    expect(() => player.play('nada')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
    expect(() => player.registerSound('com espaço', '/x.mp3')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });

  it('falha ao baixar um som registrado vira ASSET_LOAD_FAILED', async () => {
    const env = createFakeEnvironment();
    env.failing.add('/x.mp3');
    const { player } = audio({}, env);
    await expect(player.registerSound('x', '/x.mp3')).rejects.toMatchObject({
      code: 'ASSET_LOAD_FAILED',
    });
  });
});

describe('limite de vozes', () => {
  async function running(options: AudioOptions = {}) {
    const setup = audio(options);
    await setup.player.unlock();
    await setup.player.ready();
    return setup;
  }

  it('nunca passa do limite e fica com os sons mais fortes', async () => {
    const { player, context } = await running({ maxVoices: 4 });
    const gains = [0.1, 0.9, 0.2, 0.8, 0.3, 0.7, 0.4, 0.6, 0.5, 1];
    player.scheduleRoll(gains.map((gain) => event(0, gain)));
    expect(context()!.maxConcurrent()).toBe(4);
    const kept = context()!
      .audible()
      .map((source) => context()!.gains[context()!.sources.indexOf(source) + 1]!.gain.value);
    expect(kept.sort()).toEqual([0.7, 0.8, 0.9, 1]);
    const stats = player.getStats();
    expect(stats.stolen + stats.dropped).toBe(6);
  });

  it('vale para sons que começam em instantes diferentes e se sobrepõem', async () => {
    const { player, context } = await running({ maxVoices: 3 });
    // Cada som dura ~0,3 s (síntese de plástico); começam a cada 20 ms.
    player.scheduleRoll(Array.from({ length: 40 }, (_, i) => event(i * 20, 0.2 + (i % 7) * 0.1)));
    expect(context()!.maxConcurrent()).toBeLessThanOrEqual(3);
  });

  it('um som avulso no meio de uma rolagem agendada também respeita o limite', async () => {
    const { player, context } = await running({ maxVoices: 2 });
    player.scheduleRoll([event(100, 0.5), event(120, 0.5)]);
    expect(player.play('bell', { volume: 1 })).toBe(true);
    expect(context()!.maxConcurrent()).toBeLessThanOrEqual(2);
  });

  it('a rolagem que libera o áudio toca quando o banco fica pronto', async () => {
    const { player, context } = audio();
    await player.unlock();
    // O banco ainda está carregando: os sons esperam por ele.
    player.scheduleRoll([event(0, 1), event(500, 1)]);
    expect(context()!.sources).toHaveLength(0);
    await player.ready();
    await flush();
    expect(context()!.audible()).toHaveLength(2);
  });

  it('um som pedido no clique que libera o áudio também espera o banco', async () => {
    const { player, context } = audio();
    void player.unlock();
    await flush();
    expect(player.play('bell')).toBe(true);
    expect(player.playImpact({ profile: 'wood', intensity: 0.5 })).toBe(true);
    await player.ready();
    await flush();
    expect(context()!.audible()).toHaveLength(2);
  });

  it('sons adiados que já passaram, ou de uma rolagem cancelada, não tocam', async () => {
    const late = audio();
    await late.player.unlock();
    late.player.scheduleRoll([event(0, 1), event(500, 1)]);
    late.context()!.currentTime = 0.2; // o banco demorou 200 ms
    await late.player.ready();
    await flush();
    expect(late.context()!.audible()).toHaveLength(1);
    expect(late.player.getStats().skipped).toBe(1);

    const cancelled = audio();
    await cancelled.player.unlock();
    cancelled.player.scheduleRoll([event(0, 1)]);
    cancelled.player.stopAll();
    await cancelled.player.ready();
    await flush();
    expect(cancelled.context()!.sources).toHaveLength(0);
  });

  it('stopAll interrompe o que está tocando e o que ainda vai tocar', async () => {
    const { player, context } = await running();
    player.scheduleRoll([event(0, 1), event(800, 1)]);
    player.stopAll();
    expect(context()!.audible()).toHaveLength(0);
  });
});

describe('síntese procedural', () => {
  it.each(SAMPLE_GROUPS)('%s: amostras finitas, pico de −1 dBFS e duração prevista', (group) => {
    const pcm = synthesize(group, 0, 44_100);
    expect(pcm.length).toBe(Math.ceil(synthDuration(group) * 44_100));
    let peak = 0;
    for (const v of pcm) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.891, 3);
  });

  it('variações diferem entre si e são determinísticas', () => {
    const a = synthesize('wood-light', 0, 44_100);
    expect(synthesize('wood-light', 0, 44_100)).toEqual(a);
    expect(synthesize('wood-light', 1, 44_100)).not.toEqual(a);
  });
});

/** Trajetória de um d6 que gira em torno de um eixo, apoiado na mesa. */
function tumblingCube(angles: readonly number[]): DieTrajectory {
  const positions = new Float32Array(angles.length * 3);
  const rotations = new Float32Array(angles.length * 4);
  angles.forEach((angle, frame) => {
    const q: Quat = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
    // Altura do centro: o vértice mais baixo encosta em y = 0.
    const lowest = Math.min(
      ...D6.vertices.map((v) => {
        const r = quatMultiply(quatMultiply(q, { ...v, w: 0 }), {
          x: -q.x,
          y: -q.y,
          z: -q.z,
          w: q.w,
        });
        return r.y;
      }),
    );
    positions.set([0, -lowest, 0], frame * 3);
    rotations.set([q.x, q.y, q.z, q.w], frame * 4);
  });
  return { dieId: 'd', positions, rotations, settledStep: angles.length - 1 };
}

describe('sons de rolagem', () => {
  it('um d6 parado não produz tombos', () => {
    expect(findRollingContacts(tumblingCube(Array(60).fill(0)), D6, 1 / 120)).toEqual([]);
  });

  it('um d6 que tomba por uma aresta produz um tombo, com velocidade proporcional ao giro', () => {
    const quarter = Array.from({ length: 31 }, (_, i) => (i / 30) * (Math.PI / 2));
    const contacts = findRollingContacts(tumblingCube(quarter), D6, 1 / 120);
    // Começa apoiado em uma face; a face seguinte encosta no fim do tombo.
    expect(contacts).toHaveLength(1);
    const omega = Math.PI / 2 / 30 / (1 / 120);
    const radius = Math.hypot(0.5, 0.5, 0.5);
    expect(contacts[0]!.speed).toBeCloseTo(omega * radius, 1);
  });

  it('dois tombos seguidos produzem dois sons', () => {
    const half = Array.from({ length: 61 }, (_, i) => (i / 30) * (Math.PI / 2));
    expect(findRollingContacts(tumblingCube(half), D6, 1 / 120).length).toBe(2);
  });
});

describe('planejamento dos sons', () => {
  const recording: SimulationRecording = {
    timestep: 1 / 120,
    stepCount: 60,
    dice: [
      { ...tumblingCube(Array(61).fill(0)), dieId: 'a', settledStep: 50 },
      { ...tumblingCube(Array(61).fill(0)), dieId: 'b', settledStep: 55 },
    ],
    collisions: [
      { step: 10, dieId: 'a', otherDieId: null, intensity: 0.8 },
      { step: 10, dieId: 'b', otherDieId: null, intensity: 0.1 },
      { step: 11, dieId: 'a', otherDieId: null, intensity: 0.5 }, // rajada: descartado
      { step: 20, dieId: 'a', otherDieId: 'b', intensity: 0.3 },
      { step: 30, dieId: 'b', otherDieId: null, intensity: 0.005 }, // inaudível
    ],
  };
  const dice = [
    { dieId: 'a', definition: D6, profile: 'metal' as const },
    { dieId: 'b', definition: D6, profile: 'crystal' as const },
  ];

  it('é determinístico pela semente e não depende de outro RNG', () => {
    const a = planRollSounds({ recording, dice, surface: 'wood', seed: 7 });
    expect(planRollSounds({ recording, dice, surface: 'wood', seed: 7 })).toEqual(a);
    expect(planRollSounds({ recording, dice, surface: 'wood', seed: 8 })).not.toEqual(a);
  });

  it('começa com o lançamento e segue a linha do tempo da física', () => {
    const events = planRollSounds({ recording, dice, surface: 'wood', seed: 1 });
    expect(events[0]).toMatchObject({ kind: 'launch', timeMs: 0, group: 'launch' });
    const impacts = events.filter((e) => e.kind === 'impact');
    expect(impacts.map((e) => [e.dieId, Math.round(e.timeMs)])).toEqual([
      ['a', 83],
      ['b', 83],
      ['a', 167],
    ]);
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timeMs).toBeGreaterThanOrEqual(events[i - 1]!.timeMs);
    }
  });

  it('o material escolhe as amostras e a intensidade escolhe leve ou forte', () => {
    const events = planRollSounds({ recording, dice, surface: 'wood', seed: 1 });
    const impacts = events.filter((e) => e.kind === 'impact');
    expect(impacts[0]!.group).toBe('metal-heavy');
    // Cristal usa as amostras de vidro, mais agudas.
    expect(impacts[1]!.group).toBe('glass-light');
    expect(impacts[1]!.rate).toBeGreaterThan(1.2);
    expect(impacts[0]!.gain).toBeGreaterThan(impacts[1]!.gain);
  });

  it('no feltro, o contato com a mesa é um baque abafado; entre dados, não', () => {
    const events = planRollSounds({ recording, dice, surface: 'felt', seed: 1 });
    const impacts = events.filter((e) => e.kind === 'impact');
    expect(impacts[0]!.group).toBe('felt');
    expect(impacts[2]!.group).toBe('metal-light');
  });

  it('estabilização só quando o dado chega quieto', () => {
    const events = planRollSounds({ recording, dice, surface: 'wood', seed: 1 });
    const settles = events.filter((e) => e.kind === 'settle');
    expect(settles.map((e) => e.dieId).sort()).toEqual(['a', 'b']);
    const noisy = planRollSounds({
      recording: {
        ...recording,
        collisions: [{ step: 50, dieId: 'a', otherDieId: null, intensity: 0.5 }],
      },
      dice,
      surface: 'wood',
      seed: 1,
    });
    expect(noisy.filter((e) => e.kind === 'settle').map((e) => e.dieId)).toEqual(['b']);
  });

  it('todo som planejado tem ganho e altura válidos', () => {
    for (const e of planRollSounds({ recording, dice, surface: 'wood', seed: 3 })) {
      expect(e.gain).toBeGreaterThan(0);
      expect(e.gain).toBeLessThanOrEqual(1.2);
      expect(e.rate).toBeGreaterThan(0.5);
      expect(e.rate).toBeLessThan(2);
      expect(e.variant).toBeLessThan(SAMPLE_GROUP_SIZES[e.group]);
    }
  });
});
