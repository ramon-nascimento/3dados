/**
 * Mapeamentos de ganho. São funções puras: a mesma entrada dá sempre o mesmo
 * ganho, e os testes conferem a forma das curvas.
 */

/** Abaixo desta intensidade um impacto não produz som. */
export const MIN_AUDIBLE_INTENSITY = 0.02;

/**
 * Faixa dinâmica entre o impacto mais fraco audível e o mais forte, em dB.
 * Um impacto de intensidade 1 toca com ganho 1 (0 dB).
 */
export const DYNAMIC_RANGE_DB = 36;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

/**
 * Ganho de um impacto a partir da intensidade normalizada (0 a 1).
 *
 * A amplitude de um impacto cresce com a velocidade, mas a percepção de
 * volume é logarítmica: a intensidade é levada a uma escala em dB pela raiz
 * quadrada, o que mantém audíveis os toques leves sem que se igualem aos
 * fortes. Intensidade 1 → 0 dB; 0,25 → −18 dB; abaixo do limiar → silêncio.
 */
export function intensityToGain(intensity: number): number {
  if (!Number.isFinite(intensity) || intensity < MIN_AUDIBLE_INTENSITY) return 0;
  const clamped = Math.min(intensity, 1);
  return dbToGain(DYNAMIC_RANGE_DB * (Math.sqrt(clamped) - 1));
}

/**
 * Atenuação pela quantidade de dados em movimento. Muitos dados juntos somam
 * energia; sem compensação, 20 dados soariam como uma explosão. O expoente
 * −0,4 deixa a mesa cheia um pouco mais alta que um dado sozinho, como na
 * vida real, sem saturar.
 */
export function crowdAttenuation(movingDice: number): number {
  return movingDice <= 1 ? 1 : movingDice ** -0.4;
}

/** Abaixo deste intervalo, um novo impacto do mesmo dado é descartado. */
export const MIN_REPEAT_INTERVAL_MS = 15;
/** A partir deste intervalo, o impacto anterior não interfere mais. */
export const FULL_REPEAT_INTERVAL_MS = 60;

/**
 * Atenuação pelo intervalo desde o impacto anterior do mesmo dado. Contatos em
 * rajada (um dado trepidando contra outro) viram um só som, não uma
 * metralhadora. Devolve 0 quando o impacto deve ser descartado.
 */
export function repeatAttenuation(intervalMs: number): number {
  if (intervalMs < MIN_REPEAT_INTERVAL_MS) return 0;
  if (intervalMs >= FULL_REPEAT_INTERVAL_MS) return 1;
  return Math.sqrt(intervalMs / FULL_REPEAT_INTERVAL_MS);
}

/** Converte semitons em fator de velocidade de reprodução. */
export function semitonesToRate(semitones: number): number {
  return 2 ** (semitones / 12);
}
