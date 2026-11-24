// Teste de consumo externo: empacota a biblioteca como iria para o npm e a
// instala em cópias dos exemplos fora do repositório, onde nada do projeto
// (node_modules, aliases, tsconfig) ajuda a resolver o pacote. Depois compila
// cada exemplo com o bundler do consumidor e abre o resultado no navegador.
//
// Uso: npm run test:consumer
// As dependências (three, Rapier, Vite, TypeScript) vêm do registro do npm, ou
// do cache local quando já estão lá (--prefer-offline).

/* global console, process */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const work = join(tmpdir(), '3dados-consumer');
const examples = ['javascript', 'typescript'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  console.log(`\n$ ${command} ${args.join(' ')}   (${cwd})`);
  // Com shell no Windows, por causa do npm.cmd.
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Falhou: ${command} ${args.join(' ')} (código ${result.status})`);
  }
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. O pacote, exatamente como seria publicado.
run(npm, ['run', 'build'], root);
const packed = JSON.parse(
  execFileSync(npm, ['pack', '--json', '--pack-destination', work], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }),
);
const tarball = join(work, packed[0].filename);
console.log(`\nPacote: ${tarball} (${packed[0].files.length} arquivos, ${packed[0].size} bytes)`);

for (const name of examples) {
  const source = join(root, 'examples', name);
  const target = join(work, name);
  // 2. Cópia do exemplo, sem nada instalado ou compilado.
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !/[\\/](node_modules|dist)([\\/]|$)/.test(path.slice(source.length)),
  });
  const manifestPath = join(target, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.dependencies['3dados'] = `file:${tarball.replaceAll('\\', '/')}`;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // 3. Instalação e build com o bundler do consumidor (no TypeScript, antes, o tsc).
  run(npm, ['install', '--prefer-offline', '--no-audit', '--no-fund'], target);
  run(npm, ['run', 'build'], target);

  // 4. O Rapier precisa continuar num pedaço separado, carregado sob demanda.
  const assets = join(target, 'dist', 'assets');
  const chunks = readdirSync(assets).filter((file) => file.endsWith('.js'));
  // O Rapier traz o WASM embutido em base64: é o único pedaço com mais de 2 MB.
  const withRapier = chunks.filter((file) => statSync(join(assets, file)).size > 2_000_000);
  const entry = readFileSync(join(target, 'dist', 'index.html'), 'utf8').match(
    /<script[^>]+src="\/assets\/([^"]+\.js)"/,
  )?.[1];
  if (!entry || withRapier.length !== 1 || withRapier[0] === entry) {
    throw new Error(
      `${name}: esperado o Rapier em um pedaço separado do de entrada (entrada: ${entry}; com Rapier: ${withRapier.join(', ') || 'nenhum'}).`,
    );
  }
  if (!existsSync(join(target, 'dist', 'sounds', 'bell.wav'))) {
    throw new Error(`${name}: os sons do pacote não foram copiados para dist/sounds/.`);
  }
  console.log(
    `${name}: entrada ${entry}; Rapier em ${withRapier[0]} (${chunks.length} pedaços JS).`,
  );
}

// 5. Cada exemplo compilado, servido e usado no navegador.
run(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', '-c', 'playwright.consumer.config.ts'],
  root,
);
console.log('\nConsumo externo: ok.');
