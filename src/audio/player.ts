import { DiceError } from '../core/errors';
import { createSeededRandomSource, type RandomSource } from '../core/random';
import { impactSound, type SoundEvent } from './planner';
import {
  BUILTIN_SOUNDS,
  SAMPLE_GROUPS,
  SAMPLE_GROUP_SIZES,
  isSoundProfile,
  isSurface,
  sampleFileName,
  type SampleGroup,
  type SoundProfile,
  type Surface,
} from './profiles';
import { synthesize } from './synth';

/** O subconjunto do `AudioContext` que o motor usa. Permite testes sem navegador. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly destination: AudioNode;
  createGain(): GainNode;
  createBufferSource(): AudioBufferSourceNode;
  createDynamicsCompressor(): DynamicsCompressorNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

/** O que o áudio precisa da plataforma. No navegador: {@link browserAudioEnvironment}. */
export interface AudioEnvironment {
  /** Cria o contexto de áudio, ou devolve `undefined` se não houver Web Audio. */
  createContext(): AudioContextLike | undefined;
  /** Se o código está rodando dentro de um gesto do usuário (clique, tecla). */
  hasUserActivation(): boolean;
  /** Chama `callback` a cada gesto do usuário na página. Devolve a remoção. */
  onUserGesture(callback: () => void): () => void;
  fetch(url: string): Promise<ArrayBuffer>;
}

/** Eventos que contam como gesto do usuário para a política de autoplay. */
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

export function browserAudioEnvironment(): AudioEnvironment {
  return {
    createContext() {
      if (typeof AudioContext !== 'function') return undefined;
      return new AudioContext({ latencyHint: 'interactive' });
    },
    hasUserActivation() {
      return typeof navigator !== 'undefined' && navigator.userActivation?.isActive === true;
    },
    onUserGesture(callback) {
      if (typeof document === 'undefined') return () => undefined;
      const options = { capture: true, passive: true } as const;
      for (const name of GESTURE_EVENTS) document.addEventListener(name, callback, options);
      return () => {
        for (const name of GESTURE_EVENTS) document.removeEventListener(name, callback, options);
      };
    },
    async fetch(url) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    },
  };
}

export interface AudioOptions {
  /** Liga o áudio. Padrão: `true`. Desligado, nenhum `AudioContext` é criado. */
  enabled?: boolean;
  /** Volume geral, de 0 a 1. Padrão: 0,8. */
  volume?: number;
  /**
   * URL da pasta com os sons do pacote (`assets/sounds/`), servida pela
   * aplicação. Sem ela, os sons são sintetizados.
   */
  baseUrl?: string;
  /** Superfície dos dados. Padrão: `wood` no overlay, `felt` na bandeja. */
  surface?: Surface;
  /** Quantos sons podem tocar ao mesmo tempo. Padrão: 16; de 1 a 64. */
  maxVoices?: number;
  /**
   * Libera o áudio no primeiro clique ou tecla na página. Padrão: `true`. Com
   * `false`, a aplicação chama `engine.audio.unlock()` dentro de um gesto.
   */
  autoUnlock?: boolean;
}

/**
 * Situação do áudio. `off`: desligado. `locked`: ligado, esperando um gesto do
 * usuário. `running`: tocando. `unavailable`: o navegador não tem Web Audio.
 */
export type AudioState = 'off' | 'locked' | 'running' | 'unavailable';

/** De onde vêm os sons em uso. */
export type SoundSource = 'none' | 'samples' | 'synth' | 'mixed';

export interface AudioStats {
  state: AudioState;
  /** Vozes tocando neste instante. */
  activeVoices: number;
  maxVoices: number;
  /** Sons agendados desde a criação. */
  scheduled: number;
  /** Sons descartados porque todas as vozes estavam ocupadas por sons mais fortes. */
  dropped: number;
  /** Vozes interrompidas para dar lugar a um som mais forte. */
  stolen: number;
  /** Sons ignorados porque o banco ainda estava carregando. */
  skipped: number;
  source: SoundSource;
}

export interface PlayOptions {
  /** Volume deste som, de 0 a 1, multiplicado pelo volume geral. Padrão: 1. */
  volume?: number;
  /** Atraso, em milissegundos. Padrão: 0. */
  delayMs?: number;
}

export interface ImpactOptions {
  profile: SoundProfile;
  /** Intensidade do impacto, de 0 a 1. */
  intensity: number;
  /** Contra a mesa (padrão) ou contra outro dado. */
  against?: 'surface' | 'die';
}

/** Controles públicos do áudio: `engine.audio`. */
export interface DiceAudioControls {
  readonly enabled: boolean;
  readonly volume: number;
  readonly surface: Surface;
  readonly state: AudioState;
  /** Liga ou desliga. Desligar interrompe o que estiver tocando. */
  setEnabled(enabled: boolean): void;
  /** Volume geral, de 0 a 1. */
  setVolume(volume: number): void;
  setSurface(surface: Surface): void;
  /**
   * Libera o áudio. Chame dentro de um manipulador de clique ou tecla.
   * Resolve com `true` se o áudio está tocando. Com o áudio desligado, não
   * cria nada e resolve com `false`.
   */
  unlock(): Promise<boolean>;
  /**
   * Toca um som especial (`bell`, `thud` ou um registrado). Devolve `false` se
   * o áudio não está tocando (desligado ou à espera de um gesto). Lança
   * `INVALID_ARGUMENT` para um nome não registrado.
   */
  play(name: string, options?: PlayOptions): boolean;
  /** Toca um impacto avulso de um perfil. Devolve `false` se o áudio não está tocando. */
  playImpact(options: ImpactOptions): boolean;
  /**
   * Registra um som especial a partir de um arquivo MP3 ou WAV. Resolve quando
   * o arquivo foi baixado (e decodificado, se o áudio já estiver liberado).
   */
  registerSound(name: string, url: string): Promise<void>;
  getStats(): AudioStats;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  start: number;
  end: number;
  level: number;
}

const DEFAULT_VOLUME = 0.8;
const DEFAULT_MAX_VOICES = 16;
const MAX_VOICES_LIMIT = 64;
/** Antecedência mínima ao agendar, em segundos, para o primeiro som não ser cortado. */
const SCHEDULE_LEAD = 0.01;
/** Rampa ao interromper uma voz, para não estalar. */
const CUT_FADE = 0.008;
/** Um som atrasado até isto ainda toca; mais que isso, já não combina com a imagem. */
const LATE_TOLERANCE = 0.04;
const SOUND_NAME = /^[A-Za-z0-9._-]{1,64}$/;

function invalid(message: string, details: Record<string, unknown>): DiceError {
  return new DiceError('INVALID_ARGUMENT', message, { details });
}

function checkVolume(volume: unknown, path: string): number {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw invalid(`${path}: esperado um número de 0 a 1.`, { path, received: volume });
  }
  return volume;
}

function checkSurface(surface: unknown, path: string): Surface {
  if (!isSurface(surface)) {
    throw invalid(`${path}: esperado "wood" ou "felt".`, { path, received: surface });
  }
  return surface;
}

/** Valida as opções de áudio. Lança `DiceError` `INVALID_ARGUMENT`. */
export function parseAudioOptions(options: unknown): AudioOptions {
  if (options === undefined) return {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalid('audio: esperado um objeto.', { path: 'audio', received: options });
  }
  const raw = options as Record<string, unknown>;
  const known = ['enabled', 'volume', 'baseUrl', 'surface', 'maxVoices', 'autoUnlock'];
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) {
      throw invalid(`audio.${key}: opção desconhecida.`, { path: `audio.${key}` });
    }
  }
  const parsed: AudioOptions = {};
  for (const key of ['enabled', 'autoUnlock'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      throw invalid(`audio.${key}: esperado true ou false.`, {
        path: `audio.${key}`,
        received: raw[key],
      });
    }
    parsed[key] = raw[key];
  }
  if (raw.volume !== undefined) parsed.volume = checkVolume(raw.volume, 'audio.volume');
  if (raw.surface !== undefined) parsed.surface = checkSurface(raw.surface, 'audio.surface');
  if (raw.baseUrl !== undefined) {
    if (typeof raw.baseUrl !== 'string' || raw.baseUrl.length === 0) {
      throw invalid('audio.baseUrl: esperada uma URL.', {
        path: 'audio.baseUrl',
        received: raw.baseUrl,
      });
    }
    parsed.baseUrl = raw.baseUrl;
  }
  if (raw.maxVoices !== undefined) {
    const value = raw.maxVoices;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_VOICES_LIMIT) {
      throw invalid(`audio.maxVoices: esperado um inteiro de 1 a ${MAX_VOICES_LIMIT}.`, {
        path: 'audio.maxVoices',
        received: value,
      });
    }
    parsed.maxVoices = value as number;
  }
  return parsed;
}

/** Chave de uma variação no banco. */
function bankKey(group: SampleGroup, variant: number): string {
  return `${group}#${variant}`;
}

/**
 * Reprodutor de áudio do motor. Cria o `AudioContext` só quando o áudio está
 * ligado e é liberado por um gesto, carrega o banco de sons (amostras ou
 * síntese) e toca os sons respeitando o limite de vozes.
 */
export class DiceAudio implements DiceAudioControls {
  private readonly env: AudioEnvironment;
  private readonly baseUrl: string | undefined;
  private readonly maxVoices: number;
  private readonly autoUnlock: boolean;
  private enabledFlag: boolean;
  private volumeValue: number;
  private surfaceValue: Surface;

  private context: AudioContextLike | undefined;
  private master: GainNode | undefined;
  private unavailable = false;
  private disposed = false;
  private removeGestureListener: (() => void) | undefined;

  private readonly buffers = new Map<string, AudioBuffer>();
  /** Arquivos do banco já baixados, à espera do contexto para decodificar. */
  private prefetched: Map<string, Promise<ArrayBuffer | undefined>> | undefined;
  private bankLoading: Promise<void> | undefined;
  private bankReady = false;
  /** Muda a cada `stopAll`: agendamentos adiados de antes não valem mais. */
  private generation = 0;
  private source: SoundSource = 'none';

  /** Sons especiais registrados pela aplicação. */
  private readonly custom = new Map<
    string,
    { data?: Promise<ArrayBuffer>; buffer?: AudioBuffer }
  >();

  private voices: Voice[] = [];
  private readonly rng: RandomSource = createSeededRandomSource(0x5eed);
  private readonly counters = { scheduled: 0, dropped: 0, stolen: 0, skipped: 0 };

  constructor(options: AudioOptions, env: AudioEnvironment, defaults: { surface: Surface }) {
    const parsed = parseAudioOptions(options);
    this.env = env;
    this.baseUrl =
      parsed.baseUrl === undefined
        ? undefined
        : parsed.baseUrl.endsWith('/')
          ? parsed.baseUrl
          : `${parsed.baseUrl}/`;
    this.maxVoices = parsed.maxVoices ?? DEFAULT_MAX_VOICES;
    this.autoUnlock = parsed.autoUnlock ?? true;
    this.enabledFlag = parsed.enabled ?? true;
    this.volumeValue = parsed.volume ?? DEFAULT_VOLUME;
    this.surfaceValue = parsed.surface ?? defaults.surface;
    if (this.enabledFlag) this.prepareWhileLocked();
  }

  get enabled(): boolean {
    return this.enabledFlag;
  }

  get volume(): number {
    return this.volumeValue;
  }

  get surface(): Surface {
    return this.surfaceValue;
  }

  get state(): AudioState {
    if (this.unavailable) return 'unavailable';
    if (!this.enabledFlag) return 'off';
    return this.context?.state === 'running' ? 'running' : 'locked';
  }

  /** Se vale a pena planejar sons: ligado e tocando. */
  get running(): boolean {
    return this.state === 'running' && !this.disposed;
  }

  setEnabled(enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw invalid('enabled: esperado true ou false.', { received: enabled });
    }
    if (this.disposed || enabled === this.enabledFlag) return;
    this.enabledFlag = enabled;
    if (!enabled) {
      this.stopAll();
      this.detachGestureListener();
      if (this.context?.state === 'running') void this.context.suspend().catch(() => undefined);
      return;
    }
    this.prepareWhileLocked();
    // Ligar dentro de um clique já libera o áudio.
    if (this.env.hasUserActivation()) void this.unlock();
  }

  setVolume(volume: number): void {
    this.volumeValue = checkVolume(volume, 'volume');
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volumeValue, this.context.currentTime, 0.02);
    }
  }

  setSurface(surface: Surface): void {
    this.surfaceValue = checkSurface(surface, 'surface');
  }

  async unlock(): Promise<boolean> {
    if (this.disposed || !this.enabledFlag || this.unavailable) return false;
    if (!this.context) {
      const context = this.env.createContext();
      if (!context) {
        this.unavailable = true;
        this.detachGestureListener();
        return false;
      }
      this.context = context;
      this.buildGraph(context);
      this.bankLoading = this.loadBank(context);
    }
    // `resume` precisa ser chamado ainda dentro do gesto (Safari): sem await antes.
    const resumed = this.context.state === 'running' ? undefined : this.context.resume();
    try {
      await resumed;
    } catch {
      // Sem gesto o navegador recusa; o próximo gesto tenta de novo.
    }
    if (this.context.state === 'running') this.detachGestureListener();
    return this.context.state === 'running';
  }

  /** Antes de uma rolagem: se o código está dentro de um gesto, aproveita para liberar. */
  unlockIfGesture(): void {
    if (this.autoUnlock && this.state === 'locked' && this.env.hasUserActivation()) {
      void this.unlock();
    }
  }

  /** Espera o banco de sons carregar (para testes e para o painel). */
  async ready(): Promise<void> {
    await this.bankLoading;
  }

  /**
   * Agenda os sons de uma rolagem, a partir de agora. Se o banco ainda estiver
   * carregando (a rolagem que liberou o áudio), os sons entram quando ele
   * ficar pronto, no instante em que deveriam tocar; os que já passaram são
   * ignorados.
   */
  scheduleRoll(events: readonly SoundEvent[]): void {
    const context = this.context;
    if (!this.running || !context) return;
    const origin = context.currentTime + SCHEDULE_LEAD;
    if (!this.bankReady && this.bankLoading) {
      const generation = this.generation;
      void this.bankLoading.then(() => {
        if (generation === this.generation && this.running) this.scheduleFrom(events, origin);
      });
      return;
    }
    this.scheduleFrom(events, origin);
  }

  private scheduleFrom(events: readonly SoundEvent[], origin: number): void {
    const context = this.context;
    if (!context) return;
    const earliest = context.currentTime + SCHEDULE_LEAD;
    for (const event of events) {
      const when = origin + event.timeMs / 1000;
      const buffer = this.buffers.get(bankKey(event.group, event.variant));
      if (!buffer || when < earliest - LATE_TOLERANCE) {
        this.counters.skipped++;
        continue;
      }
      this.startVoice(buffer, Math.max(when, earliest), event.gain, event.rate);
    }
  }

  play(name: string, options: PlayOptions = {}): boolean {
    const volume = checkVolume(options.volume ?? 1, 'volume');
    const delayMs = options.delayMs ?? 0;
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw invalid('delayMs: esperado um número maior ou igual a 0.', { received: delayMs });
    }
    const custom = this.custom.get(name);
    const builtin = (BUILTIN_SOUNDS as readonly string[]).includes(name);
    if (!custom && !builtin) {
      throw invalid(`Som não registrado: "${name}".`, {
        name,
        known: [...BUILTIN_SOUNDS, ...this.custom.keys()],
      });
    }
    if (!this.running) return false;
    return this.whenBankReady(() => {
      const buffer =
        custom?.buffer ?? (builtin ? this.buffers.get(bankKey(name as SampleGroup, 0)) : undefined);
      const context = this.context;
      if (!buffer || !context) {
        this.counters.skipped++;
        return false;
      }
      return this.startVoice(
        buffer,
        context.currentTime + SCHEDULE_LEAD + delayMs / 1000,
        volume,
        1,
      );
    });
  }

  playImpact(options: ImpactOptions): boolean {
    const { profile, intensity, against = 'surface' } = options;
    if (!isSoundProfile(profile)) {
      throw invalid(`profile: perfil sonoro desconhecido "${String(profile)}".`, {
        received: profile,
      });
    }
    if (
      typeof intensity !== 'number' ||
      !Number.isFinite(intensity) ||
      intensity < 0 ||
      intensity > 1
    ) {
      throw invalid('intensity: esperado um número de 0 a 1.', { received: intensity });
    }
    if (!this.running) return false;
    const sound = impactSound(profile, this.surfaceValue, intensity, against, this.rng);
    if (sound.gain <= 0) return false;
    return this.whenBankReady(() => {
      const buffer = this.buffers.get(bankKey(sound.group, sound.variant));
      const context = this.context;
      if (!buffer || !context) {
        this.counters.skipped++;
        return false;
      }
      return this.startVoice(buffer, context.currentTime + SCHEDULE_LEAD, sound.gain, sound.rate);
    });
  }

  /**
   * Roda `run` agora, ou quando o banco de sons terminar de carregar (o
   * primeiro clique libera o áudio e já pede um som). Devolve o resultado de
   * `run`, ou `true` quando adiado.
   */
  private whenBankReady(run: () => boolean): boolean {
    if (this.bankReady || !this.bankLoading) return run();
    const generation = this.generation;
    void this.bankLoading.then(() => {
      if (generation === this.generation && this.running) run();
    });
    return true;
  }

  registerSound(name: string, url: string): Promise<void> {
    if (typeof name !== 'string' || !SOUND_NAME.test(name)) {
      throw invalid('name: use letras, dígitos, ".", "_" e "-", até 64 caracteres.', {
        received: name,
      });
    }
    if (typeof url !== 'string' || url.length === 0) {
      throw invalid('url: esperada uma URL.', { received: url });
    }
    const entry: { data?: Promise<ArrayBuffer>; buffer?: AudioBuffer } = {};
    this.custom.set(name, entry);
    const data = this.env.fetch(url).catch((error: unknown) => {
      if (this.custom.get(name) === entry) this.custom.delete(name);
      throw new DiceError('ASSET_LOAD_FAILED', `Não foi possível baixar o som "${name}".`, {
        cause: error,
        details: { name, url },
      });
    });
    entry.data = data;
    return data.then(async () => {
      if (this.context) await this.decodeCustom(name, entry, this.context);
    });
  }

  getStats(): AudioStats {
    const now = this.context?.currentTime ?? 0;
    return {
      state: this.state,
      activeVoices: this.voices.filter((voice) => voice.start <= now && now < voice.end).length,
      maxVoices: this.maxVoices,
      ...this.counters,
      source: this.source,
    };
  }

  /** Interrompe tudo o que está tocando ou agendado. */
  stopAll(): void {
    this.generation++;
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    for (const voice of this.voices) this.cut(voice, Math.max(now, voice.start), now);
    this.voices = [];
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopAll();
    this.detachGestureListener();
    this.disposed = true;
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.master = undefined;
    this.buffers.clear();
  }

  /** Ligado e ainda sem contexto: baixa os arquivos e espera um gesto. */
  private prepareWhileLocked(): void {
    if (this.baseUrl && !this.prefetched && !this.context) {
      const base = this.baseUrl;
      this.prefetched = new Map();
      for (const group of SAMPLE_GROUPS) {
        for (let variant = 0; variant < SAMPLE_GROUP_SIZES[group]; variant++) {
          this.prefetched.set(
            bankKey(group, variant),
            this.env.fetch(base + sampleFileName(group, variant)).catch(() => undefined),
          );
        }
      }
    }
    if (this.autoUnlock && !this.removeGestureListener && this.state === 'locked') {
      this.removeGestureListener = this.env.onUserGesture(() => {
        void this.unlock();
      });
    }
  }

  private detachGestureListener(): void {
    this.removeGestureListener?.();
    this.removeGestureListener = undefined;
  }

  private buildGraph(context: AudioContextLike): void {
    const master = context.createGain();
    master.gain.value = this.volumeValue;
    // O compressor segura os picos quando muitos dados batem juntos.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    master.connect(compressor);
    compressor.connect(context.destination);
    this.master = master;
  }

  /** Decodifica as amostras baixadas; o que faltar é sintetizado. */
  private async loadBank(context: AudioContextLike): Promise<void> {
    const entries = SAMPLE_GROUPS.flatMap((group) =>
      Array.from({ length: SAMPLE_GROUP_SIZES[group] }, (_, variant) => ({ group, variant })),
    );
    // Decodifica tudo em paralelo: é o que separa o primeiro clique do primeiro som.
    const loaded = await Promise.all(
      entries.map(async ({ group, variant }) => {
        const data = await this.prefetched?.get(bankKey(group, variant));
        if (data) {
          try {
            return { group, variant, buffer: await context.decodeAudioData(data), sampled: true };
          } catch {
            // Arquivo corrompido: cai na síntese abaixo.
          }
        }
        const pcm = synthesize(group, variant, context.sampleRate);
        const buffer = context.createBuffer(1, pcm.length, context.sampleRate);
        buffer.getChannelData(0).set(pcm);
        return { group, variant, buffer, sampled: false };
      }),
    );
    if (this.disposed) return;
    for (const { group, variant, buffer } of loaded)
      this.buffers.set(bankKey(group, variant), buffer);
    const samples = loaded.filter((entry) => entry.sampled).length;
    const synthesized = loaded.length - samples;
    this.prefetched = undefined;
    this.bankReady = true;
    this.source = samples === 0 ? 'synth' : synthesized === 0 ? 'samples' : 'mixed';
    if (this.baseUrl && synthesized > 0) {
      console.warn(
        `[3dados] ${synthesized} som(ns) não carregaram de "${this.baseUrl}"; usando síntese no lugar.`,
      );
    }
    for (const [name, entry] of this.custom) await this.decodeCustom(name, entry, context);
  }

  private async decodeCustom(
    name: string,
    entry: { data?: Promise<ArrayBuffer>; buffer?: AudioBuffer },
    context: AudioContextLike,
  ): Promise<void> {
    if (entry.buffer || !entry.data) return;
    const data = await entry.data;
    // `decodeAudioData` consome o ArrayBuffer: decodifica uma cópia.
    try {
      entry.buffer = await context.decodeAudioData(data.slice(0));
    } catch (error) {
      if (this.custom.get(name) === entry) this.custom.delete(name);
      throw new DiceError('ASSET_LOAD_FAILED', `Não foi possível decodificar o som "${name}".`, {
        cause: error,
        details: { name },
      });
    }
  }

  /** Vozes ativas em um instante. */
  private activeAt(time: number): Voice[] {
    return this.voices.filter((voice) => voice.start <= time && time < voice.end);
  }

  /**
   * Toca um som respeitando o limite de vozes em todo o intervalo em que ele
   * soa. Se o limite estiver cheio em algum instante, o som só entra no lugar
   * da voz mais fraca daquele instante, e se for mais forte que ela.
   */
  private startVoice(buffer: AudioBuffer, when: number, level: number, rate: number): boolean {
    const context = this.context;
    const master = this.master;
    if (!context || !master || level <= 0) return false;
    const now = context.currentTime;
    this.voices = this.voices.filter((voice) => voice.end > now);

    const end = when + buffer.duration / rate;
    const instants = [
      when,
      ...this.voices
        .filter((voice) => voice.start > when && voice.start < end)
        .map((voice) => voice.start),
    ].sort((a, b) => a - b);
    // Primeiro decide; só interrompe alguém se o som realmente for entrar.
    const victims = new Map<Voice, number>();
    for (const instant of instants) {
      const active = this.activeAt(instant).filter((voice) => !victims.has(voice));
      if (active.length < this.maxVoices) continue;
      const weakest = active.reduce((a, b) => (b.level < a.level ? b : a));
      if (weakest.level >= level) {
        this.counters.dropped++;
        return false;
      }
      victims.set(weakest, Math.max(instant, weakest.start));
    }
    for (const [victim, at] of victims) {
      this.cut(victim, at, now);
      this.counters.stolen++;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(master);
    source.start(when);
    const voice: Voice = { source, gain, start: when, end, level };
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      this.voices = this.voices.filter((other) => other !== voice);
    };
    this.voices.push(voice);
    this.counters.scheduled++;
    return true;
  }

  /** Interrompe uma voz em `at`, com uma rampa curta para não estalar. */
  private cut(voice: Voice, at: number, now: number): void {
    const fadeStart = Math.max(voice.start, now, at - CUT_FADE);
    if (fadeStart < at) {
      voice.gain.gain.setValueAtTime(voice.level, fadeStart);
      voice.gain.gain.linearRampToValueAtTime(0, at);
    }
    try {
      voice.source.stop(at);
    } catch {
      // Já parada.
    }
    voice.end = at;
  }
}
