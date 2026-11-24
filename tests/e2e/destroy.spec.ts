import { expect, test, type Page } from '@playwright/test';
import type { DiceEngine, DiceEngineOptions } from '../../src/integration/engine';

/** O construtor do motor, tirado da instância do playground. */
interface EngineClass {
  create(container: HTMLElement, options?: DiceEngineOptions): Promise<DiceEngine>;
}
/** Partes internas lidas só para medir a memória de GPU do three. */
interface Internals {
  deps: { renderer: { renderer: { info: { memory: { geometries: number; textures: number } } } } };
}

/**
 * Instrumenta a página antes de qualquer script: ouvintes em `window`,
 * `document` e `matchMedia`, `ResizeObserver`, `requestAnimationFrame`,
 * `AudioContext` e contextos WebGL. Assim o teste confere, de fora do motor,
 * que `destroy()` devolve tudo o que a criação e o uso pegaram.
 */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const ids = new WeakMap<object, number>();
    let nextId = 1;
    const idOf = (fn: object) => {
      if (!ids.has(fn)) ids.set(fn, nextId++);
      return ids.get(fn)!;
    };
    const listeners = new Map<string, Set<string>>();
    const labelOf = (target: EventTarget): string | undefined =>
      target === window
        ? 'window'
        : target === document
          ? 'document'
          : target instanceof MediaQueryList
            ? 'media'
            : undefined;
    const keyOf = (type: string, listener: unknown, options: unknown) => {
      const capture =
        typeof options === 'boolean' ? options : (options as { capture?: boolean })?.capture;
      return `${type}|${idOf(listener as object)}|${capture === true}`;
    };
    // Os originais são chamados com `.call(this, ...)` logo abaixo.
    /* eslint-disable @typescript-eslint/unbound-method */
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const getContext = HTMLCanvasElement.prototype.getContext;
    /* eslint-enable @typescript-eslint/unbound-method */
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      const label = labelOf(this);
      if (label && listener) {
        let set = listeners.get(label);
        if (!set) listeners.set(label, (set = new Set()));
        set.add(keyOf(type, listener, options));
      }
      add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const label = labelOf(this);
      if (label && listener) listeners.get(label)?.delete(keyOf(type, listener, options));
      remove.call(this, type, listener, options);
    };

    const pendingFrames = new Set<number>();
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      const id = raf((time) => {
        pendingFrames.delete(id);
        callback(time);
      });
      pendingFrames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pendingFrames.delete(id);
      caf(id);
    };

    const observing = new Set<ResizeObserver>();
    const OriginalObserver = window.ResizeObserver;
    window.ResizeObserver = class extends OriginalObserver {
      override observe(target: Element, options?: ResizeObserverOptions) {
        observing.add(this);
        super.observe(target, options);
      }
      override disconnect() {
        observing.delete(this);
        super.disconnect();
      }
    };

    const audioContexts: AudioContext[] = [];
    const OriginalAudio = window.AudioContext;
    window.AudioContext = class extends OriginalAudio {
      constructor(options?: AudioContextOptions) {
        super(options);
        audioContexts.push(this);
      }
    };

    const glContexts: WebGLRenderingContext[] = [];
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof getContext>
    ) {
      const context = getContext.apply(this, args);
      if (context && (args[0] === 'webgl2' || args[0] === 'webgl')) {
        glContexts.push(context as WebGLRenderingContext);
      }
      return context;
    } as typeof getContext;

    Object.assign(window, {
      __probe: {
        snapshot: () => ({
          listeners: Object.fromEntries(
            [...listeners]
              .filter(([, set]) => set.size > 0)
              .map(([label, set]) => [label, set.size]),
          ),
          pendingFrames: pendingFrames.size,
          observing: observing.size,
        }),
        audioContexts,
        glContexts,
      },
    });
  });
}

interface Snapshot {
  listeners: Record<string, number>;
  pendingFrames: number;
  observing: number;
}

async function open(page: Page): Promise<string[]> {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  await instrument(page);
  // Áudio do playground desligado: o gesto do teste só desbloqueia o motor criado aqui.
  await page.goto('/?audio=off');
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  return messages;
}

const snapshot = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __probe: { snapshot(): Snapshot } }).__probe.snapshot(),
  );

test('destroy() devolve ouvintes, quadros, observadores, áudio, GPU e canvas', async ({ page }) => {
  const messages = await open(page);
  const before = await snapshot(page);
  const glBefore = await page.evaluate(
    () => (window as unknown as { __probe: { glContexts: unknown[] } }).__probe.glContexts.length,
  );

  // Um segundo motor, com áudio e efeitos ligados, usado de todas as formas.
  await page.evaluate(async () => {
    const Engine = (window as unknown as { __3dados: { engine: { constructor: EngineClass } } })
      .__3dados.engine.constructor;
    const host = document.createElement('div');
    host.id = 'segundo';
    Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
    document.body.append(host);
    const engine = await Engine.create(host, {
      audio: { enabled: true, baseUrl: '/sounds/' },
      effects: { level: 'full' },
      presentation: 'tray',
      queue: { holdMs: 0 },
    });
    Object.assign(window, { __second: engine });
  });
  const during = await snapshot(page);
  // O motor pegou recursos: há mais ouvintes de gesto e um observador a mais.
  expect(during.observing).toBe(before.observing + 1);
  expect(during.listeners.document ?? 0).toBeGreaterThan(before.listeners.document ?? 0);

  // Um gesto real desbloqueia o áudio (política de autoplay).
  await page.mouse.click(5, 5);
  const used = await page.evaluate(async () => {
    const engine = (window as unknown as { __second: DiceEngine }).__second;
    for (let i = 0; i < 50 && engine.audio.state !== 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const first = engine.roll({
      dice: [
        { type: 'd20', values: [20] },
        { type: 'd6', count: 3 },
      ],
      effects: [
        { effect: 'trail', on: 'start' },
        { effect: 'critical', when: { values: [20] } },
      ],
    });
    const outcome = await first.result;
    engine.effects.trigger('fire');
    engine.remote.receive({
      protocolVersion: 1,
      type: 'roll.requested',
      roomId: 'sala',
      playerId: 'ana',
      sequence: 1,
      sentAt: Date.now(),
      rollId: 'remota',
      payload: {
        dice: [{ type: 'd12', values: [7], count: 1 }],
        effects: [{ effect: 'trail', on: 'start' }],
      },
    });
    // Uma terceira rolagem fica na fila; destrói com a remota animando.
    const queued = engine.roll({ dice: [{ type: 'd8' }] });
    for (let i = 0; i < 100 && engine.getState().activeRoll?.phase !== 'animating'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Um efeito preso a um ponto da mesa, que sobrevive à troca de dados.
    engine.effects.trigger('glow', { position: { x: 0, y: 0.5, z: 0 }, durationMs: 10_000 });
    const memory = (engine as unknown as Internals).deps.renderer.renderer.info.memory;
    const inUse = { geometries: memory.geometries, textures: memory.textures };
    const state = engine.getState();
    const effects = engine.effects.getStats();
    engine.destroy();
    const queuedOutcome = await queued.result;
    // Dois quadros: um motor vivo teria pedido outro.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterEffects = engine.effects.getStats();
    return {
      outcome: outcome.status,
      audioState: state.audio.state,
      phase: state.activeRoll?.phase,
      queued: state.queue.length,
      effectsActive: effects.active,
      inUse,
      after: { geometries: memory.geometries, textures: memory.textures },
      afterEffects,
      queuedOutcome,
      canvasLeft: document.querySelector('#segundo')!.children.length,
      destroyedState: engine.getState().status,
      rollAfter: await engine
        .roll({ dice: [{ type: 'd6' }] })
        .result.then((after) => (after.status === 'failed' ? after.error.code : after.status)),
      remoteAfter: engine.remote.receive({}).error?.code,
    };
  });

  // O motor estava em uso de verdade quando foi destruído.
  expect(used.outcome).toBe('completed');
  expect(used.audioState).toBe('running');
  expect(used.phase).toBe('animating');
  expect(used.queued).toBe(1);
  expect(used.effectsActive).toBeGreaterThan(0);
  expect(used.inUse.geometries).toBeGreaterThan(0);
  expect(used.inUse.textures).toBeGreaterThan(0);

  // Depois de destroy: nada sobra.
  expect(used.queuedOutcome).toMatchObject({ status: 'cancelled', reason: 'destroyed' });
  expect(used.after).toEqual({ geometries: 0, textures: 0 });
  expect(used.afterEffects).toMatchObject({ active: 0, particles: 0, objects: 0 });
  expect(used.afterEffects.created).toBe(used.afterEffects.disposed);
  expect(used.canvasLeft).toBe(0);
  expect(used.destroyedState).toBe('destroyed');
  expect(used.rollAfter).toBe('ENGINE_DESTROYED');
  expect(used.remoteAfter).toBe('ENGINE_DESTROYED');

  expect(await snapshot(page)).toEqual(before);
  const external = await page.evaluate(async (glBefore) => {
    const probe = (
      window as unknown as {
        __probe: { audioContexts: AudioContext[]; glContexts: WebGLRenderingContext[] };
      }
    ).__probe;
    // `close()` é assíncrono.
    for (let i = 0; i < 50 && probe.audioContexts.some((c) => c.state !== 'closed'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return {
      audio: probe.audioContexts.map((context) => context.state),
      // Contextos criados pelo segundo motor (o diagnóstico do playground perde o seu na hora).
      gl: probe.glContexts.slice(glBefore).map((context) => context.isContextLost()),
    };
  }, glBefore);
  expect(external.audio).toEqual(['closed']);
  expect(external.gl.length).toBeGreaterThan(0);
  expect(external.gl.every(Boolean)).toBe(true);
  expect(messages.filter((m) => m.startsWith('error') || m.startsWith('pageerror'))).toEqual([]);
});

test('criar e destruir 20 motores não esgota os contextos WebGL', async ({ page }) => {
  // Vinte rolagens completas, uma por motor.
  test.setTimeout(240_000);
  const messages = await open(page);
  const before = await snapshot(page);
  const result = await page.evaluate(async () => {
    const Engine = (window as unknown as { __3dados: { engine: { constructor: EngineClass } } })
      .__3dados.engine.constructor;
    const probe = (window as unknown as { __probe: { glContexts: WebGLRenderingContext[] } })
      .__probe;
    const start = probe.glContexts.length;
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
    document.body.append(host);
    const outcomes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const engine = await Engine.create(host, { audio: { enabled: false } });
      const outcome = await engine.roll({ dice: [{ type: 'd6', values: [(i % 6) + 1] }] }).result;
      outcomes.push(outcome.status);
      engine.destroy();
    }
    const created = probe.glContexts.slice(start);
    return {
      outcomes,
      created: created.length,
      lost: created.filter((context) => context.isContextLost()).length,
      children: host.children.length,
    };
  });
  expect(result.outcomes).toEqual(Array(20).fill('completed'));
  expect(result.created).toBeGreaterThanOrEqual(20);
  expect(result.lost).toBe(result.created);
  expect(result.children).toBe(0);
  expect(await snapshot(page)).toEqual(before);
  // O Chromium avisa quando passa do limite de contextos vivos e derruba o mais antigo.
  expect(messages.filter((m) => /too many active webgl contexts/i.test(m))).toEqual([]);
});
