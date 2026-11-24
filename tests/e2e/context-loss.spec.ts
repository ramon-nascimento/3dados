import { expect, test, type Page } from '@playwright/test';
import type { RollOutcome, RollRequest } from '../../src/core/types';
import type { DiceEngine } from '../../src/integration/engine';

type Hooks = { __3dados: { engine: DiceEngine } };
/** Partes internas usadas só para desenhar um quadro na hora e ler os pixels dele. */
interface Internals {
  deps: { renderer: { render(): void } };
}

async function open(page: Page, query: string): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    // O WebGL por software do teste avisa de leituras de pixels lentas; não é do motor.
    if (/GPU stall due to ReadPixels/i.test(message.text())) return;
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  await page.evaluate(() => {
    const engine = (window as unknown as Hooks).__3dados.engine;
    const log: string[] = [];
    engine.on('contextLost', ({ activeRollId }) => log.push(`lost:${activeRollId ?? '-'}`));
    engine.on('contextRestored', () => log.push('restored'));
    Object.assign(window, { __contextLog: log });
  });
  return problems;
}

const contextLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __contextLog: string[] }).__contextLog);

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__3dados.engine.getState());

const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__3dados.engine.getStats());

function roll(page: Page, request: RollRequest): Promise<RollOutcome> {
  return page.evaluate(
    (req) => (window as unknown as Hooks).__3dados.engine.roll(req).result,
    request,
  );
}

/** Perde ou devolve o contexto do canvas do motor, como o navegador faria. */
async function setContext(page: Page, action: 'lose' | 'restore'): Promise<void> {
  await page.evaluate((what) => {
    const holder = window as unknown as { __lose?: WEBGL_lose_context };
    if (what === 'lose') {
      const canvas = document.querySelector<HTMLCanvasElement>('#dice canvas')!;
      holder.__lose = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
      holder.__lose.loseContext();
    } else {
      holder.__lose!.restoreContext();
    }
  }, action);
  await expect
    .poll(async () => (await state(page)).context)
    .toBe(action === 'lose' ? 'lost' : 'active');
}

/**
 * Desenha um quadro e conta os pixels que o motor pintou (o canvas do overlay
 * é transparente onde não há dado nem sombra). Com o contexto perdido, nada é
 * pintado.
 */
function paintedPixels(page: Page, storeAs?: string): Promise<number> {
  return page.evaluate((key) => {
    const engine = (window as unknown as Hooks).__3dados.engine as unknown as Internals;
    const source = document.querySelector<HTMLCanvasElement>('#dice canvas')!;
    engine.deps.renderer.render();
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    const context = copy.getContext('2d')!;
    context.drawImage(source, 0, 0);
    const { data } = context.getImageData(0, 0, copy.width, copy.height);
    if (key) {
      const store = window as unknown as { __frames?: Record<string, Uint8ClampedArray> };
      (store.__frames ??= {})[key] = data;
    }
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 8) painted++;
    return painted;
  }, storeAs);
}

/** Fração dos pixels que diferem visivelmente entre dois quadros guardados. */
function frameDifference(page: Page, a: string, b: string): Promise<number> {
  return page.evaluate(
    ([first, second]) => {
      const frames = (window as unknown as { __frames: Record<string, Uint8ClampedArray> })
        .__frames;
      const x = frames[first!]!;
      const y = frames[second!]!;
      if (x.length !== y.length) return 1;
      let different = 0;
      for (let i = 0; i < x.length; i += 4) {
        const delta =
          Math.abs(x[i]! - y[i]!) +
          Math.abs(x[i + 1]! - y[i + 1]!) +
          Math.abs(x[i + 2]! - y[i + 2]!);
        if (delta > 24) different++;
      }
      return different / (x.length / 4);
    },
    [a, b],
  );
}

test('perda do contexto no meio da animação: a rolagem conclui e a cena volta', async ({
  page,
}) => {
  const problems = await open(page, '?audio=off&effects=full');

  // Uma rolagem de referência, parada na mesa, com tudo desenhado.
  const reference = await roll(page, { id: 'antes', dice: [{ type: 'd20', values: [20, 1] }] });
  expect(reference).toMatchObject({ status: 'completed', total: 21 });

  // Perde o contexto com a rolagem seguinte animando e com um efeito na tela.
  const effectsBefore = await page.evaluate(async () => {
    const engine = (window as unknown as Hooks).__3dados.engine;
    void engine.roll({
      id: 'durante',
      dice: [
        { type: 'd6', values: [6, 2, 5] },
        { type: 'd12', values: [11] },
      ],
      effects: [{ effect: 'trail', on: 'start' }],
    });
    for (let i = 0; i < 400 && engine.getState().activeRoll?.phase !== 'animating'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    return engine.effects.getStats().active;
  });
  expect(effectsBefore).toBeGreaterThan(0);
  await setContext(page, 'lose');

  expect(await contextLog(page)).toEqual(['lost:durante']);
  await expect(page.getByTestId('perf-context')).toHaveText('perdido');
  // Os efeitos viviam na GPU perdida: saem, com os recursos liberados.
  const effects = (await stats(page)).effects;
  expect(effects.active).toBe(0);
  expect(effects.created).toBe(effects.disposed);
  expect(await paintedPixels(page)).toBe(0);

  // Sem contexto, a rolagem termina com os valores oficiais.
  await expect.poll(async () => (await state(page)).activeRoll, { timeout: 20_000 }).toBeNull();
  const lostState = await state(page);
  expect(lostState).toMatchObject({ context: 'lost', diceOnTable: 4, tableRollId: 'durante' });
  expect((await stats(page)).rolls).toMatchObject({ completed: 2, failed: 0 });

  // O contexto volta: os mesmos dados reaparecem, parados.
  await setContext(page, 'restore');
  expect(await contextLog(page)).toEqual(['lost:durante', 'restored']);
  await expect(page.getByTestId('perf-context')).toHaveText('ativo');
  await expect(page.getByTestId('perf-context-count')).toHaveText('1 · 1');
  const restored = await paintedPixels(page);
  expect(restored).toBeGreaterThan(2000);
  expect((await state(page)).diceOnTable).toBe(4);

  // E o motor segue funcionando: nova rolagem, com efeito, desenhada.
  const after = await roll(page, {
    dice: [{ type: 'd8', values: [8, 3] }],
    effects: [{ effect: 'critical', on: 'settled' }],
  });
  expect(after).toMatchObject({ status: 'completed', total: 11 });
  expect(await paintedPixels(page)).toBeGreaterThan(1000);
  expect((await stats(page)).render).toMatchObject({
    context: 'active',
    contextLosses: 1,
    contextRestores: 1,
  });
  expect(problems).toEqual([]);
});

test('perda com os dados parados: a mesa é redesenhada igual, duas vezes', async ({ page }) => {
  // Bandeja em qualidade alta com vidro: feltro, borda, sombras, ambiente e transmissão.
  const problems = await open(page, '?audio=off&effects=off&presentation=tray&quality=high');
  const outcome = await roll(page, {
    dice: [
      { type: 'd20', values: [17], theme: 'safira' },
      { type: 'd6', values: [4, 4], theme: 'ametista' },
      { type: 'd10', values: [7], theme: 'prata' },
    ],
  });
  expect(outcome).toMatchObject({ status: 'completed', total: 32 });

  const before = await paintedPixels(page, 'antes');
  const memoryBefore = (await stats(page)).render;
  expect(memoryBefore.geometries).toBeGreaterThan(3);
  expect(memoryBefore.textures).toBeGreaterThan(3);

  for (const cycle of [1, 2]) {
    await setContext(page, 'lose');
    expect(await paintedPixels(page)).toBe(0);
    await setContext(page, 'restore');
    // A bandeja cobre o canvas inteiro: todos os pixels voltam a ser pintados,
    // e a imagem é a mesma de antes (dados, números, sombras e reflexos).
    expect(await paintedPixels(page, `ciclo-${cycle}`)).toBe(before);
    expect(await frameDifference(page, 'antes', `ciclo-${cycle}`)).toBeLessThan(0.005);
    // Tudo foi enviado de novo à GPU, uma vez só: as mesmas contagens de antes.
    const memory = (await stats(page)).render;
    expect(memory.geometries).toBe(memoryBefore.geometries);
    expect(memory.textures).toBe(memoryBefore.textures);
    expect(memory).toMatchObject({ contextLosses: cycle, contextRestores: cycle });
  }
  expect(await contextLog(page)).toEqual(['lost:-', 'restored', 'lost:-', 'restored']);

  // Trocar o tema dos dados parados e rolar de novo continuam funcionando.
  const next = await roll(page, { dice: [{ type: 'd12', values: [12], theme: 'safira' }] });
  expect(next).toMatchObject({ status: 'completed', total: 12 });

  // destroy() depois de uma restauração não deixa nada na GPU.
  const left = await page.evaluate(() => {
    const engine = (window as unknown as Hooks).__3dados.engine;
    engine.destroy();
    const { geometries, textures } = engine.getStats().render;
    return { geometries, textures, canvas: document.querySelectorAll('#dice canvas').length };
  });
  expect(left).toEqual({ geometries: 0, textures: 0, canvas: 0 });
  expect(problems).toEqual([]);
});

test('rolagem pedida sem contexto conclui e aparece quando ele volta', async ({ page }) => {
  const problems = await open(page, '?audio=off&effects=full');
  await setContext(page, 'lose');

  const outcome = await roll(page, {
    dice: [{ type: 'd6', values: [3, 6] }],
    effects: [{ effect: 'glow', on: 'completed', options: { durationMs: 10_000 } }],
  });
  expect(outcome).toMatchObject({ status: 'completed', total: 9 });
  expect(await paintedPixels(page)).toBe(0);

  await setContext(page, 'restore');
  expect(await paintedPixels(page)).toBeGreaterThan(1000);
  // Os efeitos criados sem contexto (um por dado) nunca tinham ido para a GPU: seguem vivos.
  expect((await stats(page)).effects.active).toBe(2);
  expect(problems).toEqual([]);
});
