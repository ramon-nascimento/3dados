import { Points, type Object3D } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDiceError } from '../../src/core/errors';
import type { Vec3 } from '../../src/core/math';
import {
  CATALOG,
  DiceEffects,
  EFFECTS,
  MIN_FLASH_INTERVAL_MS,
  parseEffectsOptions,
  textureAlpha,
  type EffectsEnvironment,
  type EffectsHost,
  type EffectsOptions,
} from '../../src/effects';

/** Preferência de movimento controlada pelo teste. */
function fakeEnvironment(reduced = false) {
  const listeners = new Set<() => void>();
  const env: EffectsEnvironment & { set(value: boolean): void; listeners: number } = {
    prefersReducedMotion: () => reduced,
    onReducedMotionChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    set(value) {
      reduced = value;
      for (const listener of listeners) listener();
    },
    get listeners() {
      return listeners.size;
    },
  };
  return env;
}

/** Motor falso: uma mesa com dados parados e um relógio manual. */
function setup(
  options: EffectsOptions = { level: 'full' },
  dice: Record<string, Vec3> = { a: { x: 0, y: 0.5, z: 0 }, b: { x: 2, y: 0.5, z: 1 } },
  env = fakeEnvironment(),
) {
  let time = 0;
  const attached = new Set<Object3D>();
  let attachCalls = 0;
  let changes = 0;
  const table = new Map(Object.entries(dice));
  const host: EffectsHost = {
    attach(object) {
      attached.add(object);
      attachCalls++;
    },
    detach(object) {
      attached.delete(object);
    },
    resolveDice: (ids) => [...table.keys()].filter((id) => !ids || ids.includes(id)),
    dieInfo: (id) => {
      const position = table.get(id);
      return position ? { position, radius: 0.87 } : undefined;
    },
    now: () => time,
    changed: () => {
      changes++;
    },
  };
  const effects = new DiceEffects(options, env, host);
  /** Avança `ms` em quadros de 1/60 s. */
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += 1000 / 60) {
      time += 1000 / 60;
      effects.update();
    }
  };
  /** Avança até não haver mais efeitos (no máximo 20 s). */
  const finish = () => {
    for (let i = 0; i < 1200 && effects.getStats().active > 0; i++) advance(1000 / 60);
  };
  return {
    effects,
    env,
    attached,
    table,
    advance,
    finish,
    attachCalls: () => attachCalls,
    changes: () => changes,
    setTime: (value: number) => (time = value),
  };
}

function objectsOf(root: Object3D | undefined): Object3D[] {
  const all: Object3D[] = [];
  root?.traverse((object) => all.push(object));
  return all;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nível off', () => {
  it('não cria nenhum objeto, recurso ou grupo, por mais disparos que receba', () => {
    const { effects, attachCalls } = setup({ level: 'off' });
    for (const name of EFFECTS) {
      expect(effects.trigger(name)).toBeNull();
      expect(effects.trigger(name, { position: { x: 0, y: 0, z: 0 } })).toBeNull();
      expect(effects.spawnOnDice(name, ['a'], {}, 1)).toBeNull();
    }
    const stats = effects.getStats();
    expect(stats).toMatchObject({ level: 'off', active: 0, objects: 0, created: 0, particles: 0 });
    expect(stats.skipped).toBe(EFFECTS.length * 3);
    expect(effects.rootObject).toBeUndefined();
    expect(attachCalls()).toBe(0);
  });

  it('mudar para off encerra os efeitos e tira o grupo da cena', () => {
    const { effects, attached } = setup();
    effects.trigger('critical');
    expect(attached.size).toBe(1);
    effects.setLevel('off');
    expect(attached.size).toBe(0);
    expect(effects.rootObject).toBeUndefined();
    const stats = effects.getStats();
    expect(stats.active).toBe(0);
    expect(stats.created).toBe(stats.disposed);
  });
});

describe('níveis full e reduced', () => {
  it.each(EFFECTS)(
    '%s no reduced não cria partículas nem pede quadros, exceto o desvanecer',
    (name) => {
      const { effects } = setup({ level: 'reduced' });
      const handle = effects.trigger(name, { dieIds: ['a'] });
      if (name === 'trail') {
        // Rastro é movimento: no reduzido não aparece.
        expect(handle).toBeNull();
        return;
      }
      expect(handle).not.toBeNull();
      expect(objectsOf(effects.rootObject).some((o) => o instanceof Points)).toBe(false);
      expect(effects.getStats().particles).toBe(0);
      // Só o `burst` reduzido muda com o tempo (perde opacidade, sem se mover).
      expect(effects.needsFrames).toBe(name === 'burst');
    },
  );

  it.each(EFFECTS.filter((name) => name !== 'highlight' && name !== 'glow'))(
    '%s no full usa partículas',
    (name) => {
      const { effects, table, advance } = setup({ level: 'full' });
      effects.trigger(name, { dieIds: ['a'] });
      if (name === 'trail') {
        // O rastro nasce onde o dado passa.
        for (let i = 0; i < 20; i++) {
          table.set('a', { x: i * 0.2, y: 0.5, z: 0 });
          advance(1000 / 60);
        }
      } else {
        advance(200);
      }
      expect(objectsOf(effects.rootObject).some((o) => o instanceof Points)).toBe(true);
      expect(effects.getStats().particles).toBeGreaterThan(0);
      expect(effects.needsFrames).toBe(true);
    },
  );

  it('auto segue prefers-reduced-motion, inclusive quando muda', () => {
    const env = fakeEnvironment(true);
    const { effects } = setup({ level: 'auto' }, undefined, env);
    expect(effects.level).toBe('reduced');
    effects.trigger('critical');
    env.set(false);
    expect(effects.level).toBe('full');
    // A troca de nível encerra o que foi criado para o nível anterior.
    expect(effects.getStats().active).toBe(0);
    env.set(true);
    expect(effects.level).toBe('reduced');
  });

  it('um nível explícito tem prioridade sobre a preferência do sistema', () => {
    const env = fakeEnvironment(true);
    const { effects } = setup({ level: 'full' }, undefined, env);
    expect(effects.level).toBe('full');
    env.set(false);
    env.set(true);
    expect(effects.level).toBe('full');
    effects.setLevel('auto');
    expect(effects.level).toBe('reduced');
    expect(effects.levelSetting).toBe('auto');
  });

  it('setLevel recusa um nível desconhecido', () => {
    const { effects } = setup();
    expect(() => effects.setLevel('max' as never)).toThrow(/level: esperado/);
  });
});

describe('descarte de recursos', () => {
  it.each(EFFECTS)('%s libera tudo o que criou ao terminar', (name) => {
    const { effects, table, advance, finish } = setup({ level: 'full' });
    effects.trigger(name);
    for (let i = 0; i < 10; i++) {
      table.set('a', { x: i * 0.3, y: 0.5, z: 0 });
      advance(1000 / 60);
    }
    finish();
    const stats = effects.getStats();
    expect(stats.active).toBe(0);
    expect(stats.created).toBeGreaterThan(0);
    expect(stats.disposed).toBe(stats.created);
    expect(stats.particles).toBe(0);
    // Sobra só o grupo raiz, vazio.
    expect(stats.objects).toBe(1);
  });

  it.each(['full', 'reduced'] as const)(
    'stopAll, handle.stop e stopForDice liberam (%s)',
    (level) => {
      const { effects } = setup({ level });
      const handle = effects.trigger('critical', { dieIds: ['a'] });
      effects.trigger('aura', { dieIds: ['b'] });
      effects.trigger('highlight');
      handle?.stop();
      handle?.stop();
      effects.stopForDice(['b']);
      expect(effects.getStats().active).toBe(1);
      effects.stopAll();
      const stats = effects.getStats();
      expect(stats.active).toBe(0);
      expect(stats.disposed).toBe(stats.created);
      expect(stats.objects).toBe(1);
    },
  );

  it('dispose libera tudo, solta o grupo e para de ouvir a preferência', () => {
    const env = fakeEnvironment();
    const { effects, attached } = setup({ level: 'auto' }, undefined, env);
    effects.trigger('critical');
    effects.trigger('fire', { position: { x: 1, y: 0, z: 1 } });
    expect(env.listeners).toBe(1);
    effects.dispose();
    const stats = effects.getStats();
    expect(stats.disposed).toBe(stats.created);
    expect(attached.size).toBe(0);
    expect(env.listeners).toBe(0);
    expect(effects.trigger('glow')).toBeNull();
  });

  it('um dado que sai da mesa encerra o efeito preso a ele', () => {
    const { effects, table, advance } = setup({ level: 'full' });
    effects.trigger('aura', { dieIds: ['a'] });
    advance(100);
    table.delete('a');
    advance(2000);
    const stats = effects.getStats();
    expect(stats.active).toBe(0);
    expect(stats.disposed).toBe(stats.created);
  });

  it('as texturas são compartilhadas entre efeitos e liberadas com o último', () => {
    const { effects } = setup({ level: 'reduced' });
    const one = effects.trigger('glow', { dieIds: ['a'] });
    const after = effects.getStats().created;
    effects.trigger('glow', { dieIds: ['b'] });
    // O segundo halo cria só o material; a textura é a mesma.
    expect(effects.getStats().created - after).toBe(1);
    one?.stop();
    effects.stopAll();
    const stats = effects.getStats();
    expect(stats.disposed).toBe(stats.created);
  });
});

describe('disparo direto', () => {
  it('sem alvo usa todos os dados da mesa; com dieIds, só os pedidos', () => {
    const { effects } = setup({ level: 'reduced' });
    effects.trigger('highlight');
    expect(effects.getStats().objects).toBe(1 + 2);
    effects.stopAll();
    effects.trigger('highlight', { dieIds: ['b', 'zz'] });
    expect(effects.getStats().objects).toBe(1 + 1);
  });

  it('em um ponto da mesa, sem dados', () => {
    const { effects } = setup({ level: 'full' }, {});
    expect(effects.trigger('glow')).toBeNull();
    expect(effects.trigger('burst', { position: { x: 1, y: 0, z: -1 } })).not.toBeNull();
  });

  it('efeito desconhecido devolve null e avisa uma vez', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { effects } = setup();
    expect(effects.trigger('nao-existe')).toBeNull();
    expect(effects.trigger('nao-existe')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/Efeito "nao-existe" desconhecido/);
    expect(effects.getStats().skipped).toBe(2);
  });

  it('opções inválidas lançam INVALID_ARGUMENT', () => {
    const { effects } = setup();
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return isDiceError(error) ? `${error.code} ${error.message}` : String(error);
      }
      return 'aceito';
    };
    expect(code(() => effects.trigger('glow', { color: 'azul' }))).toMatch(
      /INVALID_ARGUMENT options\.color/,
    );
    expect(code(() => effects.trigger('glow', { durationMs: 20_000 }))).toMatch(/durationMs/);
    expect(code(() => effects.trigger('glow', { position: { x: 1 } as Vec3 }))).toMatch(
      /options\.position/,
    );
    expect(code(() => effects.trigger(''))).toMatch(/name/);
  });

  it('a cor e a duração pedidas valem', () => {
    const { effects, advance } = setup({ level: 'reduced' });
    effects.trigger('glow', { dieIds: ['a'], durationMs: 500, color: '#00ff00' });
    const sprite = objectsOf(effects.rootObject).find((o) => o.type === 'Sprite') as unknown as {
      material: { color: { getHexString(): string } };
    };
    expect(sprite.material.color.getHexString()).toBe('00ff00');
    advance(400);
    expect(effects.getStats().active).toBe(1);
    advance(150);
    expect(effects.getStats().active).toBe(0);
  });

  it('a intensidade vale também para anel e halo, inclusive no reduced', () => {
    const plates = (intensity: number) => {
      const { effects } = setup({ level: 'reduced' });
      effects.trigger('critical', { dieIds: ['a'], intensity });
      const all = objectsOf(effects.rootObject) as unknown as {
        type: string;
        scale: { x: number };
        material?: { opacity: number };
      }[];
      const ring = all.find((o) => o.type === 'Mesh')!;
      const halo = all.find((o) => o.type === 'Sprite')!;
      return { ring: ring.scale.x, halo: halo.material!.opacity };
    };
    const weak = plates(0.4);
    const normal = plates(1);
    const strong = plates(2);
    expect(weak.ring).toBeLessThan(normal.ring);
    expect(strong.ring).toBeGreaterThan(normal.ring);
    expect(weak.halo).toBeLessThan(normal.halo);
    expect(strong.halo).toBeGreaterThanOrEqual(normal.halo);
    expect(strong.halo).toBeLessThanOrEqual(1);
    // Intensidade 1 é o tamanho e a opacidade de referência do catálogo.
    expect(normal.ring).toBeCloseTo(0.87 * 2.6);
  });

  it('efeito parado informa quando termina; efeito animado pede quadros', () => {
    const { effects } = setup({ level: 'reduced' });
    effects.trigger('highlight', { durationMs: 1200 });
    expect(effects.needsFrames).toBe(false);
    expect(effects.nextExpiry).toBe(1200);
    effects.setLevel('full');
    effects.trigger('highlight');
    expect(effects.needsFrames).toBe(true);
  });

  it('avisa o motor a cada mudança', () => {
    const { effects, changes } = setup();
    const handle = effects.trigger('glow');
    expect(changes()).toBe(1);
    handle?.stop();
    expect(changes()).toBe(2);
  });
});

describe('presets', () => {
  it('registra sobre um efeito interno, com os ajustes do preset e do disparo', () => {
    const { effects } = setup({ level: 'reduced' });
    effects.register('fogo-azul', { base: 'fire', color: '#4aa8ff', durationMs: 1500 });
    expect(effects.has('fogo-azul')).toBe(true);
    expect(effects.phaseOf('fogo-azul')).toBe('rest');
    effects.trigger('fogo-azul', { dieIds: ['a'] });
    expect(effects.nextExpiry).toBe(1500);
    effects.trigger('fogo-azul', { dieIds: ['b'], durationMs: 300 });
    expect(effects.nextExpiry).toBe(300);
  });

  it('recusa nome interno, base desconhecida e ajustes inválidos', () => {
    const { effects } = setup();
    expect(() => effects.register('glow', { base: 'glow' })).toThrow(/efeito interno/);
    expect(() => effects.register('x', { base: 'laser' as never })).toThrow(/preset\.base/);
    expect(() => effects.register('x', { base: 'glow', color: '#12' })).toThrow(/preset\.color/);
    expect(() => effects.register('x', { base: 'glow', speed: 2 } as never)).toThrow(
      /campo desconhecido "speed"/,
    );
    expect(effects.has('x')).toBe(false);
  });

  it('fase dos efeitos de tema: só o rastro acompanha o movimento', () => {
    const { effects } = setup();
    expect(EFFECTS.filter((name) => effects.phaseOf(name) === 'motion')).toEqual(['trail']);
    expect(effects.phaseOf('nada')).toBeUndefined();
  });
});

describe('limites', () => {
  it('maxParticles vale para todos os efeitos somados', () => {
    const { effects, advance } = setup({ level: 'full', maxParticles: 50 });
    for (let i = 0; i < 6; i++) effects.trigger('burst');
    for (let i = 0; i < 6; i++) effects.trigger('fire');
    for (let i = 0; i < 30; i++) {
      advance(1000 / 60);
      expect(effects.getStats().particles).toBeLessThanOrEqual(50);
    }
    expect(effects.getStats().particles).toBe(50);
  });

  it('no máximo um clarão a cada 400 ms, com qualquer número de dados', () => {
    const { effects, setTime } = setup({ level: 'full' });
    const flashes = () =>
      objectsOf(effects.rootObject).filter(
        (o) => o.type === 'Sprite' && o.scale.x > 0.87 * 5, // o clarão é o halo grande
      ).length;
    effects.trigger('critical');
    expect(flashes()).toBe(1);
    effects.trigger('burst');
    expect(flashes()).toBe(1);
    setTime(MIN_FLASH_INTERVAL_MS);
    effects.trigger('burst', { dieIds: ['a'] });
    expect(flashes()).toBe(2);
  });

  it('a mesma semente produz as mesmas partículas', () => {
    const positions = () => {
      const { effects, advance } = setup({ level: 'full' });
      effects.spawnOnDice('burst', ['a'], {}, 1234);
      advance(100);
      const points = objectsOf(effects.rootObject).find((o) => o instanceof Points) as Points;
      return Array.from(points.geometry.getAttribute('position').array.slice(0, 30));
    };
    expect(positions()).toEqual(positions());
  });
});

describe('opções de criação', () => {
  it('padrão: auto e 2.000 partículas', () => {
    expect(parseEffectsOptions(undefined)).toEqual({ level: 'auto', maxParticles: 2000 });
  });

  it.each([
    [null, /effects: esperado um objeto/],
    [{ level: 'max' }, /effects\.level/],
    [{ maxParticles: -1 }, /effects\.maxParticles/],
    [{ maxParticles: 1.5 }, /effects\.maxParticles/],
    [{ size: 1 }, /campo desconhecido "size"/],
  ])('recusa %j', (options, message) => {
    expect(() => parseEffectsOptions(options)).toThrow(message);
  });
});

describe('catálogo e texturas', () => {
  it('todo efeito interno tem cor, duração e fase', () => {
    for (const name of EFFECTS) {
      const { color, durationMs, phase } = CATALOG[name];
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      expect(durationMs).toBeGreaterThan(0);
      expect(['motion', 'rest']).toContain(phase);
    }
  });

  it.each(['soft', 'ring', 'spark', 'smoke'] as const)(
    'a textura %s fica entre 0 e 1 e se apaga na borda',
    (kind) => {
      for (let r = 0; r <= 1; r += 0.01) {
        const alpha = textureAlpha(kind, r);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      expect(textureAlpha(kind, 1)).toBe(0);
      expect(textureAlpha(kind, 0.995)).toBeLessThan(0.05);
    },
  );
});
