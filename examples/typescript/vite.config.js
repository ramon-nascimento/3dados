import { defineConfig } from 'vite';

export default defineConfig({
  // Os sons do pacote ficam em node_modules/3dados/assets/sounds/. Servir a pasta
  // assets/ como pública os deixa em /sounds/, a URL informada em `audio.baseUrl`.
  publicDir: 'node_modules/3dados/assets',
});
