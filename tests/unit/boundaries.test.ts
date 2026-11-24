import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { ALLOWED, MODULES, boundaries } from '../../eslint.boundaries.js';

type ModuleName = keyof typeof ALLOWED;

// Mesmas regras de fronteira do eslint.config.js, sem as regras que exigem tipos,
// para poder analisar trechos de código que não existem em disco.
const eslint = new ESLint({
  cwd: resolve(import.meta.dirname, '../..'),
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...boundaries,
  ],
});

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  if (!result) throw new Error(`ESLint não analisou ${filePath}`);
  const fatal = result.messages.find((message) => message.fatal);
  if (fatal) throw new Error(`Erro de análise em ${filePath}: ${fatal.message}`);
  return result.messages.map((message) => message.ruleId ?? 'desconhecida');
}

const moduleNames = MODULES as ModuleName[];
const modulePairs = moduleNames.flatMap((from) =>
  moduleNames.filter((to) => to !== from).map((to) => ({ from, to })),
);

describe('fronteiras entre módulos', () => {
  it.each(modulePairs)('$from → $to segue a tabela de dependências', async ({ from, to }) => {
    const found = await violations(`src/${from}/probe.ts`, `import '../${to}/index';`);
    const allowed = (ALLOWED[from].modules as string[]).includes(to);

    expect(found).toEqual(allowed ? [] : ['no-restricted-imports']);
  });

  it.each(moduleNames)('%s pode importar arquivos do próprio módulo', async (name) => {
    expect(await violations(`src/${name}/probe.ts`, `import './sibling';`)).toEqual([]);
  });

  it.each([
    { module: 'core', specifier: 'three', allowed: false },
    { module: 'core', specifier: '@dimforge/rapier3d-compat', allowed: false },
    { module: 'physics', specifier: '@dimforge/rapier3d-compat', allowed: true },
    { module: 'physics', specifier: 'three', allowed: false },
    { module: 'physics', specifier: 'three/addons/math/ConvexHull.js', allowed: false },
    { module: 'renderer', specifier: 'three', allowed: true },
    {
      module: 'renderer',
      specifier: 'three/addons/environments/RoomEnvironment.js',
      allowed: true,
    },
    { module: 'renderer', specifier: 'three/addons/effects/OutlineEffect.js', allowed: true },
    { module: 'renderer', specifier: '@dimforge/rapier3d-compat', allowed: false },
    { module: 'effects', specifier: 'three', allowed: true },
    { module: 'audio', specifier: 'three', allowed: false },
    { module: 'customization', specifier: 'three', allowed: false },
    { module: 'integration', specifier: 'three', allowed: false },
    { module: 'integration', specifier: '@dimforge/rapier3d-compat', allowed: false },
  ])('$module importando "$specifier": permitido = $allowed', async (testCase) => {
    const found = await violations(
      `src/${testCase.module}/probe.ts`,
      `import '${testCase.specifier}';`,
    );

    expect(found).toEqual(testCase.allowed ? [] : ['no-restricted-imports']);
  });

  it('a biblioteca não pode importar do playground', async () => {
    const found = await violations(
      'src/integration/probe.ts',
      `import '../../playground/src/main';`,
    );

    expect(found).toEqual(['no-restricted-imports']);
  });

  it('o núcleo não pode usar globais de DOM', async () => {
    const found = await violations('src/core/probe.ts', `export const title = document.title;`);

    expect(found).toEqual(['no-restricted-globals']);
  });

  it('o playground só enxerga a API pública', async () => {
    const file = 'playground/src/probe.ts';

    expect(await violations(file, `import { VERSION } from '3dados';`)).toEqual([]);
    expect(await violations(file, `import '../../src/core/random';`)).toEqual([
      'no-restricted-imports',
    ]);
    expect(await violations(file, `import '../../src/index';`)).toEqual(['no-restricted-imports']);
    expect(await violations(file, `import 'three';`)).toEqual(['no-restricted-imports']);
  });
});
