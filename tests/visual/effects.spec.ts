import { expect, test, type Page } from '@playwright/test';
import type { RollOutcome, RollRequest } from '../../src/core/types';

// Capturas de referência dos efeitos. A rolagem tem semente e valores fixos, e
// o relógio da página é parado antes do efeito: as partículas usam uma semente
// própria, então o mesmo instante produz a mesma imagem. Mesmas ressalvas das
// capturas de materiais: referências por sistema operacional, geradas com
// WebGL por software.

test.use({ viewport: { width: 960, height: 600 } });

type Hooks = {
  __3dados: {
    engine: {
      roll(r: unknown): { result: Promise<unknown> };
      effects: { trigger(name: string, options?: unknown): unknown; getStats(): unknown };
    };
  };
};

const SHOWCASE: RollRequest = {
  seed: 12,
  dice: [
    { type: 'd20', values: [20], ids: ['d20'] },
    { type: 'd12', values: [1], ids: ['d12'] },
    { type: 'd6', values: [6], ids: ['d6'] },
  ],
};

/**
 * Rola com o relógio correndo, para o relógio, dispara os efeitos e avança
 * `afterMs` em quadros falsos antes da captura.
 */
async function capture(
  page: Page,
  query: string,
  request: RollRequest,
  effects: { name: string; dieIds?: string[] }[],
  afterMs: number,
  file: string,
) {
  await page.clock.install();
  await page.goto(`/${query}&audio=off`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  const outcome = (await page.evaluate(
    (req) => (window as unknown as Hooks).__3dados.engine.roll(req).result,
    request,
  )) as RollOutcome;
  expect(outcome.status).toBe('completed');
  await page.clock.pauseAt(Date.now() + 60_000);
  await page.evaluate((list) => {
    const { engine } = (window as unknown as Hooks).__3dados;
    for (const { name, dieIds } of list) engine.effects.trigger(name, dieIds ? { dieIds } : {});
  }, effects);
  await page.clock.runFor(afterMs);
  await expect(page.getByTestId('dice-overlay')).toHaveScreenshot(`${file}.png`, {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  });
}

test.describe('capturas de referência dos efeitos', () => {
  test('crítico e falha, nível completo', async ({ page }) => {
    await capture(
      page,
      '?quality=medium&effects=full',
      SHOWCASE,
      [
        { name: 'critical', dieIds: ['d20'] },
        { name: 'failure', dieIds: ['d12'] },
        { name: 'fire', dieIds: ['d6'] },
      ],
      450,
      'critico-falha-completo',
    );
  });

  test('crítico e falha, nível reduzido', async ({ page }) => {
    await capture(
      page,
      '?quality=medium&effects=reduced',
      SHOWCASE,
      [
        { name: 'critical', dieIds: ['d20'] },
        { name: 'failure', dieIds: ['d12'] },
        { name: 'fire', dieIds: ['d6'] },
      ],
      450,
      'critico-falha-reduzido',
    );
  });

  test('aura do tema Medo e brilho da Esperança', async ({ page }) => {
    await capture(
      page,
      '?quality=medium&effects=full',
      {
        seed: 5,
        dice: [
          { type: 'd12', values: [9], theme: 'esperanca', ids: ['hope'] },
          { type: 'd12', values: [4], theme: 'medo', ids: ['fear'] },
        ],
      },
      [
        { name: 'brilho-esperanca', dieIds: ['hope'] },
        { name: 'aura-medo', dieIds: ['fear'] },
      ],
      900,
      'esperanca-medo-efeitos',
    );
  });
});
