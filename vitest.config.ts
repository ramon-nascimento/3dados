import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        // Medições; fora do `npm test`. Rodar com `npm run bench`.
        test: {
          name: 'bench',
          environment: 'node',
          include: ['tests/bench/**/*.test.ts'],
          testTimeout: 600_000,
        },
      },
    ],
  },
});
