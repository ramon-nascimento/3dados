import { expect, test } from '@playwright/test';
import packageJson from '../../package.json' with { type: 'json' };

test.describe('playground', () => {
  test('carrega e mostra a versão da biblioteca', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('3dados');
    await expect(page.getByTestId('engine-version')).toHaveText(packageJson.version);
    await expect(page.getByTestId('stage-empty')).toBeVisible();
    expect(errors).toEqual([]);
  });

  // O motor depende destes recursos; o teste garante que o navegador de teste os oferece.
  for (const id of ['webgl2', 'wasm', 'webaudio', 'crypto']) {
    test(`o ambiente de teste oferece: ${id}`, async ({ page }) => {
      await page.goto('/');

      await expect(page.getByTestId(`diagnostic-${id}`)).toHaveText('disponível');
    });
  }
});
