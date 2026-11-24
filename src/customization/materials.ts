import {
  THEME_SCHEMA_VERSION,
  type EmissiveTarget,
  type MaterialKind,
  type TextureKind,
  type ThemeColors,
  type ThemeConfig,
} from './theme';

/** Congela um objeto e tudo o que ele contém: os presets são compartilhados. */
function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child as object);
  }
  return Object.freeze(value);
}

/** Como cada material se comporta na simulação, em relação ao plástico. */
export interface MaterialPhysics {
  /** Multiplica o atrito dos dados de `PhysicsConfig`. */
  frictionScale: number;
  /** Multiplica a restituição dos dados de `PhysicsConfig`. */
  restitutionScale: number;
  /** Densidade relativa (plástico = 1). Só pesa nas colisões entre dados. */
  density: number;
}

/** Aparência padrão de cada material; o tema pode sobrepor parte dela. */
export interface MaterialAppearance {
  texture: TextureKind;
  opacity: number;
  roughness: number;
  metalness: number;
  bevel: number;
  /** Verniz por cima da cor (0 a 1). */
  clearcoat: number;
  /** Índice de refração, usado com transmissão. */
  ior: number;
  /** Material que deixa a luz atravessar: usa transmissão na qualidade alta. */
  transmissive: boolean;
  /** Separação de cores na refração (só com transmissão). */
  dispersion: number;
  /** Reflexo furta-cor (0 a 1). */
  iridescence: number;
}

export interface MaterialPreset {
  appearance: MaterialAppearance;
  physics: MaterialPhysics;
  /** Perfil sonoro sugerido. Reservado para a Etapa 6. */
  soundProfile: string;
}

/**
 * Presets dos seis materiais. As densidades seguem a ordem real (madeira <
 * plástico < vidro ≈ pedra < metal) com diferenças menores que as reais, para
 * que um dado de metal não arremesse os outros para fora da mesa. Atrito e
 * restituição foram conferidos por medição de convergência (docs/BENCHMARKS.md).
 */
export const MATERIAL_PRESETS: Readonly<Record<MaterialKind, Readonly<MaterialPreset>>> =
  deepFreeze({
    plastic: {
      appearance: {
        texture: 'none',
        opacity: 1,
        roughness: 0.38,
        metalness: 0,
        bevel: 0.06,
        clearcoat: 0.35,
        ior: 1.5,
        transmissive: false,
        dispersion: 0,
        iridescence: 0,
      },
      physics: { frictionScale: 1, restitutionScale: 1, density: 1 },
      soundProfile: 'plastic',
    },
    wood: {
      appearance: {
        texture: 'wood-grain',
        opacity: 1,
        roughness: 0.72,
        metalness: 0,
        bevel: 0.08,
        clearcoat: 0.1,
        ior: 1.5,
        transmissive: false,
        dispersion: 0,
        iridescence: 0,
      },
      physics: { frictionScale: 1.15, restitutionScale: 0.85, density: 0.6 },
      soundProfile: 'wood',
    },
    stone: {
      appearance: {
        texture: 'stone',
        opacity: 1,
        roughness: 0.82,
        metalness: 0,
        bevel: 0.07,
        clearcoat: 0,
        ior: 1.5,
        transmissive: false,
        dispersion: 0,
        iridescence: 0,
      },
      physics: { frictionScale: 1.1, restitutionScale: 0.75, density: 2.2 },
      soundProfile: 'stone',
    },
    metal: {
      appearance: {
        texture: 'none',
        opacity: 1,
        roughness: 0.28,
        metalness: 1,
        bevel: 0.05,
        clearcoat: 0,
        ior: 1.5,
        transmissive: false,
        dispersion: 0,
        iridescence: 0,
      },
      physics: { frictionScale: 0.8, restitutionScale: 0.7, density: 3.5 },
      soundProfile: 'metal',
    },
    glass: {
      appearance: {
        texture: 'none',
        opacity: 0.35,
        roughness: 0.06,
        metalness: 0,
        bevel: 0.05,
        clearcoat: 0,
        ior: 1.5,
        transmissive: true,
        dispersion: 0,
        iridescence: 0,
      },
      physics: { frictionScale: 0.7, restitutionScale: 1.1, density: 2.1 },
      soundProfile: 'glass',
    },
    crystal: {
      appearance: {
        texture: 'none',
        opacity: 0.3,
        roughness: 0.02,
        metalness: 0,
        bevel: 0.025,
        clearcoat: 0,
        ior: 2.0,
        transmissive: true,
        dispersion: 0.6,
        iridescence: 0.35,
      },
      physics: { frictionScale: 0.7, restitutionScale: 1.1, density: 2.2 },
      soundProfile: 'crystal',
    },
  });

/** Tudo o que o renderer precisa para desenhar um dado, sem nenhum campo opcional. */
export interface ResolvedAppearance extends MaterialAppearance {
  material: MaterialKind;
  colors: ThemeColors;
  /** Família CSS; `undefined` usa a fonte incluída no pacote. */
  font: string | undefined;
  emissive: { color: string; intensity: number; target: EmissiveTarget };
}

/** Completa o tema com os padrões do material. Puro: não toca em three nem em DOM. */
export function resolveAppearance(theme: ThemeConfig): ResolvedAppearance {
  const preset = MATERIAL_PRESETS[theme.material].appearance;
  return {
    ...preset,
    material: theme.material,
    colors: { ...theme.colors },
    font: theme.font,
    texture: theme.texture ?? preset.texture,
    opacity: theme.opacity ?? preset.opacity,
    roughness: theme.roughness ?? preset.roughness,
    metalness: theme.metalness ?? preset.metalness,
    bevel: theme.bevel ?? preset.bevel,
    emissive: {
      color: theme.emissive?.color ?? '#000000',
      intensity: theme.emissive?.intensity ?? 0,
      target: theme.emissive?.target ?? 'numbers',
    },
  };
}

/** Parâmetros físicos do material do tema. */
export function materialPhysics(theme: ThemeConfig): MaterialPhysics {
  return { ...MATERIAL_PRESETS[theme.material].physics };
}

/**
 * Aparência padrão: plástico marfim com números grafite. Neutra e legível
 * sobre mapas claros (pela sombra) e escuros (pelo contraste).
 */
export const DEFAULT_THEME: Readonly<ThemeConfig> = deepFreeze<ThemeConfig>({
  schemaVersion: THEME_SCHEMA_VERSION,
  id: 'default',
  name: 'Marfim',
  material: 'plastic',
  colors: { primary: '#efe9dc', secondary: '#d9d0bd', numbers: '#24272d' },
});
