import type { DieDefinition } from '../core/die-definition';
import {
  createSeededRandomSource,
  randomFloat,
  randomInt,
  type RandomSource,
} from '../core/random';
import type { SimulationRecording } from '../core/trajectory';
import type { DieId } from '../core/types';
import {
  crowdAttenuation,
  dbToGain,
  intensityToGain,
  repeatAttenuation,
  semitonesToRate,
} from './gain';
import {
  PROFILE_VOICING,
  SAMPLE_GROUP_SIZES,
  type SampleGroup,
  type SoundProfile,
  type Surface,
} from './profiles';
import { findRollingContacts } from './rolling';

export type SoundKind = 'launch' | 'impact' | 'roll' | 'settle';

/** Um som agendado em relação ao início da animação. */
export interface SoundEvent {
  /** Instante, em milissegundos desde o primeiro quadro. */
  timeMs: number;
  kind: SoundKind;
  group: SampleGroup;
  /** Qual variação do grupo tocar. */
  variant: number;
  /** Ganho linear, antes do volume geral. */
  gain: number;
  /** Velocidade de reprodução (altura). */
  rate: number;
  /** Dado que produziu o som (ausente no lançamento). */
  dieId?: DieId;
}

export interface RollSoundDie {
  dieId: DieId;
  definition: DieDefinition;
  profile: SoundProfile;
}

export interface RollSoundInput {
  recording: SimulationRecording;
  /** Na mesma ordem de `recording.dice`. */
  dice: readonly RollSoundDie[];
  surface: Surface;
  /** Semente das variações. Não é o RNG dos valores. */
  seed: number;
}

/** A partir desta intensidade o impacto usa as amostras fortes. */
export const HEAVY_INTENSITY = 0.35;
/** Velocidade de referência dos tombos: a mesma ordem do lançamento (`throwSpeed`). */
const ROLL_REFERENCE_SPEED = 35;
/** Os tombos soam mais baixo que os impactos de mesma velocidade. */
const ROLL_GAIN = 0.55;
/** Som de estabilização: o último assentar do dado, quando ele chega quieto. */
const SETTLE_INTENSITY = 0.06;
const SETTLE_GAIN = 0.5;
/** Só há som de estabilização se o dado estiver quieto há este tempo. */
const SETTLE_QUIET_MS = 120;
/** Um tombo a menos disto de um impacto do mesmo dado é o próprio impacto. */
const ROLL_MERGE_STEPS = 3;
/** Sons abaixo deste ganho são descartados antes de ocupar uma voz (−48 dB). */
export const MIN_EVENT_GAIN = dbToGain(-48);
/** Variação aleatória de altura e de ganho, para que repetições não soem idênticas. */
const PITCH_JITTER_SEMITONES = 0.8;
const GAIN_JITTER_DB = 1.5;

interface Candidate {
  step: number;
  kind: Exclude<SoundKind, 'launch'>;
  dieIndex: number;
  otherIndex?: number;
  againstSurface: boolean;
  intensity: number;
}

function jitter(rng: RandomSource, amplitude: number): number {
  return (randomFloat(rng) * 2 - 1) * amplitude;
}

function variantOf(rng: RandomSource, group: SampleGroup): number {
  return randomInt(rng, SAMPLE_GROUP_SIZES[group]);
}

/** Grupo de amostras e ajuste de altura de um contato. */
function voicingFor(
  profile: SoundProfile,
  surface: Surface,
  candidate: Candidate,
): { group: SampleGroup; rate: number } {
  const voicing = PROFILE_VOICING[profile];
  // No feltro, o contato com a mesa é um baque abafado; a altura vem do material.
  if (candidate.againstSurface && surface === 'felt') {
    return { group: 'felt', rate: voicing.feltRate };
  }
  const heavy = candidate.kind === 'impact' && candidate.intensity >= HEAVY_INTENSITY;
  return { group: `${voicing.samples}-${heavy ? 'heavy' : 'light'}`, rate: voicing.rate };
}

/**
 * Um impacto avulso, fora de uma rolagem: usado para testar perfis (painel de
 * áudio) e por aplicações que queiram o som de um dado sem rolá-lo.
 */
export function impactSound(
  profile: SoundProfile,
  surface: Surface,
  intensity: number,
  against: 'surface' | 'die',
  rng: RandomSource,
): Omit<SoundEvent, 'timeMs'> {
  const candidate: Candidate = {
    step: 0,
    kind: 'impact',
    dieIndex: 0,
    againstSurface: against === 'surface',
    intensity,
  };
  const { group, rate } = voicingFor(profile, surface, candidate);
  return {
    kind: 'impact',
    group,
    variant: variantOf(rng, group),
    gain: intensityToGain(intensity) * PROFILE_VOICING[profile].gain,
    rate: rate * semitonesToRate(jitter(rng, PITCH_JITTER_SEMITONES)),
  };
}

/**
 * Transforma a gravação de uma simulação na lista de sons da rolagem.
 *
 * Considera o material de cada dado, a superfície, a intensidade de cada
 * contato, quantos dados estão em movimento naquele instante e o intervalo
 * desde o som anterior do mesmo dado. É puro e determinístico: a mesma
 * gravação e a mesma semente dão os mesmos sons. O limite de vozes é
 * aplicado depois, na reprodução, onde se sabe a duração real de cada som.
 */
export function planRollSounds(input: RollSoundInput): SoundEvent[] {
  const { recording, dice, surface } = input;
  const rng = createSeededRandomSource((input.seed ^ 0x2545f491) >>> 0);
  const stepMs = recording.timestep * 1000;
  const indexOf = new Map(dice.map((die, i) => [die.dieId, i]));
  const events: SoundEvent[] = [];

  // Lançamento: o chacoalhar dos dados saindo da mão, mais alto com mais dados.
  const launch: SampleGroup = 'launch';
  events.push({
    timeMs: 0,
    kind: 'launch',
    group: launch,
    variant: variantOf(rng, launch),
    gain: Math.min(0.6, 0.25 + 0.03 * dice.length),
    rate: semitonesToRate(jitter(rng, PITCH_JITTER_SEMITONES)),
  });

  const candidates: Candidate[] = [];
  const surfaceSteps = dice.map(() => [] as number[]);
  for (const collision of recording.collisions) {
    const dieIndex = indexOf.get(collision.dieId);
    if (dieIndex === undefined) continue;
    const otherIndex =
      collision.otherDieId === null ? undefined : indexOf.get(collision.otherDieId);
    const againstSurface = collision.otherDieId === null;
    if (againstSurface) surfaceSteps[dieIndex]!.push(collision.step);
    candidates.push({
      step: collision.step,
      kind: 'impact',
      dieIndex,
      ...(otherIndex === undefined ? {} : { otherIndex }),
      againstSurface,
      intensity: collision.intensity,
    });
  }

  dice.forEach((die, dieIndex) => {
    const trajectory = recording.dice[dieIndex];
    if (!trajectory) return;
    for (const contact of findRollingContacts(trajectory, die.definition, recording.timestep)) {
      const nearImpact = surfaceSteps[dieIndex]!.some(
        (step) => Math.abs(step - contact.step) <= ROLL_MERGE_STEPS,
      );
      if (nearImpact) continue;
      candidates.push({
        step: contact.step,
        kind: 'roll',
        dieIndex,
        againstSurface: true,
        intensity: Math.min(contact.speed / ROLL_REFERENCE_SPEED, 1),
      });
    }
    candidates.push({
      step: trajectory.settledStep,
      kind: 'settle',
      dieIndex,
      againstSurface: true,
      intensity: SETTLE_INTENSITY,
    });
  });

  // Ordem estável: por passo e, no mesmo passo, impactos antes de tombos.
  const kindOrder = { impact: 0, roll: 1, settle: 2 } as const;
  candidates.sort((a, b) => a.step - b.step || kindOrder[a.kind] - kindOrder[b.kind]);

  const settledSteps = recording.dice.map((trajectory) => trajectory.settledStep);
  const lastSoundMs = dice.map(() => -Infinity);

  for (const candidate of candidates) {
    const timeMs = candidate.step * stepMs;
    const die = dice[candidate.dieIndex]!;
    const sinceLast = timeMs - lastSoundMs[candidate.dieIndex]!;

    if (candidate.kind === 'settle' && sinceLast < SETTLE_QUIET_MS) continue;

    const moving = settledSteps.filter((settled) => settled > candidate.step).length;
    const kindGain =
      candidate.kind === 'roll' ? ROLL_GAIN : candidate.kind === 'settle' ? SETTLE_GAIN : 1;
    const gain =
      intensityToGain(candidate.intensity) *
      crowdAttenuation(moving) *
      repeatAttenuation(sinceLast) *
      kindGain *
      PROFILE_VOICING[die.profile].gain *
      dbToGain(jitter(rng, GAIN_JITTER_DB));
    if (gain < MIN_EVENT_GAIN) continue;

    const { group, rate } = voicingFor(die.profile, surface, candidate);
    events.push({
      timeMs,
      kind: candidate.kind,
      group,
      variant: variantOf(rng, group),
      gain,
      rate: rate * semitonesToRate(jitter(rng, PITCH_JITTER_SEMITONES)),
      dieId: die.dieId,
    });
    lastSoundMs[candidate.dieIndex] = timeMs;
    if (candidate.otherIndex !== undefined) lastSoundMs[candidate.otherIndex] = timeMs;
  }

  return events;
}
