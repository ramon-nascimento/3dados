import { defineConfig, devices } from '@playwright/test';

const PORT = 5183;
const LONG_RUNNING = 'e2e/memory.spec.ts';

const CHROMIUM = {
  ...devices['Desktop Chrome'],
  // Padrão: headless shell do Playwright, com WebGL por software (SwiftShader).
  // PLAYWRIGHT_CHANNEL=chromium troca para o "new headless" (Chrome completo).
  ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
  },
};

export default defineConfig({
  testDir: './tests',
  testMatch: ['e2e/**/*.spec.ts', 'visual/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // O teste de uso prolongado roda sozinho, depois dos demais (projeto abaixo).
      testIgnore: LONG_RUNNING,
      use: CHROMIUM,
    },
    {
      // Minutos de rolagens seguidas, com som e efeitos. Rodando junto com os
      // outros, disputava a CPU com eles e os fazia estourar o tempo.
      name: 'prolongado',
      testMatch: LONG_RUNNING,
      dependencies: ['chromium'],
      use: CHROMIUM,
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
