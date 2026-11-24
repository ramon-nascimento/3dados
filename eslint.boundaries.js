// Fronteiras entre módulos, impostas pela regra `no-restricted-imports`.
// Fonte única da verdade: também é exercitada por tests/unit/boundaries.test.ts.

/** Módulos internos de `src/`. */
export const MODULES = [
  'core',
  'customization',
  'physics',
  'renderer',
  'audio',
  'effects',
  'integration',
];

/** Pacotes externos cujo uso é restrito a módulos específicos. */
export const PACKAGES = {
  three: '^three($|/)',
  rapier: '^@dimforge/',
};

/**
 * O que cada módulo pode importar. Tudo que não está listado é proibido.
 * `integration` é a raiz de composição: enxerga todos os módulos, mas não as
 * bibliotecas de render/física diretamente.
 */
export const ALLOWED = {
  core: { modules: [], packages: [] },
  customization: { modules: ['core'], packages: [] },
  physics: { modules: ['core'], packages: ['rapier'] },
  renderer: { modules: ['core', 'customization'], packages: ['three'] },
  audio: { modules: ['core'], packages: [] },
  effects: { modules: ['core'], packages: ['three'] },
  integration: { modules: MODULES.filter((m) => m !== 'integration'), packages: [] },
};

const PLAYGROUND_FROM_SRC = {
  regex: '^\\.{1,2}/(.*/)?playground(/|$)',
  message: 'A biblioteca não pode depender do playground.',
};

function patternsFor(moduleName) {
  const { modules, packages } = ALLOWED[moduleName];
  const forbiddenModules = MODULES.filter((m) => m !== moduleName && !modules.includes(m));
  const patterns = [PLAYGROUND_FROM_SRC];

  if (forbiddenModules.length > 0) {
    patterns.push({
      // Só imports relativos: "three/addons/effects/..." não é o módulo "effects".
      regex: `^\\.{1,2}/(.*/)?(${forbiddenModules.join('|')})(/|$)`,
      message: `O módulo "${moduleName}" só pode importar de: ${modules.join(', ') || 'nenhum outro módulo'}.`,
    });
  }
  for (const [name, regex] of Object.entries(PACKAGES)) {
    if (!packages.includes(name)) {
      patterns.push({ regex, message: `O módulo "${moduleName}" não pode usar "${name}".` });
    }
  }
  return patterns;
}

/**
 * Configuração flat do ESLint com uma entrada por módulo, mais o playground.
 * @type {import('eslint').Linter.Config[]}
 */
export const boundaries = [
  ...MODULES.map((moduleName) => ({
    files: [`src/${moduleName}/**/*.ts`],
    rules: { 'no-restricted-imports': ['error', { patterns: patternsFor(moduleName) }] },
  })),
  {
    // Sem DOM no núcleo: ele precisa rodar em Node, Worker e navegador.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'self'],
    },
  },
  {
    // O playground é um consumidor: só enxerga a API pública (`3dados`).
    files: ['playground/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '(^|/)src/',
              message: 'O playground só pode importar a API pública ("3dados").',
            },
            ...Object.entries(PACKAGES).map(([name, regex]) => ({
              regex,
              message: `O playground não pode usar "${name}" diretamente.`,
            })),
          ],
        },
      ],
    },
  },
];
