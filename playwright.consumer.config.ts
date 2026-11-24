import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Usado por `npm run test:consumer` (scripts/test-consumer.js), depois de os
// exemplos serem instalados e compilados fora do repositório.
const work = join(tmpdir(), '3dados-consumer');
const EXAMPLES = [
  { name: 'javascript', port: 5191 },
  { name: 'typescript', port: 5192 },
];

export default defineConfig({
  testDir: './tests/consumer',
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: EXAMPLES.map(({ name, port }) => ({
    name,
    use: {
      ...devices['Desktop Chrome'],
      baseURL: `http://localhost:${port}`,
      launchOptions: {
        args: ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
      },
    },
  })),
  webServer: EXAMPLES.map(({ name, port }) => ({
    command: `npx vite preview --port ${port} --strictPort`,
    cwd: join(work, name),
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  })),
});
