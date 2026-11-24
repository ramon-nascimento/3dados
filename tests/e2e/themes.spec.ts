import { expect, test, type Page } from '@playwright/test';
import { COMPOSITE_PART_DICE, STANDARD_DICE } from '../../src/core/dice/standard';
import { FLAT_ALIGNMENT_MIN, readFace } from '../../src/core/face-reading';
import type { Quat, Vec3 } from '../../src/core/math';
import type { RollOutcome, RollRequest } from '../../src/core/types';

const DEFINITIONS = new Map(
  [...STANDARD_DICE, ...COMPOSITE_PART_DICE].map((die) => [die.type, die]),
);
/** Temas de exemplo do playground, um por material. */
const MATERIAL_THEMES = ['rubi', 'carvalho', 'ardosia', 'prata', 'safira', 'ametista'];

interface TableDie {
  dieId: string;
  type: string;
  position: Vec3;
  rotation: Quat;
}

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

/** Rola pelo motor da página e devolve o desfecho e a cena lida das malhas. */
async function rollInPage(page: Page, request: RollRequest) {
  return page.evaluate(async (req) => {
    const hooks = (
      window as unknown as {
        __3dados: {
          engine: {
            roll(r: unknown): { result: Promise<unknown> };
            getDiceOnTable(): unknown;
          };
        };
      }
    ).__3dados;
    const outcome = await hooks.engine.roll(req).result;
    return { outcome, table: hooks.engine.getDiceOnTable() };
  }, request) as Promise<{ outcome: RollOutcome; table: TableDie[] }>;
}

/** Valor que cada malha exibe, calculado aqui a partir da orientação real. */
function displayed(table: TableDie[]): Record<string, number> {
  return Object.fromEntries(
    table.map((die) => {
      const reading = readFace(DEFINITIONS.get(die.type)!, die.rotation);
      expect(reading.alignment).toBeGreaterThanOrEqual(FLAT_ALIGNMENT_MIN);
      return [die.dieId, reading.face.value];
    }),
  );
}

test.describe('temas no navegador', () => {
  test('a fonte incluída é carregada e a qualidade automática detecta WebGL por software', async ({
    page,
  }) => {
    const errors = await open(page);
    const loaded = await page.evaluate(() =>
      document.fonts.check('700 32px "Atkinson Hyperlegible Next"'),
    );
    expect(loaded).toBe(true);
    // Os testes rodam com SwiftShader: `auto` escolhe `low`.
    await expect(page.getByTestId('quality-effective')).toHaveText('low');
    expect(errors).toEqual([]);
  });

  test('qualidade e apresentação vêm das opções de criação', async ({ page }) => {
    const errors = await open(page, '?presentation=tray&quality=high');
    await expect(page.getByTestId('quality-effective')).toHaveText('high');
    await expect(page.getByTestId('presentation-select')).toHaveValue('tray');
    const { outcome } = await rollInPage(page, {
      dice: [{ type: 'd20', values: [20], theme: 'safira' }],
      seed: 4,
    });
    expect(outcome.status).toBe('completed');
    expect(errors).toEqual([]);
  });

  test('o mesmo pedido exibe os mesmos valores com qualquer material', async ({ page }) => {
    const errors = await open(page);
    const dice = [
      { type: 'd6', values: [6, 1] },
      { type: 'd12', values: [12] },
      { type: 'd20', values: [20, 7] },
      { type: 'd100', values: [42] },
    ];
    const results: unknown[] = [];
    for (const theme of ['', ...MATERIAL_THEMES]) {
      const request = {
        seed: 31,
        dice: dice.map((spec, i) => ({
          ...spec,
          ids: spec.values.map((_, j) => `g${i}-${j}`),
          ...(theme ? { theme } : {}),
        })),
      };
      const { outcome, table } = await rollInPage(page, request);
      expect(outcome.status, theme).toBe('completed');
      if (outcome.status !== 'completed') continue;
      results.push({
        values: outcome.dice.map((die) => [die.dieId, die.value, die.faceId]),
        shown: displayed(table),
      });
    }
    expect(results).toHaveLength(MATERIAL_THEMES.length + 1);
    for (const result of results) expect(result).toEqual(results[0]);
    expect(errors).toEqual([]);
  });

  test('Esperança e Medo: dois d12 com temas e papéis distintos', async ({ page }) => {
    const errors = await open(page);
    await page.getByTestId('duality-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });
    await expect(page.getByTestId('roll-result-detail')).toHaveText(
      /^hope d12: \d+ · fear d12: \d+$/,
    );
    expect(errors).toEqual([]);
  });

  test('editar o tema redesenha os dados na mesa sem mudar o que exibem', async ({ page }) => {
    const errors = await open(page);
    const before = await rollInPage(page, {
      dice: [{ type: 'd20', values: [13], theme: 'esperanca', ids: ['h'] }],
      seed: 9,
    });
    const canvas = page.getByTestId('dice-overlay').locator('canvas');
    const shotBefore = await canvas.screenshot();

    await page.getByTestId('theme-select').selectOption('esperanca');
    await page.getByTestId('theme-material').selectOption('stone');
    await expect(page.getByTestId('theme-status')).toHaveText(
      '"Esperança (Daggerheart)" aplicado.',
    );
    await expect(page.getByTestId('theme-json')).toHaveValue(/"material": "stone"/);
    // O redesenho espera a fonte; dá um instante para o quadro novo.
    await expect.poll(async () => (await canvas.screenshot()).equals(shotBefore)).toBe(false);

    const after = (await page.evaluate(() =>
      (
        window as unknown as { __3dados: { engine: { getDiceOnTable(): unknown } } }
      ).__3dados.engine.getDiceOnTable(),
    )) as TableDie[];
    expect(after).toEqual(before.table);
    expect(displayed(after)).toEqual({ h: 13 });
    expect(errors).toEqual([]);
  });

  test('tema inválido é recusado com a mensagem do validador', async ({ page }) => {
    const errors = await open(page);
    await page.getByTestId('theme-json').fill('{"schemaVersion": 1, "id": "x", "name": "X"}');
    await page.getByTestId('theme-load-json').click();
    await expect(page.getByTestId('theme-status')).toHaveText(
      'Tema inválido: material: esperado um destes valores: plastic, wood, stone, metal, glass, crystal.',
    );
    await expect(page.getByTestId('theme-status')).toHaveAttribute('data-state', 'bad');

    await page.getByTestId('theme-json').fill('{"schemaVersion": 7}');
    await page.getByTestId('theme-load-json').click();
    await expect(page.getByTestId('theme-status')).toContainText('versão 7 é mais nova');
    expect(errors).toEqual([]);
  });

  test('salvar, recarregar e excluir um tema do usuário', async ({ page }) => {
    const errors = await open(page);
    await page.getByTestId('theme-select').selectOption('rubi');
    await page.getByTestId('theme-id').fill('meu-tema');
    await page.getByTestId('theme-name').fill('Meu tema');
    await page.getByTestId('theme-texture').selectOption('marble');
    await page.getByTestId('theme-save').click();
    await expect(page.getByTestId('theme-status')).toHaveText('"Meu tema" salvo neste navegador.');

    await page.reload();
    await expect(page.getByTestId('roll-status')).toHaveText('pronto');
    await page.getByTestId('theme-select').selectOption('meu-tema');
    await expect(page.getByTestId('theme-texture')).toHaveValue('marble');
    await expect(page.getByTestId('theme-json')).toHaveValue(/"id": "meu-tema"/);
    // O tema salvo também pode ser usado na rolagem.
    await page.getByTestId('roll-theme').selectOption('meu-tema');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });

    await page.getByTestId('theme-delete').click();
    await expect(page.getByTestId('theme-status')).toHaveText(
      'Tema "meu-tema" excluído deste navegador.',
    );
    await page.reload();
    await expect(page.getByTestId('roll-status')).toHaveText('pronto');
    await expect(page.getByTestId('theme-select').locator('option[value="meu-tema"]')).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
  });
});
