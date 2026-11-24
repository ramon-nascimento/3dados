import {
  EFFECTS,
  MATERIAL_PRESETS,
  MATERIALS,
  SOUND_PROFILES,
  TEXTURES,
  isDiceError,
  parseTheme,
  serializeTheme,
  type DiceEngine,
  type MaterialKind,
  type TextureKind,
  type ThemeConfig,
} from '3dados';
import { PLAYGROUND_PRESETS, effectLabel } from './effects-panel';
import { EXAMPLE_THEMES, deleteStoredTheme, loadStoredThemes, saveStoredTheme } from './themes';

/** Efeitos oferecidos para os temas: os internos e os presets do playground. */
const THEME_EFFECTS: readonly string[] = [...EFFECTS, ...PLAYGROUND_PRESETS.map((p) => p.name)];

const MATERIAL_LABELS: Record<MaterialKind, string> = {
  plastic: 'Plástico',
  wood: 'Madeira',
  stone: 'Pedra',
  metal: 'Metal',
  glass: 'Vidro',
  crystal: 'Cristal',
};

const TEXTURE_LABELS: Record<TextureKind, string> = {
  none: 'Lisa',
  speckle: 'Respingos',
  marble: 'Mármore',
  'wood-grain': 'Veios de madeira',
  stone: 'Pedra',
};

/** Fontes oferecidas. O valor vazio usa a fonte incluída no pacote. */
const FONTS: readonly { value: string; label: string }[] = [
  { value: '', label: 'Padrão (Atkinson Hyperlegible Next)' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Serifada do sistema' },
  { value: 'ui-monospace, Consolas, monospace', label: 'Monoespaçada do sistema' },
  { value: 'system-ui, "Segoe UI", Roboto, sans-serif', label: 'Sem serifa do sistema' },
];

/** Campos numéricos: ausentes no tema usam o padrão do material. */
const NUMERIC_FIELDS = [
  { key: 'opacity', label: 'Opacidade', min: 0, max: 1, step: 0.01 },
  { key: 'roughness', label: 'Rugosidade', min: 0, max: 1, step: 0.01 },
  { key: 'metalness', label: 'Metalicidade', min: 0, max: 1, step: 0.01 },
  { key: 'bevel', label: 'Chanfro das arestas', min: 0, max: 0.12, step: 0.005 },
] as const;
type NumericKey = (typeof NUMERIC_FIELDS)[number]['key'];

interface CatalogEntry {
  theme: ThemeConfig;
  saved: boolean;
}

function byTestId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!element) throw new Error(`Elemento não encontrado: ${id}`);
  return element;
}

function option(value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

function describeError(error: unknown): string {
  if (isDiceError(error)) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export interface ThemePanel {
  /** Temas disponíveis para as rolagens (exemplos e salvos). */
  themes(): readonly ThemeConfig[];
}

/**
 * Painel de personalização. Edita um tema, registra no motor a cada mudança
 * (os dados na mesa são redesenhados na hora), salva no navegador e exporta
 * ou importa o JSON.
 */
export function createThemePanel(engine: DiceEngine, onCatalogChange: () => void): ThemePanel {
  const select = byTestId<HTMLSelectElement>('theme-select');
  const idInput = byTestId<HTMLInputElement>('theme-id');
  const nameInput = byTestId<HTMLInputElement>('theme-name');
  const material = byTestId<HTMLSelectElement>('theme-material');
  const primary = byTestId<HTMLInputElement>('theme-primary');
  const secondary = byTestId<HTMLInputElement>('theme-secondary');
  const numbers = byTestId<HTMLInputElement>('theme-numbers');
  const font = byTestId<HTMLSelectElement>('theme-font');
  const texture = byTestId<HTMLSelectElement>('theme-texture');
  const soundProfile = byTestId<HTMLSelectElement>('theme-sound-profile');
  const emissiveOn = byTestId<HTMLInputElement>('theme-emissive-on');
  const emissiveColor = byTestId<HTMLInputElement>('theme-emissive-color');
  const emissiveIntensity = byTestId<HTMLInputElement>('theme-emissive-intensity');
  const emissiveTarget = byTestId<HTMLSelectElement>('theme-emissive-target');
  const json = byTestId<HTMLTextAreaElement>('theme-json');
  const importInput = byTestId<HTMLInputElement>('theme-import');
  const status = byTestId('theme-status');
  const numericRows = byTestId('theme-numeric');
  const effectChecks = byTestId('theme-effects');

  material.append(...MATERIALS.map((m) => option(m, MATERIAL_LABELS[m])));
  // Os perfis sonoros têm os mesmos nomes dos materiais.
  soundProfile.append(
    option('', 'Do material'),
    ...SOUND_PROFILES.map((profile) => option(profile, MATERIAL_LABELS[profile])),
  );
  font.append(...FONTS.map(({ value, label }) => option(value, label)));
  texture.append(
    option('', 'Padrão do material'),
    ...TEXTURES.map((t) => option(t, TEXTURE_LABELS[t])),
  );

  const numeric = new Map<
    NumericKey,
    { custom: HTMLInputElement; range: HTMLInputElement; output: HTMLOutputElement }
  >();
  for (const field of NUMERIC_FIELDS) {
    const row = document.createElement('div');
    row.className = 'numeric-row';
    const custom = document.createElement('input');
    custom.type = 'checkbox';
    custom.dataset.testid = `theme-${field.key}-custom`;
    custom.setAttribute('aria-label', `Personalizar ${field.label.toLowerCase()}`);
    const label = document.createElement('label');
    label.className = 'inline';
    label.append(custom, document.createTextNode(field.label));
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(field.min);
    range.max = String(field.max);
    range.step = String(field.step);
    range.dataset.testid = `theme-${field.key}`;
    range.setAttribute('aria-label', field.label);
    const output = document.createElement('output');
    row.append(label, range, output);
    numericRows.append(row);
    numeric.set(field.key, { custom, range, output });
  }

  const effectInputs = new Map<string, HTMLInputElement>();
  for (const name of THEME_EFFECTS) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.testid = `theme-effect-${name}`;
    const label = document.createElement('label');
    label.className = 'inline';
    label.append(input, document.createTextNode(effectLabel(name)));
    effectChecks.append(label);
    effectInputs.set(name, input);
  }

  const catalog = new Map<string, CatalogEntry>();
  /** Efeitos do tema que o playground não conhece: preservados ao salvar. */
  let unknownEffects: string[] = [];

  function setStatus(text: string, state?: 'ok' | 'bad'): void {
    status.textContent = text;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }

  function rebuildCatalog(selectedId?: string): void {
    catalog.clear();
    for (const theme of EXAMPLE_THEMES) catalog.set(theme.id, { theme, saved: false });
    const stored = loadStoredThemes();
    for (const theme of stored.themes) catalog.set(theme.id, { theme, saved: true });
    if (stored.rejected.length > 0) {
      setStatus(`Temas salvos ignorados: ${stored.rejected.join(' · ')}`, 'bad');
    }
    for (const { theme } of catalog.values()) engine.registerTheme(theme);

    select.replaceChildren(
      ...[...catalog.values()].map(({ theme, saved }) =>
        option(theme.id, `${theme.name}${saved ? ' (salvo)' : ''}`),
      ),
    );
    if (selectedId && catalog.has(selectedId)) select.value = selectedId;
    onCatalogChange();
  }

  /** Mostra no formulário os padrões do material para os campos não personalizados. */
  function syncNumeric(theme: Partial<ThemeConfig>): void {
    const defaults = MATERIAL_PRESETS[material.value as MaterialKind].appearance;
    for (const field of NUMERIC_FIELDS) {
      const row = numeric.get(field.key)!;
      const value = theme[field.key];
      row.custom.checked = value !== undefined;
      row.range.disabled = value === undefined;
      row.range.value = String(value ?? defaults[field.key]);
      row.output.value = Number(row.range.value).toFixed(field.key === 'bevel' ? 3 : 2);
    }
  }

  function fillForm(theme: ThemeConfig): void {
    idInput.value = theme.id;
    nameInput.value = theme.name;
    material.value = theme.material;
    primary.value = theme.colors.primary;
    secondary.value = theme.colors.secondary;
    numbers.value = theme.colors.numbers;
    font.value = FONTS.some(({ value }) => value === (theme.font ?? '')) ? (theme.font ?? '') : '';
    texture.value = theme.texture ?? '';
    emissiveOn.checked = theme.emissive !== undefined;
    emissiveColor.value = theme.emissive?.color ?? '#ffffff';
    emissiveIntensity.value = String(theme.emissive?.intensity ?? 1);
    emissiveTarget.value = theme.emissive?.target ?? 'numbers';
    // Um perfil que o motor não conhece é preservado e aparece marcado.
    const profile = theme.soundProfile ?? '';
    if (![...soundProfile.options].some((element) => element.value === profile)) {
      soundProfile.append(option(profile, `${profile} (desconhecido)`));
    }
    soundProfile.value = profile;
    const effects = theme.effects ?? [];
    for (const [name, input] of effectInputs) input.checked = effects.includes(name);
    unknownEffects = effects.filter((name) => !effectInputs.has(name));
    syncNumeric(theme);
    json.value = serializeTheme(theme);
  }

  /** Lê o formulário. O tema ainda não foi validado. */
  function readForm(): ThemeConfig {
    const theme: ThemeConfig = {
      schemaVersion: 1,
      id: idInput.value.trim(),
      name: nameInput.value,
      material: material.value as MaterialKind,
      colors: { primary: primary.value, secondary: secondary.value, numbers: numbers.value },
    };
    if (font.value) theme.font = font.value;
    if (texture.value) theme.texture = texture.value as TextureKind;
    if (soundProfile.value) theme.soundProfile = soundProfile.value;
    for (const field of NUMERIC_FIELDS) {
      const row = numeric.get(field.key)!;
      if (row.custom.checked) theme[field.key] = Number(row.range.value);
    }
    if (emissiveOn.checked) {
      theme.emissive = {
        color: emissiveColor.value,
        intensity: Number(emissiveIntensity.value),
        target: emissiveTarget.value as 'numbers' | 'body',
      };
    }
    const effects = [
      ...[...effectInputs].filter(([, input]) => input.checked).map(([name]) => name),
      ...unknownEffects,
    ];
    if (effects.length > 0) theme.effects = effects;
    return theme;
  }

  /** Valida e registra no motor; os dados na mesa mudam de aparência na hora. */
  function apply(theme: unknown): ThemeConfig | undefined {
    try {
      const parsed = parseTheme(theme);
      engine.registerTheme(parsed);
      json.value = serializeTheme(parsed);
      setStatus(`"${parsed.name}" aplicado.`, 'ok');
      return parsed;
    } catch (error) {
      setStatus(describeError(error), 'bad');
      return undefined;
    }
  }

  function onFormInput(event: Event): void {
    // O JSON e o arquivo têm botões próprios; o seletor de tema, o evento `change`.
    if (event.target === json || event.target === importInput || event.target === select) return;
    if (event.target === material) {
      // Trocar o material mostra os padrões dele nos campos não personalizados.
      syncNumeric(readForm());
    }
    for (const field of NUMERIC_FIELDS) {
      const row = numeric.get(field.key)!;
      row.range.disabled = !row.custom.checked;
      row.output.value = Number(row.range.value).toFixed(field.key === 'bevel' ? 3 : 2);
    }
    apply(readForm());
  }

  byTestId('theme-form').addEventListener('input', onFormInput);
  byTestId('theme-form').addEventListener('submit', (event) => event.preventDefault());

  select.addEventListener('change', () => {
    const entry = catalog.get(select.value);
    if (!entry) return;
    fillForm(entry.theme);
    setStatus(`Editando "${entry.theme.name}".`);
  });

  byTestId('theme-save').addEventListener('click', () => {
    const theme = apply(readForm());
    if (!theme) return;
    try {
      saveStoredTheme(theme);
    } catch (error) {
      setStatus(`Não foi possível salvar: ${describeError(error)}`, 'bad');
      return;
    }
    rebuildCatalog(theme.id);
    setStatus(`"${theme.name}" salvo neste navegador.`, 'ok');
  });

  byTestId('theme-delete').addEventListener('click', () => {
    const id = select.value;
    if (!catalog.get(id)?.saved) {
      setStatus('Só temas salvos podem ser excluídos; os exemplos são fixos.', 'bad');
      return;
    }
    deleteStoredTheme(id);
    rebuildCatalog();
    const entry = catalog.get(select.value);
    if (entry) fillForm(entry.theme);
    setStatus(`Tema "${id}" excluído deste navegador.`, 'ok');
  });

  byTestId('theme-load-json').addEventListener('click', () => {
    const theme = apply(json.value);
    if (theme) fillForm(theme);
  });

  byTestId('theme-export').addEventListener('click', () => {
    const theme = apply(readForm());
    if (!theme) return;
    const blob = new Blob([serializeTheme(theme)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${theme.id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const theme = apply(text);
      if (theme) fillForm(theme);
      importInput.value = '';
    });
  });

  rebuildCatalog('default');
  fillForm(catalog.get('default')!.theme);
  if (!status.textContent) setStatus('Edite os campos: os dados na mesa mudam na hora.');

  return {
    themes: () => [...catalog.values()].map(({ theme }) => theme),
  };
}
