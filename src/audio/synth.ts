import { createSeededRandomSource, randomFloat } from '../core/random';
import { SAMPLE_GROUPS, type SampleGroup } from './profiles';

/**
 * Síntese procedural: o som de reserva quando a aplicação não informa onde
 * estão as amostras (`audio.baseUrl`) ou quando elas não carregam.
 *
 * Cada som é um estalo de ruído que excita alguns modos ressonantes
 * (senoides amortecidas), o modelo clássico de impacto em sólidos. Os modos
 * de cada material foram escolhidos para lembrar o timbre, sem pretensão de
 * realismo: as amostras gravadas soam melhor.
 */
interface Recipe {
  /** Frequências dos modos, em Hz. */
  modes: readonly number[];
  /** Tempo para cair 60 dB, em segundos. */
  decay: number;
  /** Proporção de ruído no ataque (0 a 1). */
  noise: number;
  /** Duração do estalo de ruído, em segundos. */
  noiseLength: number;
  /** Quantos estalos (o chacoalhar do lançamento tem vários). */
  clicks?: number;
  /** Intervalo médio entre estalos, em segundos. */
  clickSpacing?: number;
}

const RECIPES: Readonly<Record<SampleGroup, Recipe>> = {
  'plastic-light': { modes: [2400, 3900, 5600], decay: 0.05, noise: 0.45, noiseLength: 0.004 },
  'plastic-heavy': { modes: [1700, 2900, 4400], decay: 0.09, noise: 0.5, noiseLength: 0.006 },
  'wood-light': { modes: [780, 1350, 2250], decay: 0.06, noise: 0.5, noiseLength: 0.005 },
  'wood-heavy': { modes: [520, 960, 1700], decay: 0.1, noise: 0.55, noiseLength: 0.008 },
  'stone-light': { modes: [1900, 3200, 4800], decay: 0.04, noise: 0.7, noiseLength: 0.005 },
  'stone-heavy': { modes: [1200, 2300, 3700], decay: 0.08, noise: 0.75, noiseLength: 0.009 },
  'metal-light': { modes: [2950, 4370, 6120, 7930], decay: 0.35, noise: 0.2, noiseLength: 0.003 },
  'metal-heavy': { modes: [1830, 2710, 3920, 5480], decay: 0.5, noise: 0.25, noiseLength: 0.004 },
  'glass-light': { modes: [3300, 5250, 7400], decay: 0.25, noise: 0.15, noiseLength: 0.003 },
  'glass-heavy': { modes: [2600, 4150, 6300], decay: 0.35, noise: 0.2, noiseLength: 0.004 },
  felt: { modes: [170, 310], decay: 0.05, noise: 0.85, noiseLength: 0.012 },
  launch: {
    modes: [2600, 4100],
    decay: 0.03,
    noise: 0.6,
    noiseLength: 0.003,
    clicks: 7,
    clickSpacing: 0.05,
  },
  bell: {
    modes: [660, 1320 * 1.002, 1980 * 1.005, 2640 * 1.01],
    decay: 1.4,
    noise: 0.05,
    noiseLength: 0.002,
  },
  thud: { modes: [85, 140], decay: 0.25, noise: 0.6, noiseLength: 0.02 },
};

/** Duração total de um som sintetizado, em segundos. */
export function synthDuration(group: SampleGroup): number {
  const recipe = RECIPES[group];
  const clicks = recipe.clicks ?? 1;
  return (clicks - 1) * (recipe.clickSpacing ?? 0) + recipe.decay + 0.01;
}

/**
 * Gera as amostras de um som, normalizadas para pico 0,89 (−1 dBFS). A
 * variação muda a fase do ruído, desafina levemente os modos e, no
 * lançamento, o ritmo dos estalos.
 */
export function synthesize(group: SampleGroup, variant: number, sampleRate: number): Float32Array {
  const recipe = RECIPES[group];
  const rng = createSeededRandomSource(
    (SAMPLE_GROUPS.indexOf(group) * 7919 + variant * 104729 + 1) >>> 0,
  );
  const length = Math.ceil(synthDuration(group) * sampleRate);
  const out = new Float32Array(length);
  const clicks = recipe.clicks ?? 1;
  // Constante de amortecimento: cai 60 dB (fator 1000) em `decay` segundos.
  const damping = Math.log(1000) / recipe.decay;

  let start = 0;
  for (let click = 0; click < clicks; click++) {
    const amplitude = click === 0 ? 1 : 0.4 + 0.6 * randomFloat(rng);
    const detune = recipe.modes.map(() => 1 + (randomFloat(rng) - 0.5) * 0.04);
    const phases = recipe.modes.map(() => randomFloat(rng) * 2 * Math.PI);
    const noiseSamples = Math.max(1, Math.round(recipe.noiseLength * sampleRate));
    const startSample = Math.round(start * sampleRate);
    for (let i = startSample; i < length; i++) {
      const t = (i - startSample) / sampleRate;
      const envelope = Math.exp(-damping * t);
      if (envelope < 1e-4) break;
      let tone = 0;
      recipe.modes.forEach((frequency, m) => {
        // Modos mais agudos morrem antes, como em um sólido real.
        const modeEnvelope = Math.exp(-damping * t * (1 + m * 0.6));
        tone +=
          (modeEnvelope * Math.sin(2 * Math.PI * frequency * detune[m]! * t + phases[m]!)) /
          (m + 1);
      });
      const burst =
        i - startSample < noiseSamples
          ? (randomFloat(rng) * 2 - 1) * (1 - (i - startSample) / noiseSamples)
          : 0;
      out[i]! += amplitude * ((1 - recipe.noise) * tone * envelope + recipe.noise * burst);
    }
    start += (recipe.clickSpacing ?? 0) * (0.5 + randomFloat(rng));
  }

  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) {
    const gain = 0.891 / peak;
    for (let i = 0; i < length; i++) out[i]! *= gain;
  }
  return out;
}
