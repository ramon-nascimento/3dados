import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type { DiceEngine, DiceEngineOptions } from '../../src/integration/engine';

/** O construtor do motor, tirado da instância do playground. */
interface EngineClass {
  create(container: HTMLElement, options?: DiceEngineOptions): Promise<DiceEngine>;
}
type Hooks = {
  __3dados: { engine: DiceEngine & { constructor: EngineClass } };
  __long: DiceEngine;
};

/** Combinações de tipo e tema percorridas em ciclo: 21, menos que o cache de recursos (24). */
const TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];
const THEMES = ['rubi', 'safira', 'prata'];
const COMBINATIONS = TYPES.length * THEMES.length;

interface Measure {
  /** Memória de JS em uso depois de uma coleta forçada, em bytes. */
  heapUsed: number;
  /** Memória fora do heap presa a objetos de JS (buffers, inclusive a do WASM), em bytes. */
  backingStorage: number;
  domNodes: number;
  listeners: number;
  geometries: number;
  textures: number;
  effectsLive: number;
  effectsActive: number;
  particles: number;
  voices: number;
  canvases: number;
}

async function measure(page: Page, client: CDPSession): Promise<Measure> {
  // Duas coletas: a primeira libera o que depende de finalizadores.
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.collectGarbage');
  const heap = (await client.send('Runtime.getHeapUsage')) as {
    usedSize: number;
    backingStorageSize?: number;
  };
  const dom = await client.send('Memory.getDOMCounters');
  const engine = await page.evaluate(() => {
    const engine = (window as unknown as Hooks).__long;
    const { render, effects, audio } = engine.getStats();
    return {
      geometries: render.geometries,
      textures: render.textures,
      effectsLive: effects.created - effects.disposed,
      effectsActive: effects.active,
      particles: effects.particles,
      voices: audio.activeVoices,
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  return {
    heapUsed: heap.usedSize,
    backingStorage: heap.backingStorageSize ?? 0,
    domNodes: dom.nodes,
    listeners: dom.jsEventListeners,
    ...engine,
  };
}

/** Rola `count` vezes, uma depois da outra, com sons e efeitos; devolve quantas concluíram. */
function rollMany(page: Page, from: number, count: number): Promise<number> {
  return page.evaluate(
    async ({ from, count, types, themes }) => {
      const engine = (window as unknown as Hooks).__long;
      let completed = 0;
      for (let i = from; i < from + count; i++) {
        const outcome = await engine.roll({
          dice: [
            {
              type: types[i % types.length]!,
              count: 1 + (i % 3),
              theme: themes[Math.floor(i / types.length) % themes.length]!,
            },
          ],
          effects: [
            { effect: 'trail', on: 'start' },
            { effect: 'critical', on: 'settled' },
          ],
        }).result;
        if (outcome.status === 'completed') completed++;
      }
      // Espera os efeitos da última rolagem terminarem e limpa a mesa.
      for (let i = 0; i < 400 && engine.getStats().render.active; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      engine.clear();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return completed;
    },
    { from, count, types: TYPES, themes: THEMES },
  );
}

test('200 rolagens seguidas não acumulam memória', async ({ page }) => {
  // Cerca de 221 rolagens completas, animadas em tempo real.
  test.setTimeout(900_000);
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  // Áudio do playground desligado: o gesto do teste só desbloqueia o motor criado aqui.
  await page.goto('/?audio=off&effects=off');
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');

  // Um motor próprio, sem espera entre rolagens, com som, efeitos e bandeja.
  await page.evaluate(async (themeIds) => {
    const playground = (window as unknown as Hooks).__3dados.engine;
    playground.clear();
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
    document.body.append(host);
    const engine = await playground.constructor.create(host, {
      audio: { enabled: true, baseUrl: '/sounds/' },
      effects: { level: 'full' },
      presentation: 'tray',
      queue: { holdMs: 0 },
    });
    for (const id of themeIds) engine.registerTheme(playground.getTheme(id)!);
    Object.assign(window, { __long: engine });
  }, THEMES);
  // Um gesto real desbloqueia o áudio (política de autoplay).
  await page.mouse.click(5, 5);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Hooks).__long.audio.state))
    .toBe('running');

  const client = await page.context().newCDPSession(page);
  // Aquecimento: um ciclo completo, para o cache de recursos, o JIT e o banco
  // de sons chegarem ao estado de uso contínuo antes da primeira medição.
  expect(await rollMany(page, 0, COMBINATIONS)).toBe(COMBINATIONS);
  const before = await measure(page, client);

  expect(await rollMany(page, COMBINATIONS, 200)).toBe(200);
  const after = await measure(page, client);

  const stats = await page.evaluate(() => (window as unknown as Hooks).__long.getStats());
  expect(stats.rolls).toMatchObject({ completed: COMBINATIONS + 200, failed: 0, cancelled: 0 });
  // Os sons e os efeitos estavam mesmo ligados.
  expect(stats.audio.scheduled).toBeGreaterThan(1000);
  expect(stats.effects.created).toBeGreaterThan(1000);

  const growth = {
    heapKb: Math.round((after.heapUsed - before.heapUsed) / 1024),
    backingStorageKb: Math.round((after.backingStorage - before.backingStorage) / 1024),
    domNodes: after.domNodes - before.domNodes,
    listeners: after.listeners - before.listeners,
  };
  console.log(
    `[memória] antes: ${JSON.stringify(before)}\n[memória] depois: ${JSON.stringify(after)}\n[memória] crescimento: ${JSON.stringify(growth)}`,
  );

  // Recursos de GPU, efeitos, vozes e DOM: exatamente como depois do aquecimento.
  expect(after.geometries).toBe(before.geometries);
  expect(after.textures).toBe(before.textures);
  expect(after).toMatchObject({ effectsLive: 0, effectsActive: 0, particles: 0, voices: 0 });
  expect(after.canvases).toBe(before.canvases);
  // Os painéis do playground trocam nós de texto o tempo todo: a contagem
  // oscila em dezenas. Um nó ou ouvinte por rolagem daria 200 a mais.
  expect(growth.domNodes).toBeLessThan(50);
  expect(growth.listeners).toBeLessThan(10);
  // Memória fora do heap: é onde ficam as gravações das rolagens e os buffers
  // de geometria e de som. Uma gravação retida por rolagem somaria megabytes.
  expect(growth.backingStorageKb).toBeLessThan(256);
  // Heap de JS: nas primeiras centenas de rolagens ele sobe cerca de 1 MB e
  // mais adiante cai 4 MB de uma vez; depois disso fica plano (medido em 821
  // rolagens, docs/BENCHMARKS.md). A folga cobre
  // essa oscilação; um vazamento de 10 KB por rolagem passaria dela.
  expect(growth.heapKb).toBeLessThan(2048);
  expect(problems).toEqual([]);
});
