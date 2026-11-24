import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, query = '?audio=off'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`/${query}`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  // Sem latência: a ordem de entrega fica sob controle do teste.
  await page.getByTestId('remote-latency-min').fill('0');
  await page.getByTestId('remote-latency-max').fill('0');
  return errors;
}

/** Linhas do registro, da mais antiga para a mais nova. */
async function logLines(page: Page): Promise<string[]> {
  const lines = await page.getByTestId('remote-log').locator('li').allTextContents();
  return lines.reverse();
}

/** Valores que as malhas na mesa exibem, lidos pela API pública. */
function tableRoll(page: Page) {
  return page.evaluate(() => {
    const engine = (
      window as unknown as {
        __3dados: { engine: { getState(): { tableRollId: string | null; queue: unknown[] } } };
      }
    ).__3dados.engine;
    return engine.getState();
  });
}

test('o servidor simulado entrega rolagens e o motor as exibe com os valores dele', async ({
  page,
}) => {
  const errors = await open(page);
  await page.getByTestId('remote-send').click();
  await expect(page.getByTestId('remote-log').locator('li').first()).toContainText(
    /#1 roll\.requested srv-1 → aplicada · concluída: \d+, \d+/,
    { timeout: 15_000 },
  );
  expect(await tableRoll(page)).toMatchObject({ tableRollId: 'srv-1' });
  await expect(page.getByTestId('remote-stat-applied')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('fora de ordem, repetida, cancelada antes e sem valores', async ({ page }) => {
  const errors = await open(page);

  // Três pedidos entregues em ordem inversa: só o mais novo aparece.
  await page.getByTestId('remote-burst').click();
  await expect(page.getByTestId('remote-stat-stale')).toHaveText('2');
  expect((await logLines(page)).slice(0, 3)).toEqual([
    '#3 roll.requested srv-3 → aplicada',
    '#2 roll.requested srv-2 → obsoleta (out-of-order)',
    '#1 roll.requested srv-1 → obsoleta (out-of-order)',
  ]);

  // Cancelamento antes do pedido.
  await page.getByTestId('remote-cancel-first').click();
  await expect(page.getByTestId('remote-stat-cancelled')).toHaveText('1');
  // A última mensagem de novo.
  await page.getByTestId('remote-resend').click();
  await expect(page.getByTestId('remote-stat-duplicate')).toHaveText('1');
  // Sem valores: recusada.
  await page.getByTestId('remote-invalid').click();
  await expect(page.getByTestId('remote-stat-rejected')).toHaveText('1');

  const lines = await logLines(page);
  expect(lines.slice(3)).toEqual([
    '#5 roll.cancelled srv-4 → aplicada (awaiting-request)',
    '#4 roll.requested srv-4 → cancelada (cancelled-before-request)',
    '#4 roll.requested srv-4 → repetida (same-sequence)',
    '#6 roll.requested srv-5 → recusada (invalid-message) — INVALID_MESSAGE',
  ]);
  await expect(
    page.getByTestId('remote-log').locator('li', { hasText: '#3 roll.requested srv-3' }),
  ).toContainText(/srv-3 → aplicada · concluída: \d+, \d+/, { timeout: 15_000 });
  expect(await tableRoll(page)).toMatchObject({ tableRollId: 'srv-3' });
  expect(errors).toEqual([]);
});

test('com a fila, a segunda rolagem espera; limpar a mesa cancela as duas', async ({ page }) => {
  const errors = await open(page);
  await page.getByTestId('remote-send').click();
  await page.getByTestId('remote-send').click();
  await expect(page.getByTestId('remote-queue')).toHaveText('srv-2');
  await page.getByTestId('remote-clear').click();
  await expect(page.getByTestId('remote-log').locator('li').nth(1)).toContainText(
    'srv-2 → aplicada · cancelada (cleared)',
  );
  await expect(page.getByTestId('remote-queue')).toHaveText('—');
  await expect(page.getByTestId('remote-table')).toHaveText('—');
  expect(errors).toEqual([]);
});

test('`concurrency=replace`: a rolagem nova substitui a anterior', async ({ page }) => {
  const errors = await open(page, '?audio=off&concurrency=replace');
  await expect(page.getByTestId('concurrency-select')).toHaveValue('replace');
  // Os dois cliques no mesmo instante: sob carga, dois cliques do Playwright podem
  // ficar mais longe um do outro que a animação inteira.
  await page.evaluate(() => {
    const send = document.querySelector<HTMLButtonElement>('[data-testid="remote-send"]')!;
    send.click();
    send.click();
  });
  await expect(page.getByTestId('remote-log').locator('li').nth(1)).toContainText(
    'srv-1 → aplicada · cancelada (superseded)',
  );
  await expect(page.getByTestId('remote-queue')).toHaveText('—');
  expect(errors).toEqual([]);
});
