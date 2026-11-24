// Benchmark no navegador: abre o playground em modo de benchmark (`?bench=run`),
// espera a bateria terminar e imprime a tabela e o JSON, com o ambiente
// identificado, para docs/BENCHMARKS.md.
//
// Uso: npm run bench:browser
//
// Variáveis de ambiente:
//   BENCH_CHANNEL       canal do Playwright: `msedge` ou `chrome` usam o navegador
//                       instalado. Ausente: o headless shell do Playwright.
//   BENCH_HEADED=1      janela visível. Necessário para usar a GPU de verdade.
//   BENCH_GL            `software` força o WebGL por software (SwiftShader);
//                       ausente com janela visível: a GPU que o navegador escolher.
//   BENCH_CPU_THROTTLE  desaceleração de CPU do DevTools (4 = quatro vezes mais lento).
//                       É uma simulação de máquina fraca, não outra máquina.
//   BENCH_ROLLS         rolagens por caso (padrão: 20).
//   BENCH_CASES         casos, separados por vírgula (padrão: todos).
//   BENCH_QUALITY       `auto` (padrão), `low`, `medium` ou `high`.
//   BENCH_PRESENTATION  `overlay` (padrão) ou `tray`.
//   BENCH_MAX_FPS       teto de quadros por segundo.
//   BENCH_VIEWPORT      tamanho da página, `1920x1080` (padrão: 1280x720).
//   BENCH_ARGS          argumentos extras do navegador, separados por espaço
//                       (`--force_low_power_gpu` pede a GPU integrada em máquinas com duas).
//   BENCH_NOTE          anotação livre que entra no resultado (a máquina, por exemplo).
//   BENCH_OUT           arquivo onde gravar o JSON.
//
// Em outra máquina, sem o Playwright: `npm run dev`, abrir
// http://localhost:5173/?bench=run no navegador e copiar o resultado.

/* global console, process, URLSearchParams */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '..');
const env = process.env;
const headed = env.BENCH_HEADED === '1';
const software = env.BENCH_GL === 'software' || !headed;
const throttle = Number(env.BENCH_CPU_THROTTLE ?? 1);
const [width = 1280, height = 720] = (env.BENCH_VIEWPORT ?? '')
  .split('x')
  .filter(Boolean)
  .map(Number);

const notes = [
  env.BENCH_NOTE,
  throttle > 1 ? `CPU desacelerada ${throttle}× pelo DevTools` : undefined,
  software ? 'WebGL por software (SwiftShader)' : undefined,
].filter(Boolean);

const params = new URLSearchParams({ bench: 'run' });
if (env.BENCH_ROLLS) params.set('benchRolls', env.BENCH_ROLLS);
if (env.BENCH_CASES) params.set('benchCases', env.BENCH_CASES);
if (env.BENCH_QUALITY) params.set('quality', env.BENCH_QUALITY);
if (env.BENCH_PRESENTATION) params.set('presentation', env.BENCH_PRESENTATION);
if (env.BENCH_MAX_FPS) params.set('maxFps', env.BENCH_MAX_FPS);
if (notes.length > 0) params.set('benchNote', notes.join('; '));

const server = await createServer({
  configFile: resolve(root, 'playground/vite.config.ts'),
  server: { port: 5193, strictPort: false },
  logLevel: 'warn',
});
await server.listen();
const address = server.resolvedUrls?.local[0];
if (!address) throw new Error('O servidor do playground não informou o endereço.');

const browser = await chromium.launch({
  headless: !headed,
  ...(env.BENCH_CHANNEL ? { channel: env.BENCH_CHANNEL } : {}),
  args: software
    ? ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader']
    : // Sem isto o navegador reduz a taxa de quadros de janelas que julga escondidas.
      [
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        ...(env.BENCH_ARGS ?? '').split(' ').filter(Boolean),
      ],
});

try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => console.error(`[página] ${error.message}`));
  if (throttle > 1) {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const url = `${address}?${params.toString()}`;
  console.log(`Abrindo ${url}`);
  await page.goto(url);
  const status = page.getByTestId('roll-status');
  let last = '';
  for (;;) {
    const text = (await status.textContent()) ?? '';
    if (text !== last) {
      console.log(`  ${text}`);
      last = text;
    }
    if (text === 'benchmark concluído') break;
    if (/falhou|indisponível/.test(text)) throw new Error(text);
    await page.waitForTimeout(500);
  }
  const output = await page.getByTestId('bench-output').inputValue();
  const [table, json] = output.split('\n\n{');
  console.log(`\n${table}\n`);
  if (env.BENCH_OUT) {
    writeFileSync(resolve(root, env.BENCH_OUT), `{${json}\n`);
    console.log(`JSON gravado em ${env.BENCH_OUT}`);
  }
} finally {
  await browser.close();
  await server.close();
}
