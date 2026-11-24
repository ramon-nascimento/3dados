import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Build da biblioteca. O playground tem configuração própria em playground/vite.config.ts.
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rolldownOptions: {
      // Dependências de runtime não são embutidas: o bundler do consumidor as resolve e deduplica.
      external: ['three', /^three\//, '@dimforge/rapier3d-compat'],
    },
  },
});
