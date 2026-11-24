import { expect, test, type Page } from '@playwright/test';

/**
 * Instrumenta a Web Audio da página antes de qualquer script: conta os
 * `AudioContext` criados e guarda quando cada som começa e para, para medir
 * as vozes simultâneas no Chromium real.
 */
async function instrument(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = {
      contexts: 0,
      sources: [] as { start: number; stop?: number; duration: number; rate: number }[],
    };
    (window as unknown as { __audioProbe: typeof probe }).__audioProbe = probe;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        probe.contexts++;
      }
    };
    // Os originais são chamados com `.call(this, ...)` logo abaixo.
    /* eslint-disable @typescript-eslint/unbound-method */
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    /* eslint-enable @typescript-eslint/unbound-method */
    const records = new WeakMap<AudioBufferSourceNode, (typeof probe.sources)[number]>();
    AudioBufferSourceNode.prototype.start = function (when = 0, ...rest: number[]) {
      const record = {
        start: when,
        duration: this.buffer?.duration ?? 0,
        rate: this.playbackRate.value,
      };
      records.set(this, record);
      probe.sources.push(record);
      start.call(this, when, ...rest);
    };
    AudioBufferSourceNode.prototype.stop = function (when = 0) {
      const record = records.get(this);
      if (record) record.stop = when;
      stop.call(this, when);
    };
  });
}

async function open(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await instrument(page);
  await page.goto(`/${query}`);
  await expect(page.getByTestId('roll-status')).toHaveText('pronto');
  return errors;
}

function probe(page: Page) {
  return page.evaluate(() => {
    const { contexts, sources } = (
      window as unknown as {
        __audioProbe: {
          contexts: number;
          sources: { start: number; stop?: number; duration: number; rate: number }[];
        };
      }
    ).__audioProbe;
    const intervals = sources
      .map((s) => ({
        start: s.start,
        end: Math.min(s.start + s.duration / s.rate, s.stop ?? Infinity),
      }))
      .filter((s) => s.end > s.start);
    const maxConcurrent = Math.max(
      0,
      ...intervals.map(
        (a) => intervals.filter((b) => b.start <= a.start && a.start < b.end).length,
      ),
    );
    return { contexts, scheduled: intervals.length, maxConcurrent };
  });
}

function stats(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __3dados: { engine: { audio: { getStats(): Record<string, unknown> } } };
      }
    ).__3dados.engine.audio.getStats(),
  );
}

async function rollAndWait(page: Page): Promise<void> {
  await page.getByTestId('roll-button').click();
  await expect(page.getByTestId('roll-status')).toHaveText('concluída', { timeout: 20_000 });
}

test.describe('áudio no navegador', () => {
  test('com o áudio desligado, nenhum AudioContext é criado', async ({ page }) => {
    const errors = await open(page, '?audio=off');
    await page.getByTestId('count-d6').fill('20');
    await rollAndWait(page);
    await page.getByTestId('audio-impact').first().click();
    await page.getByTestId('audio-play').first().click();
    await page.keyboard.press('Space');
    await page.getByTestId('audio-volume').fill('0.3');
    await expect(page.getByTestId('audio-state')).toHaveText('desligado');
    expect((await probe(page)).contexts).toBe(0);
    expect(errors).toEqual([]);
  });

  test('ligado, o contexto só nasce no primeiro gesto e toca as amostras', async ({ page }) => {
    const errors = await open(page);
    expect((await probe(page)).contexts).toBe(0);
    await expect(page.getByTestId('audio-state')).toHaveText('aguardando um clique na página');

    await rollAndWait(page);
    expect((await probe(page)).contexts).toBe(1);
    await expect(page.getByTestId('audio-state')).toHaveText('tocando');
    await expect(page.getByTestId('audio-source')).toHaveText('amostras (assets/sounds)');
    expect((await probe(page)).scheduled).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('limite de vozes respeitado com 20 dados', async ({ page }) => {
    await open(page);
    await page.getByTestId('count-d6').fill('10');
    await page.getByTestId('count-d20').fill('10');
    for (let i = 0; i < 3; i++) await rollAndWait(page);
    const measured = await probe(page);
    const engineStats = await stats(page);
    expect(engineStats.maxVoices).toBe(16);
    expect(measured.scheduled).toBeGreaterThan(16);
    expect(measured.maxConcurrent).toBeLessThanOrEqual(16);
    console.info(
      `[áudio e2e] 3 rolagens de 20 dados: ${measured.scheduled} sons, pico de ${measured.maxConcurrent} vozes; descartados ${String(engineStats.dropped)}, interrompidos ${String(engineStats.stolen)}`,
    );
  });

  test('painel: impactos de teste e sons especiais tocam; desligar para tudo', async ({ page }) => {
    await open(page);
    await page.getByTestId('audio-profile').selectOption('metal');
    await page.getByTestId('audio-impact').nth(2).click();
    await page.getByTestId('audio-impact-die').click();
    await page.getByTestId('audio-play').first().click();
    await expect(page.getByTestId('audio-scheduled')).toHaveText('3');

    await page.getByTestId('audio-enabled').uncheck();
    await expect(page.getByTestId('audio-state')).toHaveText('desligado');
    const before = (await probe(page)).scheduled;
    await page.getByTestId('audio-impact').first().click();
    await rollAndWait(page);
    expect((await probe(page)).scheduled).toBe(before);
  });
});
