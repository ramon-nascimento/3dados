import { expect, test, type Page } from '@playwright/test';
import type { RollOutcome, RollRequest } from '../../src/core/types';
import type { DiceEngine } from '../../src/integration/engine';
import type { EngineStats } from '../../src/integration/state';
import type { FrameSession, RenderQuality } from '../../src/renderer/types';

type Hooks = { __3dados: { engine: DiceEngine; benchmark: unknown } };

async function open(page: Page, query = '?audio=off'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  return errors;
}

const stats = (page: Page) =>
  page.evaluate(() => (window as unknown as Hooks).__3dados.engine.getStats());

function roll(page: Page, request: RollRequest): Promise<RollOutcome> {
  return page.evaluate(
    (req) => (window as unknown as Hooks).__3dados.engine.roll(req).result,
    request,
  );
}

/** Espera o laço de render desligar: o trecho de animação foi fechado e medido. */
async function untilIdle(page: Page): Promise<EngineStats> {
  await expect.poll(async () => (await stats(page)).render.active, { timeout: 20_000 }).toBe(false);
  return stats(page);
}

test.describe('painel de desempenho', () => {
  test('mostra as medições do motor depois de uma rolagem', async ({ page }) => {
    const errors = await open(page, '?audio=off&effects=off');
    await expect(page.getByTestId('perf-fps')).toHaveText('parado');
    await expect(page.getByTestId('perf-session')).toHaveText('—');
    await expect(page.getByTestId('perf-context')).toHaveText('ativo');
    await expect(page.getByTestId('perf-context-count')).toHaveText('0 · 0');

    const outcome = await roll(page, { dice: [{ type: 'd6', values: [1, 2, 3] }] });
    expect(outcome.status).toBe('completed');
    const measured = await untilIdle(page);
    const session = measured.render.lastSession!;

    // O que o painel mostra é o que o motor mediu.
    expect(session.frames).toBeGreaterThan(10);
    expect(session.fps).toBeGreaterThan(1);
    expect(session.frameMs.p50).toBeGreaterThan(0);
    expect(session.frameMs.p95).toBeGreaterThanOrEqual(session.frameMs.p50);
    expect(session.cpuMs.p50).toBeGreaterThan(0);
    await expect(page.getByTestId('perf-session')).toHaveText(
      `${session.fps.toFixed(0)} qps · ${session.frames} quadros`,
    );
    await expect(page.getByTestId('perf-frame')).toHaveText(
      `${session.frameMs.p50.toFixed(1)} · ${session.frameMs.p95.toFixed(1)} · ${session.frameMs.max.toFixed(1)} ms`,
    );
    await expect(page.getByTestId('perf-cpu')).toHaveText(/^\d+\.\d\d · \d+\.\d\d ms$/);
    await expect(page.getByTestId('stat-presim')).toHaveText(/^\d+(\.\d)? ms$/);
    await expect(page.getByTestId('perf-longest-task')).toHaveText(
      `${measured.simulation.last!.longestTaskMs.toFixed(1)} ms`,
    );
    expect(measured.simulation.last!.longestTaskMs).toBeLessThanOrEqual(
      measured.simulation.last!.cpuTimeMs,
    );
    await expect(page.getByTestId('perf-dice')).toHaveText('3');
    await expect(page.getByTestId('perf-rolls')).toHaveText('1 · 0 · 0');
    await expect(page.getByTestId('perf-gpu')).toHaveText(
      `${measured.render.geometries} · ${measured.render.textures}`,
    );
    expect(measured.render.drawCalls).toBeGreaterThanOrEqual(3);
    expect(measured.render.triangles).toBeGreaterThan(30);
    expect(measured.render.frames).toBeGreaterThanOrEqual(session.frames);
    await expect(page.getByTestId('perf-canvas')).toHaveText(
      `${measured.render.canvas.width}×${measured.render.canvas.height} px · ×${measured.render.canvas.pixelRatio}`,
    );
    // WebGL por software: a qualidade automática fica em `low` e não é ajustada.
    await expect(page.getByTestId('perf-quality')).toHaveText('low · automática');
    await expect(page.getByTestId('perf-quality-drops')).toHaveText('0');
    await expect(page.getByTestId('quality-effective')).toHaveText('low');
    await expect(page.getByTestId('perf-heap')).toHaveText(/^\d+\.\d MB$/);
    expect(errors).toEqual([]);
  });

  test('os botões perdem e restauram o contexto gráfico', async ({ page }) => {
    const errors = await open(page, '?audio=off&effects=off');
    await roll(page, { dice: [{ type: 'd6', values: [5] }] });
    await page.getByTestId('context-lose').click();
    await expect(page.getByTestId('perf-context')).toHaveText('perdido');
    await expect(page.getByTestId('perf-context-count')).toHaveText('1 · 0');
    await expect(page.getByTestId('perf-events')).toHaveText('contexto perdido');
    await page.getByTestId('context-restore').click();
    await expect(page.getByTestId('perf-context')).toHaveText('ativo');
    await expect(page.getByTestId('perf-context-count')).toHaveText('1 · 1');
    await expect(page.getByTestId('perf-events')).toHaveText(
      /^contexto restaurado depois de \d+ ms$/,
    );
    expect(errors).toEqual([]);
  });
});

test('maxFps limita a taxa de quadros sem mudar o resultado', async ({ page }) => {
  const request: RollRequest = { dice: [{ type: 'd6', values: [6, 6] }] };
  const measure = async (
    query: string,
  ): Promise<{ session: FrameSession; maxFps: number | null }> => {
    await open(page, query);
    expect(await roll(page, request)).toMatchObject({ status: 'completed', total: 12 });
    const { render } = await untilIdle(page);
    return { session: render.lastSession!, maxFps: render.maxFps };
  };

  const free = await measure('?audio=off&effects=off');
  const capped = await measure('?audio=off&effects=off&maxFps=15');
  expect(free.maxFps).toBeNull();
  expect(capped.maxFps).toBe(15);
  await expect(page.getByTestId('maxfps-select')).toHaveValue('15');

  // Nunca acima do teto; o intervalo típico é o do teto (66,7 ms).
  expect(capped.session.fps).toBeLessThanOrEqual(15.5);
  expect(capped.session.frameMs.p50).toBeGreaterThan(60);
  // Sem teto, o mesmo navegador desenha mais quadros no mesmo tempo.
  expect(free.session.fps).toBeGreaterThan(capped.session.fps * 1.5);
  expect(free.session.frames).toBeGreaterThan(capped.session.frames);
});

test('maxFps fora da faixa é recusado na criação do motor', async ({ page }) => {
  await page.goto('/?audio=off&maxFps=500');
  await expect(page.getByTestId('roll-status')).toHaveText(
    /^motor indisponível — INVALID_ARGUMENT: maxFps: esperado um número de 10 a 240\.$/,
  );
});

test.describe('painel de física', () => {
  test('os controles mudam a rolagem seguinte e nunca o valor', async ({ page }) => {
    const errors = await open(page, '?audio=off&effects=off');
    const request: RollRequest = { dice: [{ type: 'd20', values: [20, 7] }] };
    const physics = () =>
      page.evaluate(() => (window as unknown as Hooks).__3dados.engine.getPhysics());

    await expect(page.getByTestId('physics-value-gravity')).toHaveText('150');
    await expect(page.getByTestId('physics-gravity')).toHaveValue('150');
    const normal = await roll(page, request);

    await page.getByTestId('physics-gravity').fill('20');
    await expect(page.getByTestId('physics-value-gravity')).toHaveText('20');
    await expect(page.getByTestId('physics-status')).toHaveText(
      'Vale a partir da próxima rolagem.',
    );
    expect((await physics()).gravity).toBe(20);
    await page.getByTestId('physics-restitution').fill('0.9');
    expect((await physics()).restitution).toBe(0.9);

    const floaty = await roll(page, request);
    for (const outcome of [normal, floaty]) {
      expect(outcome).toMatchObject({ status: 'completed', total: 27 });
    }
    if (normal.status !== 'completed' || floaty.status !== 'completed') throw new Error('falhou');
    // Menos gravidade e mais quique: os dados demoram bem mais a parar.
    expect(floaty.durationMs).toBeGreaterThan(normal.durationMs * 1.5);

    await page.getByTestId('physics-reset').click();
    await expect(page.getByTestId('physics-status')).toHaveText('Parâmetros padrão restaurados.');
    await expect(page.getByTestId('physics-value-gravity')).toHaveText('150');
    await expect(page.getByTestId('physics-value-restitution')).toHaveText('0.45');
    expect(await physics()).toMatchObject({ gravity: 150, restitution: 0.45, friction: 0.3 });
    expect(errors).toEqual([]);
  });
});

test.describe('qualidade automática', () => {
  /** Partes internas do renderer: o teste dita a decisão que a medição de quadros tomaria. */
  interface Internals {
    deps: {
      renderer: {
        pendingQuality: { to: RenderQuality; session: FrameSession } | undefined;
        renderer: { shadowMap: { enabled: boolean } };
      };
    };
  }

  test('a troca de nível espera a mesa esvaziar e refaz os recursos', async ({ browser }) => {
    // Tela de alta densidade: a qualidade também limita a densidade de pixels.
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = await open(page, '?audio=off&effects=full&presentation=tray&quality=high');
    await page.evaluate(() => {
      const engine = (window as unknown as Hooks).__3dados.engine;
      const changes: unknown[] = [];
      engine.on('qualityChanged', (change) => changes.push(change));
      Object.assign(window, { __changes: changes });
    });
    const decide = (to: RenderQuality) =>
      page.evaluate((level) => {
        const engine = (window as unknown as Hooks).__3dados.engine as unknown as Internals;
        engine.deps.renderer.pendingQuality = {
          to: level,
          session: {
            frames: 200,
            durationMs: 9000,
            fps: 22,
            frameMs: { p50: 45, p95: 70, max: 95 },
            cpuMs: { p50: 2, p95: 4, max: 9 },
          },
        };
      }, to);
    const snapshot = async () => {
      const { render, effects } = await stats(page);
      const shadows = await page.evaluate(
        () =>
          ((window as unknown as Hooks).__3dados.engine as unknown as Internals).deps.renderer
            .renderer.shadowMap.enabled,
      );
      return {
        quality: render.quality,
        pixelRatio: render.canvas.pixelRatio,
        width: render.canvas.width,
        particleLimit: effects.particleLimit,
        drops: render.qualityDrops,
        shadows,
      };
    };
    const request: RollRequest = {
      dice: [
        { type: 'd20', values: [20], theme: 'safira' },
        { type: 'd6', values: [3, 4], theme: 'prata' },
      ],
    };

    expect(await roll(page, request)).toMatchObject({ status: 'completed', total: 27 });
    const high = await snapshot();
    expect(high).toMatchObject({
      quality: 'high',
      pixelRatio: 2,
      particleLimit: 2000,
      drops: 0,
      shadows: true,
    });

    // Decidido com os dados parados na mesa: nada muda à vista.
    await decide('medium');
    expect(await snapshot()).toEqual(high);

    // A rolagem seguinte esvazia a mesa: é aí que o nível troca.
    expect(await roll(page, request)).toMatchObject({ status: 'completed', total: 27 });
    const medium = await snapshot();
    expect(medium).toMatchObject({
      quality: 'medium',
      pixelRatio: 1.5,
      particleLimit: 1200,
      drops: 1,
      shadows: true,
    });
    expect(medium.width).toBe(high.width * 0.75);
    await expect(page.getByTestId('quality-effective')).toHaveText('medium');

    await decide('low');
    expect(await roll(page, request)).toMatchObject({ status: 'completed', total: 27 });
    const low = await snapshot();
    expect(low).toMatchObject({
      quality: 'low',
      pixelRatio: 1,
      particleLimit: 600,
      drops: 2,
      shadows: false,
    });
    expect(low.width).toBe(high.width / 2);

    expect(
      await page.evaluate(() => (window as unknown as { __changes: unknown[] }).__changes),
    ).toEqual([
      { from: 'high', to: 'medium', fps: 22, frameMs: { p50: 45, p95: 70, max: 95 } },
      { from: 'medium', to: 'low', fps: 22, frameMs: { p50: 45, p95: 70, max: 95 } },
    ]);

    // Os recursos foram refeitos, não acumulados: limpar a mesa volta ao cache de sempre.
    const left = await page.evaluate(() => {
      const engine = (window as unknown as Hooks).__3dados.engine;
      engine.destroy();
      const { geometries, textures } = engine.getStats().render;
      return { geometries, textures };
    });
    expect(left).toEqual({ geometries: 0, textures: 0 });
    expect(errors).toEqual([]);
    await context.close();
  });
});

test('o modo de benchmark roda a bateria e mostra a tabela', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?bench=run&benchRolls=2&benchCases=1d6,5,20-critical&benchNote=teste');
  await expect(page.getByTestId('roll-status')).toHaveText('benchmark concluído', {
    timeout: 100_000,
  });

  const result = (await page.evaluate(() => (window as unknown as Hooks).__3dados.benchmark)) as {
    environment: { gpu: string | null; refreshHz: number; quality: string; note: string };
    cases: {
      id: string;
      dice: number;
      rolls: number;
      failed: number;
      presimMs: { p50: number };
      longestTaskMs: { max: number };
      fps: { p50: number; min: number };
      frameMs: { p50: number; p95: number };
      drawCalls: number;
      particlesPeak: number;
    }[];
  };
  expect(result.environment.note).toBe('teste');
  expect(result.environment.gpu).toMatch(/swiftshader/i);
  expect(result.environment.refreshHz).toBeGreaterThan(1);
  expect(result.cases.map((c) => [c.id, c.dice, c.rolls, c.failed])).toEqual([
    ['1d6', 1, 2, 0],
    ['5', 5, 2, 0],
    ['20-critical', 20, 2, 0],
  ]);
  for (const measured of result.cases) {
    expect(measured.presimMs.p50).toBeGreaterThan(0);
    expect(measured.longestTaskMs.max).toBeGreaterThan(0);
    expect(measured.fps.p50).toBeGreaterThan(0);
    expect(measured.fps.min).toBeLessThanOrEqual(measured.fps.p50);
    expect(measured.frameMs.p95).toBeGreaterThanOrEqual(measured.frameMs.p50);
    expect(measured.drawCalls).toBeGreaterThan(0);
  }
  // Só o caso com efeitos tem partículas.
  expect(result.cases.map((c) => c.particlesPeak > 0)).toEqual([false, false, true]);

  const output = await page.getByTestId('bench-output').inputValue();
  expect(output).toContain('| Caso | Rolagens | Falhas |');
  expect(output).toContain('| 20 mistos com `critical` em todos | 2 | 0 |');
  expect(output).toContain('"cases"');
  await expect(page.getByTestId('bench-copy')).toBeVisible();
  expect(errors).toEqual([]);
});
