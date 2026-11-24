import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { boundaries } from './eslint.boundaries.js';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'playground/dist/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      // Projetos externos: validados por `npm run test:consumer`, com o pacote instalado.
      'examples/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },
  ...boundaries,
);
