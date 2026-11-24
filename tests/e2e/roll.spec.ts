import { expect, test, type Page } from '@playwright/test';

const DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dF'];

async function openPlayground(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  return errors;
}

/** Zera todas as quantidades e preenche só o que o teste pede. */
async function choose(
  page: Page,
  dice: Record<string, { count?: number; values?: string }>,
): Promise<void> {
  for (const type of DIE_TYPES) {
    await page.getByTestId(`count-${type}`).fill(String(dice[type]?.count ?? 0));
    await page.getByTestId(`values-${type}`).fill(dice[type]?.values ?? '');
  }
}

async function rollAndWait(page: Page): Promise<void> {
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });
}

async function resultValues(page: Page): Promise<number[]> {
  const text = await page.getByTestId('roll-result-values').innerText();
  return text.split(',').map((part) => Number(part.trim()));
}

test.describe('rolagem no playground', () => {
  test('modo autônomo: rola, desenha os dados e mostra valores válidos', async ({ page }) => {
    const errors = await openPlayground(page);
    const canvas = page.getByTestId('dice-overlay').locator('canvas');
    const empty = await canvas.screenshot();

    await choose(page, { d6: { count: 4 } });
    await rollAndWait(page);

    const values = await resultValues(page);
    expect(values).toHaveLength(4);
    expect(values.every((value) => Number.isInteger(value) && value >= 1 && value <= 6)).toBe(true);
    await expect(page.getByTestId('roll-total')).toHaveText(
      String(values.reduce((sum, value) => sum + value, 0)),
    );

    // Medições reais vindas do motor.
    await expect(page.getByTestId('stat-presim')).toHaveText(/^\d+(\.\d)? ms$/);
    await expect(page.getByTestId('stat-attempts')).toHaveText(/^[1-9]\d*$/);
    await expect(page.getByTestId('stat-collisions')).toHaveText(/^[1-9]\d*$/);

    // Os dados ficaram desenhados sobre o fundo.
    expect((await canvas.screenshot()).equals(empty)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('modo controlado: mostra exatamente os valores pedidos', async ({ page }) => {
    const errors = await openPlayground(page);

    await choose(page, { d6: { values: '6, 1, 3, 4, 2, 5' } });
    await rollAndWait(page);

    expect(await resultValues(page)).toEqual([6, 1, 3, 4, 2, 5]);
    await expect(page.getByTestId('roll-total')).toHaveText('21');
    expect(errors).toEqual([]);
  });

  test('todos os poliedros: cada tipo rola e mostra o valor pedido', async ({ page }) => {
    const errors = await openPlayground(page);

    await choose(page, {
      d4: { values: '4' },
      d6: { values: '6' },
      d8: { values: '8' },
      d10: { values: '10' },
      d12: { values: '12' },
      d20: { values: '20' },
      d100: { values: '57' },
    });
    await rollAndWait(page);

    expect(await resultValues(page)).toEqual([4, 6, 8, 10, 12, 20, 57]);
    await expect(page.getByTestId('roll-total')).toHaveText('117');
    await expect(page.getByTestId('roll-result-detail')).toContainText('d100: 57 (50 + 7)');
    expect(errors).toEqual([]);
  });

  test('todos os poliedros em modo autônomo ficam dentro da faixa de cada dado', async ({
    page,
  }) => {
    const errors = await openPlayground(page);
    const max = [4, 6, 8, 10, 12, 20, 100];

    await choose(
      page,
      Object.fromEntries(DIE_TYPES.slice(0, 7).map((type) => [type, { count: 1 }])),
    );
    await rollAndWait(page);

    const values = await resultValues(page);
    expect(values).toHaveLength(7);
    values.forEach((value, i) => {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(max[i]!);
    });
    expect(errors).toEqual([]);
  });

  test('d100: "00" com "0" vale 100', async ({ page }) => {
    await openPlayground(page);

    await choose(page, { d100: { values: '100, 1' } });
    await rollAndWait(page);

    expect(await resultValues(page)).toEqual([100, 1]);
    await expect(page.getByTestId('roll-result-detail')).toHaveText(
      'd100: 100 (00 + 0) · d100: 1 (00 + 1)',
    );
  });

  test('dado personalizado registrado pela aplicação rola com valores repetidos', async ({
    page,
  }) => {
    const errors = await openPlayground(page);

    await choose(page, { dF: { values: '1, 0, -1, -1' } });
    await rollAndWait(page);

    expect(await resultValues(page)).toEqual([1, 0, -1, -1]);
    await expect(page.getByTestId('roll-total')).toHaveText('-1');
    expect(errors).toEqual([]);
  });

  test('valor inexistente no dado falha com mensagem, sem rolar', async ({ page }) => {
    await openPlayground(page);

    await choose(page, { d6: { values: '7' } });
    await page.getByTestId('roll-button').click();

    await expect(page.getByTestId('roll-status')).toContainText('INVALID_REQUEST');
  });

  test('cancelar interrompe a rolagem e limpar esvazia a mesa', async ({ page }) => {
    await openPlayground(page);
    const canvas = page.getByTestId('dice-overlay').locator('canvas');
    const empty = await canvas.screenshot();

    await choose(page, { d6: { count: 3 } });
    // Os dois cliques no mesmo instante: com o navegador sob carga, uma rolagem
    // de um segundo pode terminar antes de um segundo clique separado chegar.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="roll-button"]')?.click();
      document.querySelector<HTMLElement>('[data-testid="cancel-button"]')?.click();
    });
    await expect(page.getByTestId('roll-status')).toHaveText('cancelada (caller)');
    expect((await canvas.screenshot()).equals(empty)).toBe(true);

    await rollAndWait(page);
    await page.getByTestId('clear-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('pronto');
    expect((await canvas.screenshot()).equals(empty)).toBe(true);
  });

  test('o overlay não intercepta cliques destinados ao conteúdo por baixo', async ({ page }) => {
    await openPlayground(page);

    const pointerEvents = await page
      .getByTestId('dice-overlay')
      .locator('canvas')
      .evaluate((canvas) => getComputedStyle(canvas).pointerEvents);

    expect(pointerEvents).toBe('none');
  });
});
