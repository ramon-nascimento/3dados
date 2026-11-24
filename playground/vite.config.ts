import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Aplicação de demonstração. Consome a biblioteca pelo nome público ("3dados"),
// apontado para o código-fonte para recarregar durante o desenvolvimento.
export default defineConfig({
  root: import.meta.dirname,
  // Os sons do pacote (assets/sounds) são servidos em /sounds/, como uma
  // aplicação faria ao copiar a pasta para o seu servidor.
  publicDir: resolve(import.meta.dirname, '../assets'),
  resolve: {
    alias: {
      '3dados': resolve(import.meta.dirname, '../src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
});
