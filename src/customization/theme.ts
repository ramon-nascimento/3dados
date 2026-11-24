import { DiceError } from '../core/errors';

/** Versão atual do esquema de tema. Temas mais antigos são migrados por `parseTheme`. */
export const THEME_SCHEMA_VERSION = 1;

export const MATERIALS = ['plastic', 'wood', 'stone', 'metal', 'glass', 'crystal'] as const;
export type MaterialKind = (typeof MATERIALS)[number];

export const TEXTURES = ['none', 'speckle', 'marble', 'wood-grain', 'stone'] as const;
export type TextureKind = (typeof TEXTURES)[number];

export const EMISSIVE_TARGETS = ['numbers', 'body'] as const;
export type EmissiveTarget = (typeof EMISSIVE_TARGETS)[number];

/** Cor no formato `#rrggbb` (minúsculas depois de `parseTheme`). */
export type ThemeColor = string;

export interface ThemeColors {
  /** Cor do corpo do dado. */
  primary: ThemeColor;
  /** Cor do padrão da textura; com `texture: 'none'`, cor do chanfro das arestas. */
  secondary: ThemeColor;
  /** Cor dos números e símbolos. */
  numbers: ThemeColor;
}

export interface ThemeEmissive {
  color: ThemeColor;
  /** De 0 a 4. */
  intensity: number;
  /** O que brilha: os números (padrão) ou o corpo. */
  target?: EmissiveTarget;
}

/**
 * Aparência de um dado. É JSON puro e versionado; só afeta o que se vê e a
 * trajetória, nunca o valor de uma rolagem.
 */
export interface ThemeConfig {
  schemaVersion: typeof THEME_SCHEMA_VERSION;
  /** Identificador usado em `DieSpec.theme`. Letras, dígitos, `.`, `_` e `-`; até 64. */
  id: string;
  /** Nome para exibição. */
  name: string;
  material: MaterialKind;
  colors: ThemeColors;
  /** Família CSS dos números. Padrão: a fonte incluída no pacote. */
  font?: string;
  /** Padrão desenhado no corpo. Padrão: o do material. */
  texture?: TextureKind;
  /** De 0 (invisível) a 1 (opaco). Padrão: o do material. */
  opacity?: number;
  /** De 0 a 1. Padrão: o do material. */
  roughness?: number;
  /** De 0 a 1. Padrão: o do material. */
  metalness?: number;
  emissive?: ThemeEmissive;
  /** Largura do chanfro das arestas, em unidades (aresta do d6 = 1). Só visual. */
  bevel?: number;
  /** Reservado para a Etapa 7 (efeitos). Preservado, sem efeito. */
  effects?: string[];
  /** Reservado para a Etapa 6 (áudio). Preservado, sem efeito. */
  soundProfile?: string;
}

/** Faixas aceitas para os campos numéricos. */
export const THEME_LIMITS = {
  idLength: 64,
  nameLength: 80,
  fontLength: 200,
  emissiveIntensity: { min: 0, max: 4 },
  bevel: { min: 0, max: 0.12 },
  effects: 16,
  tagLength: 64,
} as const;

/** Uma migração recebe um tema da versão `n` e devolve o mesmo tema na versão `n + 1`. */
export type ThemeMigration = (theme: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrações, indexadas pela versão de origem. A versão 1 é a primeira; não há
 * migrações ainda. Uma mudança incompatível no esquema acrescenta aqui a
 * migração da versão anterior e sobe `THEME_SCHEMA_VERSION`.
 */
export const THEME_MIGRATIONS: Readonly<Record<number, ThemeMigration>> = {};

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
// Letras (inclusive acentuadas), dígitos, espaços, aspas, vírgulas, hífens e pontos:
// o bastante para uma lista de famílias CSS, sem permitir outra declaração.
const FONT_PATTERN = /^[\p{L}\p{N} ,'"._-]+$/u;

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'id',
  'name',
  'material',
  'colors',
  'font',
  'texture',
  'opacity',
  'roughness',
  'metalness',
  'emissive',
  'bevel',
  'effects',
  'soundProfile',
]);

function invalid(path: string, message: string, received?: unknown): DiceError {
  return new DiceError('INVALID_THEME', `Tema inválido: ${path}: ${message}`, {
    details: { path, ...(received === undefined ? {} : { received: describe(received) }) },
  });
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'lista';
  if (typeof value === 'object') return 'objeto';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  prefix: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw invalid(`${prefix}${key}`, 'campo desconhecido.');
    }
  }
}

function text(value: unknown, path: string, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid(path, 'esperado um texto não vazio.', value);
  }
  if (value.length > maxLength) {
    throw invalid(path, `no máximo ${maxLength} caracteres.`, value);
  }
  if (pattern && !pattern.test(value)) {
    throw invalid(path, 'contém caracteres não permitidos.', value);
  }
  return value;
}

function color(value: unknown, path: string): ThemeColor {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
    throw invalid(path, 'esperada uma cor no formato "#rrggbb".', value);
  }
  return value.toLowerCase();
}

function number(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(path, 'esperado um número.', value);
  }
  if (value < min || value > max) {
    throw invalid(path, `esperado um número entre ${min} e ${max}.`, value);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw invalid(path, `esperado um destes valores: ${options.join(', ')}.`, value);
  }
  return value as T;
}

/**
 * Leva um tema de qualquer versão suportada até a atual, aplicando as
 * migrações em ordem. Exportada para teste da cadeia de migração.
 */
export function migrateTheme(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, ThemeMigration>> = THEME_MIGRATIONS,
  currentVersion: number = THEME_SCHEMA_VERSION,
): Record<string, unknown> {
  const version = raw.schemaVersion;
  if (version === undefined) {
    throw invalid('schemaVersion', 'campo obrigatório.');
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw invalid('schemaVersion', 'esperado um inteiro maior ou igual a 1.', version);
  }
  if (version > currentVersion) {
    throw invalid(
      'schemaVersion',
      `a versão ${version} é mais nova que a suportada por esta biblioteca (${currentVersion}). Atualize o 3dados.`,
      version,
    );
  }
  let theme = raw;
  for (let from = version; from < currentVersion; from++) {
    const migrate = migrations[from];
    if (!migrate) {
      throw invalid('schemaVersion', `não há migração da versão ${from} para ${from + 1}.`, from);
    }
    theme = migrate({ ...theme });
    if (theme.schemaVersion !== from + 1) {
      throw new DiceError(
        'INTERNAL_ERROR',
        `A migração de tema da versão ${from} não produziu a versão ${from + 1}.`,
      );
    }
  }
  return theme;
}

/** Valida um tema já na versão atual e devolve uma cópia normalizada, com campos em ordem fixa. */
function validateCurrent(raw: Record<string, unknown>): ThemeConfig {
  rejectUnknownKeys(raw, TOP_LEVEL_KEYS, '');

  const id = text(raw.id, 'id', THEME_LIMITS.idLength, ID_PATTERN);
  const name = text(raw.name, 'name', THEME_LIMITS.nameLength);
  const material = oneOf(raw.material, 'material', MATERIALS);

  if (!isRecord(raw.colors)) throw invalid('colors', 'esperado um objeto.', raw.colors);
  rejectUnknownKeys(raw.colors, new Set(['primary', 'secondary', 'numbers']), 'colors.');
  const colors: ThemeColors = {
    primary: color(raw.colors.primary, 'colors.primary'),
    secondary: color(raw.colors.secondary, 'colors.secondary'),
    numbers: color(raw.colors.numbers, 'colors.numbers'),
  };

  const theme: ThemeConfig = { schemaVersion: THEME_SCHEMA_VERSION, id, name, material, colors };

  if (raw.font !== undefined) {
    theme.font = text(raw.font, 'font', THEME_LIMITS.fontLength, FONT_PATTERN);
  }
  if (raw.texture !== undefined) theme.texture = oneOf(raw.texture, 'texture', TEXTURES);
  if (raw.opacity !== undefined) theme.opacity = number(raw.opacity, 'opacity', 0, 1);
  if (raw.roughness !== undefined) theme.roughness = number(raw.roughness, 'roughness', 0, 1);
  if (raw.metalness !== undefined) theme.metalness = number(raw.metalness, 'metalness', 0, 1);

  if (raw.emissive !== undefined) {
    const emissive = raw.emissive;
    if (!isRecord(emissive)) throw invalid('emissive', 'esperado um objeto.', emissive);
    rejectUnknownKeys(emissive, new Set(['color', 'intensity', 'target']), 'emissive.');
    const { min, max } = THEME_LIMITS.emissiveIntensity;
    theme.emissive = {
      color: color(emissive.color, 'emissive.color'),
      intensity: number(emissive.intensity, 'emissive.intensity', min, max),
      ...(emissive.target === undefined
        ? {}
        : { target: oneOf(emissive.target, 'emissive.target', EMISSIVE_TARGETS) }),
    };
  }

  if (raw.bevel !== undefined) {
    theme.bevel = number(raw.bevel, 'bevel', THEME_LIMITS.bevel.min, THEME_LIMITS.bevel.max);
  }

  if (raw.effects !== undefined) {
    if (!Array.isArray(raw.effects)) throw invalid('effects', 'esperada uma lista.', raw.effects);
    if (raw.effects.length > THEME_LIMITS.effects) {
      throw invalid('effects', `no máximo ${THEME_LIMITS.effects} itens.`);
    }
    theme.effects = raw.effects.map((effect, i) =>
      text(effect, `effects[${i}]`, THEME_LIMITS.tagLength),
    );
  }
  if (raw.soundProfile !== undefined) {
    theme.soundProfile = text(raw.soundProfile, 'soundProfile', THEME_LIMITS.tagLength);
  }
  return theme;
}

/**
 * Valida um tema e o leva à versão atual. Aceita o objeto ou o texto JSON.
 * Lança `DiceError` `INVALID_THEME` com o caminho do campo na mensagem, por
 * exemplo `Tema inválido: colors.primary: esperada uma cor no formato "#rrggbb".`
 *
 * Devolve uma cópia nova: cores em minúsculas e campos em ordem fixa. Campos
 * opcionais ausentes continuam ausentes, para que a ida e volta não acrescente
 * nada ao que foi salvo.
 */
export function parseTheme(input: unknown): ThemeConfig {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (cause) {
      throw new DiceError('INVALID_THEME', 'Tema inválido: o texto não é JSON válido.', { cause });
    }
  }
  if (!isRecord(raw)) {
    throw new DiceError('INVALID_THEME', 'Tema inválido: esperado um objeto.', {
      details: { received: describe(raw) },
    });
  }
  return validateCurrent(migrateTheme(raw));
}

/** Converte um tema em JSON canônico. Valida antes; lança `INVALID_THEME` se ele não for válido. */
export function serializeTheme(theme: ThemeConfig): string {
  return JSON.stringify(parseTheme(theme), null, 2);
}
