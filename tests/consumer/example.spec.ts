import { expect, test } from '@playwright/test';

// Roda contra cada exemplo compilado fora do repositório (playwright.consumer.config.ts).
test('o exemplo carrega o motor, rola e recebe uma mensagem do servidor', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    // O WebGL por software (SwiftShader) avisa de leituras lentas de pixels: é do
    // ambiente de teste, não do pacote.
    if (message.text().includes('GL Driver Message')) return;
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  const sounds: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/sounds/')) sounds.push(response.status());
  });

  await page.goto('/');
  const resultado = page.locator('#resultado');
  await expect(resultado).toHaveText('pronto', { timeout: 30_000 });

  await page.locator('#rolar').click();
  await expect(resultado).toHaveText(/: \d, \d \(total \d+\)$/, { timeout: 15_000 });

  await page.locator('#servidor').click();
  await expect(resultado).toHaveText('servidor-1: 17 (total 17)', { timeout: 15_000 });

  // O motor baixou os sons do pacote pela URL que o exemplo informou.
  expect(sounds.length).toBeGreaterThan(0);
  expect(sounds.every((status) => status === 200)).toBe(true);
  expect(problems).toEqual([]);
});
