/** Perfis sonoros dos dados: um por material. */
export const SOUND_PROFILES = ['plastic', 'wood', 'stone', 'metal', 'glass', 'crystal'] as const;
export type SoundProfile = (typeof SOUND_PROFILES)[number];

/** Superfície em que os dados caem. */
export const SURFACES = ['wood', 'felt'] as const;
export type Surface = (typeof SURFACES)[number];

/** Sons especiais embutidos, tocados quando a aplicação pede (`engine.audio.play`). */
export const BUILTIN_SOUNDS = ['bell', 'thud'] as const;
export type BuiltinSound = (typeof BUILTIN_SOUNDS)[number];

export function isSoundProfile(value: unknown): value is SoundProfile {
  return typeof value === 'string' && (SOUND_PROFILES as readonly string[]).includes(value);
}

export function isSurface(value: unknown): value is Surface {
  return typeof value === 'string' && (SURFACES as readonly string[]).includes(value);
}

/**
 * Grupo de amostras: variações do mesmo som, sorteadas a cada uso. O nome é o
 * prefixo dos arquivos em `assets/sounds/` (`plastic-light-1.wav`, ...).
 */
export type SampleGroup =
  `${Exclude<SoundProfile, 'crystal'>}-${'light' | 'heavy'}` | 'felt' | 'launch' | BuiltinSound;

/** Quantos arquivos cada grupo tem. Tem de casar com scripts/convert-sounds.js. */
export const SAMPLE_GROUP_SIZES: Readonly<Record<SampleGroup, number>> = {
  'plastic-light': 3,
  'plastic-heavy': 3,
  'wood-light': 3,
  'wood-heavy': 3,
  'stone-light': 3,
  'stone-heavy': 3,
  'metal-light': 3,
  'metal-heavy': 3,
  'glass-light': 3,
  'glass-heavy': 3,
  felt: 3,
  launch: 2,
  bell: 1,
  thud: 1,
};

export const SAMPLE_GROUPS = Object.keys(SAMPLE_GROUP_SIZES) as SampleGroup[];

/** Nome do arquivo de uma variação. */
export function sampleFileName(group: SampleGroup, variant: number): string {
  return SAMPLE_GROUP_SIZES[group] === 1 ? `${group}.wav` : `${group}-${variant + 1}.wav`;
}

/** Como um perfil soa: de que amostras parte e como elas são alteradas. */
export interface ProfileVoicing {
  /** Prefixo das amostras (o cristal reaproveita as de vidro, mais agudas). */
  samples: Exclude<SoundProfile, 'crystal'>;
  /** Fator de velocidade de reprodução (altura). */
  rate: number;
  /** Ajuste de ganho do perfil, para equilibrar materiais entre si. */
  gain: number;
  /**
   * Altura do baque no feltro: materiais densos soam mais graves. Multiplica a
   * velocidade das amostras de feltro.
   */
  feltRate: number;
}

export const PROFILE_VOICING: Readonly<Record<SoundProfile, Readonly<ProfileVoicing>>> = {
  plastic: { samples: 'plastic', rate: 1, gain: 1, feltRate: 1.05 },
  wood: { samples: 'wood', rate: 1, gain: 0.9, feltRate: 1.1 },
  stone: { samples: 'stone', rate: 1.15, gain: 0.8, feltRate: 0.9 },
  metal: { samples: 'metal', rate: 1, gain: 0.7, feltRate: 0.85 },
  glass: { samples: 'glass', rate: 1, gain: 0.75, feltRate: 0.95 },
  crystal: { samples: 'glass', rate: 1.3, gain: 0.7, feltRate: 0.95 },
};
