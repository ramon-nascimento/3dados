import { describe, expect, it } from 'vitest';
import { DiceError } from '../../src/core/errors';
import {
  DEFAULT_THEME,
  MATERIAL_PRESETS,
  MATERIALS,
  THEME_SCHEMA_VERSION,
  materialPhysics,
  migrateTheme,
  parseTheme,
  resolveAppearance,
  serializeTheme,
  type ThemeConfig,
  type ThemeMigration,
} from '../../src/customization';

/** Tema com todos os campos preenchidos. */
function fullTheme(material: ThemeConfig['material']): ThemeConfig {
  return {
    schemaVersion: 1,
    id: `full-${material}`,
    name: `Completo (${material})`,
    material,
    colors: { primary: '#123456', secondary: '#abcdef', numbers: '#ffffff' },
    font: '"Atkinson Hyperlegible Next", Georgia, serif',
    texture: 'marble',
    opacity: 0.8,
    roughness: 0.25,
    metalness: 0.4,
    emissive: { color: '#ff8800', intensity: 1.5, target: 'body' },
    bevel: 0.04,
    effects: ['glow', 'trail'],
    soundProfile: 'custom-profile',
  };
}

function expectInvalid(input: unknown, message: string | RegExp): void {
  let caught: unknown;
  try {
    parseTheme(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DiceError);
  expect((caught as DiceError).code).toBe('INVALID_THEME');
  expect((caught as DiceError).message).toMatch(message);
}

describe('serialização de temas', () => {
  it.each(MATERIALS)('ida e volta sem perda, com todos os campos (%s)', (material) => {
    const theme = fullTheme(material);
    const json = serializeTheme(theme);
    expect(parseTheme(json)).toEqual(theme);
    // O JSON é canônico: serializar de novo dá exatamente o mesmo texto.
    expect(serializeTheme(parseTheme(json))).toBe(json);
  });

  it.each(MATERIALS)('ida e volta sem perda, só com os campos obrigatórios (%s)', (material) => {
    const theme: ThemeConfig = {
      schemaVersion: 1,
      id: `min-${material}`,
      name: 'Mínimo',
      material,
      colors: { primary: '#000000', secondary: '#111111', numbers: '#eeeeee' },
    };
    const back = parseTheme(serializeTheme(theme));
    expect(back).toEqual(theme);
    // Campos opcionais ausentes não reaparecem preenchidos com padrões.
    expect(Object.keys(back)).toEqual(['schemaVersion', 'id', 'name', 'material', 'colors']);
  });

  it('o tema padrão é válido e sobrevive à ida e volta', () => {
    expect(parseTheme(serializeTheme(DEFAULT_THEME))).toEqual(DEFAULT_THEME);
  });

  it('aceita o texto JSON e o objeto, e devolve uma cópia', () => {
    const theme = fullTheme('wood');
    const parsed = parseTheme(theme);
    expect(parsed).toEqual(theme);
    expect(parsed).not.toBe(theme);
    expect(parsed.colors).not.toBe(theme.colors);
    expect(parsed.effects).not.toBe(theme.effects);
  });

  it('normaliza as cores para minúsculas e a ordem dos campos', () => {
    const shuffled = {
      colors: { numbers: '#FFFFFF', primary: '#A0B0C0', secondary: '#0A0B0C' },
      material: 'stone',
      name: 'Embaralhado',
      id: 'shuffled',
      schemaVersion: 1,
    };
    const json = serializeTheme(shuffled as ThemeConfig);
    expect(json.indexOf('"schemaVersion"')).toBeLessThan(json.indexOf('"id"'));
    expect(parseTheme(json).colors).toEqual({
      primary: '#a0b0c0',
      secondary: '#0a0b0c',
      numbers: '#ffffff',
    });
  });

  it('serializeTheme recusa um tema inválido', () => {
    expect(() => serializeTheme({ ...fullTheme('glass'), opacity: 2 })).toThrow(
      /opacity: esperado um número entre 0 e 1/,
    );
  });
});

describe('rejeição de temas inválidos', () => {
  const base = fullTheme('plastic');
  const without = (key: keyof ThemeConfig) => {
    const copy: Record<string, unknown> = { ...base };
    delete copy[key];
    return copy;
  };

  it.each<[string, unknown, RegExp]>([
    ['texto que não é JSON', '{ id: ', /não é JSON válido/],
    ['null', null, /esperado um objeto/],
    ['lista', [], /esperado um objeto/],
    ['sem versão', without('schemaVersion'), /schemaVersion: campo obrigatório/],
    ['versão zero', { ...base, schemaVersion: 0 }, /schemaVersion: esperado um inteiro/],
    ['versão fracionária', { ...base, schemaVersion: 1.5 }, /schemaVersion: esperado um inteiro/],
    ['versão em texto', { ...base, schemaVersion: '1' }, /schemaVersion: esperado um inteiro/],
    ['versão futura', { ...base, schemaVersion: 99 }, /versão 99 é mais nova que a suportada/],
    ['campo desconhecido', { ...base, colour: '#ffffff' }, /colour: campo desconhecido/],
    ['sem id', without('id'), /^Tema inválido: id: esperado um texto não vazio/],
    ['id com espaço', { ...base, id: 'meu tema' }, /id: contém caracteres não permitidos/],
    ['id longo', { ...base, id: 'a'.repeat(65) }, /id: no máximo 64 caracteres/],
    ['nome vazio', { ...base, name: '  ' }, /name: esperado um texto não vazio/],
    ['material desconhecido', { ...base, material: 'gold' }, /material: esperado um destes/],
    ['sem cores', without('colors'), /colors: esperado um objeto/],
    [
      'cor curta',
      { ...base, colors: { ...base.colors, primary: '#fff' } },
      /colors\.primary: esperada uma cor no formato "#rrggbb"/,
    ],
    [
      'cor por nome',
      { ...base, colors: { ...base.colors, numbers: 'white' } },
      /colors\.numbers: esperada uma cor/,
    ],
    [
      'cor faltando',
      { ...base, colors: { primary: '#000000', numbers: '#ffffff' } },
      /colors\.secondary: esperada uma cor/,
    ],
    [
      'campo desconhecido em cores',
      { ...base, colors: { ...base.colors, accent: '#000000' } },
      /colors\.accent: campo desconhecido/,
    ],
    ['fonte com declaração CSS', { ...base, font: 'Arial; color: red' }, /font: contém/],
    ['textura desconhecida', { ...base, texture: 'plaid' }, /texture: esperado um destes/],
    ['opacidade acima de 1', { ...base, opacity: 1.2 }, /opacity: esperado um número entre 0 e 1/],
    ['rugosidade negativa', { ...base, roughness: -0.1 }, /roughness: esperado um número entre/],
    ['metalicidade NaN', { ...base, metalness: Number.NaN }, /metalness: esperado um número\./],
    ['metalicidade em texto', { ...base, metalness: '1' }, /metalness: esperado um número\./],
    ['emissão sem cor', { ...base, emissive: { intensity: 1 } }, /emissive\.color: esperada/],
    [
      'emissão intensa demais',
      { ...base, emissive: { color: '#ffffff', intensity: 5 } },
      /emissive\.intensity: esperado um número entre 0 e 4/,
    ],
    [
      'alvo da emissão desconhecido',
      { ...base, emissive: { color: '#ffffff', intensity: 1, target: 'edges' } },
      /emissive\.target: esperado um destes valores: numbers, body/,
    ],
    ['chanfro grande demais', { ...base, bevel: 0.5 }, /bevel: esperado um número entre 0 e 0.12/],
    ['efeitos que não são lista', { ...base, effects: 'glow' }, /effects: esperada uma lista/],
    ['efeito vazio', { ...base, effects: ['glow', ''] }, /effects\[1\]: esperado um texto/],
    ['efeitos demais', { ...base, effects: Array(17).fill('x') }, /effects: no máximo 16 itens/],
    ['perfil sonoro vazio', { ...base, soundProfile: '' }, /soundProfile: esperado um texto/],
  ])('%s', (_, input, message) => {
    expectInvalid(input, message);
  });

  it('o erro traz o caminho do campo em `details`', () => {
    try {
      parseTheme({ ...base, colors: { ...base.colors, primary: 'red' } });
      expect.unreachable();
    } catch (error) {
      expect((error as DiceError).details).toEqual({ path: 'colors.primary', received: '"red"' });
    }
  });
});

describe('migração de versão', () => {
  // A versão 1 é a primeira e ainda não tem migrações. A cadeia é testada com
  // um esquema fictício de três versões, só para este teste.
  const v1 = { schemaVersion: 1, id: 'velho', label: 'Tema antigo', colour: '#FF0000' };
  const migrations: Record<number, ThemeMigration> = {
    // v1 → v2: `label` virou `name`.
    1: ({ label, ...rest }) => ({ ...rest, schemaVersion: 2, name: label }),
    // v2 → v3: `colour` virou `colors.primary`.
    2: ({ colour, ...rest }) => ({ ...rest, schemaVersion: 3, colors: { primary: colour } }),
  };

  it('aplica as migrações em ordem até a versão atual', () => {
    expect(migrateTheme(v1, migrations, 3)).toEqual({
      schemaVersion: 3,
      id: 'velho',
      name: 'Tema antigo',
      colors: { primary: '#FF0000' },
    });
  });

  it('começa da versão do tema, não da primeira', () => {
    const v2 = { schemaVersion: 2, id: 'meio', name: 'Meio', colour: '#00FF00' };
    expect(migrateTheme(v2, migrations, 3)).toEqual({
      schemaVersion: 3,
      id: 'meio',
      name: 'Meio',
      colors: { primary: '#00FF00' },
    });
  });

  it('não altera o objeto recebido', () => {
    const input = { ...v1 };
    migrateTheme(input, migrations, 3);
    expect(input).toEqual(v1);
  });

  it('um tema na versão atual passa sem migração', () => {
    const v3 = { schemaVersion: 3, id: 'novo' };
    expect(migrateTheme(v3, migrations, 3)).toBe(v3);
  });

  it('falta de um passo da cadeia é erro claro', () => {
    expect(() => migrateTheme(v1, { 1: migrations[1]! }, 3)).toThrow(
      /não há migração da versão 2 para 3/,
    );
  });

  it('migração que não sobe a versão é erro interno', () => {
    const broken = { 1: (theme: Record<string, unknown>) => theme };
    expect(() => migrateTheme(v1, broken, 2)).toThrow(/não produziu a versão 2/);
  });

  it('versão futura é recusada', () => {
    expect(() => migrateTheme({ schemaVersion: 4 }, migrations, 3)).toThrow(
      /versão 4 é mais nova que a suportada por esta biblioteca \(3\)/,
    );
  });

  it('a versão atual do esquema é 1 e não tem migrações pendentes', () => {
    expect(THEME_SCHEMA_VERSION).toBe(1);
    expect(parseTheme(fullTheme('metal')).schemaVersion).toBe(1);
  });
});

describe('materiais', () => {
  it('os seis materiais têm presets', () => {
    expect(Object.keys(MATERIAL_PRESETS).sort()).toEqual([...MATERIALS].sort());
  });

  it('os presets são distintos entre si', () => {
    const signatures = MATERIALS.map((material) => JSON.stringify(MATERIAL_PRESETS[material]));
    expect(new Set(signatures).size).toBe(MATERIALS.length);
  });

  it('a física fica em faixas que não descontrolam a simulação', () => {
    for (const material of MATERIALS) {
      const { frictionScale, restitutionScale, density } = MATERIAL_PRESETS[material].physics;
      expect(frictionScale).toBeGreaterThan(0.5);
      expect(frictionScale).toBeLessThan(1.5);
      // Com a restituição padrão (0,45), o quique fica abaixo de 0,5.
      expect(0.45 * restitutionScale).toBeLessThan(0.5);
      expect(density).toBeGreaterThan(0.5);
      expect(density).toBeLessThanOrEqual(4);
    }
    expect(MATERIAL_PRESETS.plastic.physics).toEqual({
      frictionScale: 1,
      restitutionScale: 1,
      density: 1,
    });
  });

  it('o tema sobrepõe os padrões do material só onde foi preenchido', () => {
    const minimal = resolveAppearance({ ...DEFAULT_THEME, material: 'glass' });
    expect(minimal.opacity).toBe(MATERIAL_PRESETS.glass.appearance.opacity);
    expect(minimal.transmissive).toBe(true);
    expect(minimal.font).toBeUndefined();
    expect(minimal.emissive).toEqual({ color: '#000000', intensity: 0, target: 'numbers' });

    const full = resolveAppearance(fullTheme('glass'));
    expect(full).toMatchObject({
      texture: 'marble',
      opacity: 0.8,
      roughness: 0.25,
      metalness: 0.4,
      bevel: 0.04,
      emissive: { color: '#ff8800', intensity: 1.5, target: 'body' },
    });
  });

  it('a física do tema vem só do material', () => {
    const theme = fullTheme('metal');
    expect(materialPhysics(theme)).toEqual(MATERIAL_PRESETS.metal.physics);
    expect(materialPhysics({ ...theme, colors: DEFAULT_THEME.colors, roughness: 1 })).toEqual(
      MATERIAL_PRESETS.metal.physics,
    );
  });
});
