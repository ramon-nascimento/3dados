import { expect, test, type Page } from '@playwright/test';
import type { RollOutcome, RollRequest } from '../../src/core/types';

// Capturas de referência, uma por material, com semente e valores fixos: a
// física é determinística, então a cena final é sempre a mesma na mesma
// máquina. As referências são por sistema operacional e foram geradas com
// WebGL por software (SwiftShader): mostram a aparência relativa dos materiais,
// não o que uma GPU real desenha. Atualizar com `npx playwright test tests/visual
// --update-snapshots` depois de uma mudança visual intencional, conferindo as imagens.

test.use({ viewport: { width: 960, height: 600 } });

/** Um dado de cada formato que mais aparece, com valores fixos. */
function showcase(theme: string): RollRequest {
  return {
    seed: 12,
    dice: [
      { type: 'd20', values: [20], theme, ids: ['d20'] },
      { type: 'd12', values: [12], theme, ids: ['d12'] },
      { type: 'd10', values: [7], theme, ids: ['d10'] },
      { type: 'd8', values: [8], theme, ids: ['d8'] },
      { type: 'd6', values: [6], theme, ids: ['d6'] },
      { type: 'd4', values: [4], theme, ids: ['d4'] },
    ],
  };
}

async function capture(page: Page, query: string, request: RollRequest, name: string) {
  await page.goto(`/${query}`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  const outcome = (await page.evaluate(async (req) => {
    const engine = (
      window as unknown as {
        __3dados: { engine: { roll(r: unknown): { result: Promise<unknown> } } };
      }
    ).__3dados.engine;
    return engine.roll(req).result;
  }, request)) as RollOutcome;
  expect(outcome.status).toBe('completed');
  await expect(page.getByTestId('dice-overlay')).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    maxDiffPixelRatio: 0.01,
  });
}

const MATERIALS = [
  ['default', 'padrao'],
  ['rubi', 'plastico'],
  ['carvalho', 'madeira'],
  ['ardosia', 'pedra'],
  ['prata', 'metal'],
  ['safira', 'vidro'],
  ['ametista', 'cristal'],
] as const;

test.describe('capturas de referência por material', () => {
  for (const [theme, name] of MATERIALS) {
    test(`${name} (overlay, qualidade média)`, async ({ page }) => {
      await capture(page, '?quality=medium', showcase(theme), `${name}-overlay-medio`);
    });
  }

  // Vidro e cristal só usam transmissão na bandeja com qualidade alta.
  for (const [theme, name] of MATERIALS.filter(([, n]) => n === 'vidro' || n === 'cristal')) {
    test(`${name} (bandeja, qualidade alta)`, async ({ page }) => {
      await capture(
        page,
        '?presentation=tray&quality=high',
        showcase(theme),
        `${name}-bandeja-alto`,
      );
    });
  }

  test('Esperança e Medo lado a lado', async ({ page }) => {
    await capture(
      page,
      '?quality=medium',
      {
        seed: 5,
        dice: [
          { type: 'd12', values: [12], theme: 'esperanca', role: 'hope', ids: ['hope'] },
          { type: 'd12', values: [12], theme: 'medo', role: 'fear', ids: ['fear'] },
        ],
      },
      'esperanca-medo',
    );
  });
});
