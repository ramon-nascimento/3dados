import { DEFAULT_THEME, parseTheme, serializeTheme, type ThemeConfig } from '3dados';

/**
 * Temas de exemplo do playground, um por material, mais o par Esperança e
 * Medo do Daggerheart. Não fazem parte do motor: são aparências como as que
 * uma aplicação criaria.
 */
export const EXAMPLE_THEMES: readonly ThemeConfig[] = [
  DEFAULT_THEME,
  {
    schemaVersion: 1,
    id: 'rubi',
    name: 'Plástico rubi',
    material: 'plastic',
    colors: { primary: '#b3262f', secondary: '#7c1820', numbers: '#fff4e0' },
  },
  {
    schemaVersion: 1,
    id: 'carvalho',
    name: 'Madeira de carvalho',
    material: 'wood',
    colors: { primary: '#b9824c', secondary: '#7a4d27', numbers: '#2b1a0c' },
  },
  {
    schemaVersion: 1,
    id: 'ardosia',
    name: 'Pedra ardósia',
    material: 'stone',
    colors: { primary: '#6f757c', secondary: '#3c4046', numbers: '#f1efe8' },
  },
  {
    schemaVersion: 1,
    id: 'prata',
    name: 'Metal prateado',
    material: 'metal',
    colors: { primary: '#c8ccd2', secondary: '#8d939b', numbers: '#1c222c' },
  },
  {
    schemaVersion: 1,
    id: 'safira',
    name: 'Vidro safira',
    material: 'glass',
    colors: { primary: '#3d8fd1', secondary: '#1f5d8f', numbers: '#ffffff' },
  },
  {
    schemaVersion: 1,
    id: 'ametista',
    name: 'Cristal ametista',
    material: 'crystal',
    colors: { primary: '#9a5cd6', secondary: '#5a2f87', numbers: '#ffffff' },
    emissive: { color: '#d9b8ff', intensity: 0.6, target: 'numbers' },
  },
  // Esperança e Medo diferem em claridade (dourado claro contra violeta
  // escuro), em material e em brilho, não só em matiz: continuam distintos para
  // quem não distingue cores.
  {
    schemaVersion: 1,
    id: 'esperanca',
    name: 'Esperança (Daggerheart)',
    material: 'metal',
    colors: { primary: '#e6bd4f', secondary: '#a8842c', numbers: '#2a1d04' },
    roughness: 0.35,
    // Preset registrado pelo playground (effects-panel.ts).
    effects: ['brilho-esperanca'],
  },
  {
    schemaVersion: 1,
    id: 'medo',
    name: 'Medo (Daggerheart)',
    material: 'crystal',
    colors: { primary: '#3a1d5c', secondary: '#1f0f33', numbers: '#f2e6ff' },
    opacity: 0.6,
    emissive: { color: '#b98cff', intensity: 1.4, target: 'numbers' },
    effects: ['aura-medo'],
  },
];

const STORAGE_KEY = '3dados.playground.themes';

export interface StoredThemes {
  themes: ThemeConfig[];
  /** Entradas salvas que não passaram na validação, com o motivo. */
  rejected: string[];
}

/** Temas salvos pelo usuário neste navegador. Cada um é validado ao carregar. */
export function loadStoredThemes(): StoredThemes {
  const result: StoredThemes = { themes: [], rejected: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    result.rejected.push('o armazenamento não contém JSON válido');
    return result;
  }
  if (!Array.isArray(raw)) return result;
  for (const entry of raw) {
    try {
      result.themes.push(parseTheme(entry));
    } catch (error) {
      result.rejected.push(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

function writeStoredThemes(themes: readonly ThemeConfig[]): void {
  // Guarda o JSON canônico de cada tema: o mesmo formato de exportação.
  const entries = themes.map((theme) => JSON.parse(serializeTheme(theme)) as unknown);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function saveStoredTheme(theme: ThemeConfig): void {
  const { themes } = loadStoredThemes();
  writeStoredThemes([...themes.filter((stored) => stored.id !== theme.id), theme]);
}

export function deleteStoredTheme(id: string): void {
  const { themes } = loadStoredThemes();
  writeStoredThemes(themes.filter((stored) => stored.id !== id));
}
