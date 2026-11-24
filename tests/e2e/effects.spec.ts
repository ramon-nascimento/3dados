import { expect, test, type Page } from '@playwright/test';
import type { RollOutcome, RollRequest } from '../../src/core/types';
import type { EffectStats } from '../../src/effects';

async function open(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  return errors;
}

function stats(page: Page): Promise<EffectStats> {
  return page.evaluate(() =>
    (
      window as unknown as { __3dados: { engine: { effects: { getStats(): unknown } } } }
    ).__3dados.engine.effects.getStats(),
  ) as Promise<EffectStats>;
}

function roll(page: Page, request: RollRequest): Promise<RollOutcome> {
  return page.evaluate(
    (req) =>
      (
        window as unknown as {
          __3dados: { engine: { roll(r: unknown): { result: Promise<unknown> } } };
        }
      ).__3dados.engine.roll(req).result,
    request,
  ) as Promise<RollOutcome>;
}

/**
 * Memória de GPU do three (`renderer.info.memory`). Acesso interno, só para
 * este teste: o motor não expõe o renderer.
 */
function gpuMemory(page: Page): Promise<{ geometries: number; textures: number }> {
  return page.evaluate(() => {
    const engine = (window as unknown as { __3dados: { engine: unknown } }).__3dados.engine as {
      deps: {
        renderer: { renderer: { info: { memory: { geometries: number; textures: number } } } };
      };
    };
    const { geometries, textures } = engine.deps.renderer.renderer.info.memory;
    return { geometries, textures };
  });
}

/** Espera todos os efeitos terminarem. */
async function settleEffects(page: Page): Promise<void> {
  await expect.poll(async () => (await stats(page)).active, { timeout: 15_000 }).toBe(0);
}

const CRITICAL: RollRequest['effects'] = [
  { effect: 'critical', on: 'settled', when: { type: 'd20', values: [20] } },
];

test.describe('efeitos no navegador', () => {
  test('gatilho do pedido dispara pelo evento e o painel mostra as medições', async ({ page }) => {
    const errors = await open(page, '?effects=full&audio=off');
    await expect(page.getByTestId('effects-level-effective')).toHaveText('Completo');
    // Pelo formulário: d20 com valor 20 e a regra "d20 = 20 → critical" marcada.
    await page.getByTestId('count-d6').fill('0');
    await page.getByTestId('values-d20').fill('20');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 15_000 });
    const after = await stats(page);
    expect(after.created).toBeGreaterThan(0);
    await expect(page.getByTestId('effects-active')).not.toHaveText('—');
    await settleEffects(page);
    const done = await stats(page);
    expect(done.disposed).toBe(done.created);
    expect(errors).toEqual([]);
  });

  test('disparo por chamada pelos botões do painel', async ({ page }) => {
    await open(page, '?effects=full&audio=off');
    await roll(page, { dice: [{ type: 'd8', count: 2 }] });
    // Os três cliques e a leitura na mesma tarefa da página: a explosão dura 1,2 s,
    // e com a máquina ocupada ela terminava antes de o teste ler o contador.
    const now = await page.evaluate(
      (names) => {
        for (const name of names) {
          document
            .querySelector<HTMLButtonElement>(
              `[data-testid="effects-button"][data-effect="${name}"]`,
            )!
            .click();
        }
        return (
          window as unknown as { __3dados: { engine: { effects: { getStats(): EffectStats } } } }
        ).__3dados.engine.effects.getStats();
      },
      ['highlight', 'burst', 'fire'],
    );
    await expect(page.getByTestId('effects-status')).toHaveText(/disparado/);
    expect(now.active).toBe(3);
    expect(now.objects).toBeGreaterThan(1);
    await page.getByTestId('effects-stop').click();
    const stopped = await stats(page);
    expect(stopped.active).toBe(0);
    expect(stopped.disposed).toBe(stopped.created);
  });

  test('com ?effects=off nada é criado, nem por gatilho, tema ou botão', async ({ page }) => {
    await open(page, '?effects=off&audio=off');
    await expect(page.getByTestId('effects-level-effective')).toHaveText('Desligado');
    await roll(page, {
      dice: [
        { type: 'd20', values: [20] },
        { type: 'd12', theme: 'medo' },
        { type: 'd12', theme: 'esperanca' },
      ],
      effects: [...CRITICAL, { effect: 'trail', on: 'start' }],
    });
    for (const button of await page.locator('[data-testid="effects-button"]').all()) {
      await button.click();
    }
    const result = await stats(page);
    expect(result).toMatchObject({ level: 'off', created: 0, objects: 0, active: 0, particles: 0 });
    expect(result.skipped).toBeGreaterThan(0);
    await expect(page.getByTestId('effects-status')).toHaveText(/desligados/);
  });

  test('prefers-reduced-motion leva o automático ao reduzido, sem partículas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '?audio=off');
    await expect(page.getByTestId('effects-level')).toHaveValue('auto');
    await expect(page.getByTestId('effects-level-effective')).toHaveText('Reduzido');
    await roll(page, { dice: [{ type: 'd20', values: [20] }], effects: CRITICAL });
    await page.locator('[data-testid="effects-button"][data-effect="aura"]').click();
    const reduced = await stats(page);
    expect(reduced.level).toBe('reduced');
    expect(reduced.active).toBe(2);
    expect(reduced.particles).toBe(0);
    // Volta ao completo quando a preferência muda, sem recarregar.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.getByTestId('effects-level-effective')).toHaveText('Completo');
    // Um nível escolhido no painel vale acima da preferência.
    await page.getByTestId('effects-level').selectOption('reduced');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.getByTestId('effects-level-effective')).toHaveText('Reduzido');
  });

  test('20 rolagens com efeitos não deixam geometrias nem texturas na GPU', async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, '?effects=full&audio=off');
    const request: RollRequest = {
      dice: [
        { type: 'd20', values: [20, 20] },
        { type: 'd6', count: 2 },
      ],
      effects: [...CRITICAL, { effect: 'trail', on: 'start' }],
    };
    // Primeira rolagem: aquece os caches do renderer (malhas dos dados).
    await roll(page, request);
    await settleEffects(page);
    const baseline = await gpuMemory(page);
    for (let i = 0; i < 20; i++) {
      const outcome = await roll(page, request);
      expect(outcome.status).toBe('completed');
    }
    // Com os críticos da última rolagem ainda na tela, a GPU tem mais recursos:
    // a medição enxerga os efeitos (o teste não passa por vacuidade).
    const during = await gpuMemory(page);
    expect(during.geometries + during.textures).toBeGreaterThan(
      baseline.geometries + baseline.textures,
    );
    await settleEffects(page);
    // Um quadro a mais para o three registrar o que foi liberado.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(await gpuMemory(page)).toEqual(baseline);
    const final = await stats(page);
    expect(final.created).toBeGreaterThan(0);
    expect(final.disposed).toBe(final.created);
  });
});
