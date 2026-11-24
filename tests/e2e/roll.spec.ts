import { expect, test, type Page } from '@playwright/test';

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

async function resultValues(page: Page): Promise<number[]> {
  const text = await page.getByTestId('roll-result-values').innerText();
  return text.split(',').map((part) => Number(part.trim()));
}

test.describe('rolagem de d6 no playground', () => {
  test('modo autônomo: rola, desenha os dados e mostra valores válidos', async ({ page }) => {
    const errors = await openPlayground(page);
    const canvas = page.getByTestId('dice-overlay').locator('canvas');
    const empty = await canvas.screenshot();

    await page.getByTestId('roll-count').fill('4');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });

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

    await page.getByTestId('roll-values').fill('6, 1, 3, 4, 2, 5');
    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });

    expect(await resultValues(page)).toEqual([6, 1, 3, 4, 2, 5]);
    await expect(page.getByTestId('roll-total')).toHaveText('21');
    expect(errors).toEqual([]);
  });

  test('valor inexistente no dado falha com mensagem, sem rolar', async ({ page }) => {
    await openPlayground(page);

    await page.getByTestId('roll-values').fill('7');
    await page.getByTestId('roll-button').click();

    await expect(page.getByTestId('roll-status')).toContainText('INVALID_REQUEST');
  });

  test('cancelar interrompe a rolagem e limpar esvazia a mesa', async ({ page }) => {
    await openPlayground(page);
    const canvas = page.getByTestId('dice-overlay').locator('canvas');
    const empty = await canvas.screenshot();

    await page.getByTestId('roll-count').fill('3');
    await page.getByTestId('roll-button').click();
    await page.getByTestId('cancel-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('cancelada (caller)');
    expect((await canvas.screenshot()).equals(empty)).toBe(true);

    await page.getByTestId('roll-button').click();
    await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });
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
