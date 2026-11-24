// Gera src/renderer/default-font-data.ts a partir da fonte em assets/fonts/.
//
// A fonte vai embutida em base64 porque o motor é uma biblioteca: assim ela
// funciona em qualquer bundler, sem configurar URL de assets. O arquivo gerado
// é versionado; rode `node scripts/embed-font.js` só ao trocar a fonte.
/* global URL, console */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const source = 'assets/fonts/atkinson-hyperlegible-next-latin-700-normal.woff2';
const target = 'src/renderer/default-font-data.ts';

const bytes = readFileSync(fileURLToPath(new URL(source, root)));
const base64 = bytes.toString('base64');

const content = `// Arquivo gerado por scripts/embed-font.js. Não edite à mão.
//
// Atkinson Hyperlegible Next, negrito, subconjunto latino.
// Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors.
// Licença SIL Open Font License 1.1: assets/fonts/OFL.txt. Créditos em assets/CREDITS.md.

/** Família registrada pelo motor para a fonte incluída. */
export const DEFAULT_FONT_FAMILY = 'Atkinson Hyperlegible Next';

/** Arquivo woff2 (${bytes.length} bytes), em base64. */
export const DEFAULT_FONT_WOFF2_BASE64 =
  '${base64}';
`;

writeFileSync(fileURLToPath(new URL(target, root)), content);
console.log(`${target}: ${bytes.length} bytes de fonte, ${base64.length} caracteres em base64.`);
