import type { AudioContextLike, AudioEnvironment } from '../../../src/audio';

/**
 * Web Audio de mentira: guarda o que foi criado, quando cada som começa e
 * para, e deixa o teste avançar o relógio. Só implementa o que o motor usa.
 */
class FakeParam {
  value: number;
  readonly automation: { type: string; value: number; time: number }[] = [];
  constructor(value: number) {
    this.value = value;
  }
  setValueAtTime(value: number, time: number) {
    this.automation.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.automation.push({ type: 'ramp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number) {
    this.automation.push({ type: 'target', value, time });
    this.value = value;
    return this;
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  connect<T>(node: T): T {
    this.connections.push(node);
    return node;
  }
  disconnect() {
    this.connections.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(0);
  readonly knee = new FakeParam(0);
  readonly ratio = new FakeParam(1);
  readonly attack = new FakeParam(0);
  readonly release = new FakeParam(0);
}

export class FakeBuffer {
  readonly numberOfChannels = 1;
  private readonly data: Float32Array;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData() {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  readonly playbackRate = new FakeParam(1);
  startTime: number | undefined;
  stopTime: number | undefined;
  onended: (() => void) | null = null;
  start(time = 0) {
    this.startTime = time;
  }
  stop(time = 0) {
    this.stopTime = time;
  }
  /** Fim real: o menor entre a parada pedida e o fim natural do som. */
  get endTime(): number {
    const natural = this.startTime! + this.buffer!.duration / this.playbackRate.value;
    return this.stopTime === undefined ? natural : Math.min(natural, this.stopTime);
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly sampleRate = 48_000;
  state: AudioContextState = 'suspended';
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  /** Se `resume` funciona (simula estar ou não dentro de um gesto). */
  allowResume = true;
  /** Duração dos sons decodificados, em segundos. */
  decodedDuration = 0.3;

  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createDynamicsCompressor() {
    return new FakeCompressor();
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(length, sampleRate);
  }
  decodeAudioData(data: ArrayBuffer) {
    if (new Uint8Array(data)[0] === 0xff) return Promise.reject(new Error('arquivo inválido'));
    return Promise.resolve(
      new FakeBuffer(Math.round(this.decodedDuration * this.sampleRate), this.sampleRate),
    );
  }
  resume() {
    if (this.allowResume && this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Sons que de fato tocam (os parados antes de começar não contam). */
  audible(): FakeSource[] {
    return this.sources.filter(
      (source) => source.startTime !== undefined && source.endTime > source.startTime,
    );
  }

  /** Maior número de sons soando ao mesmo tempo, em qualquer instante. */
  maxConcurrent(): number {
    const sources = this.audible();
    let max = 0;
    for (const { startTime } of sources) {
      const count = sources.filter(
        (s) => s.startTime! <= startTime! && startTime! < s.endTime,
      ).length;
      max = Math.max(max, count);
    }
    return max;
  }
}

export interface FakeEnvironment extends AudioEnvironment {
  readonly contexts: FakeAudioContext[];
  readonly fetched: string[];
  /** Ouvintes de gesto instalados agora. */
  listeners: number;
  userActivation: boolean;
  /** Simula um clique na página. */
  gesture(): void;
  /** URLs que falham ao baixar. */
  failing: Set<string>;
}

export function createFakeEnvironment(
  options: { webAudio?: boolean; configure?: (context: FakeAudioContext) => void } = {},
): FakeEnvironment {
  const callbacks = new Set<() => void>();
  const env: FakeEnvironment = {
    contexts: [],
    fetched: [],
    listeners: 0,
    userActivation: false,
    failing: new Set(),
    createContext() {
      if (options.webAudio === false) return undefined;
      const context = new FakeAudioContext();
      options.configure?.(context);
      env.contexts.push(context);
      return context as unknown as AudioContextLike;
    },
    hasUserActivation() {
      return env.userActivation;
    },
    onUserGesture(callback) {
      callbacks.add(callback);
      env.listeners = callbacks.size;
      return () => {
        callbacks.delete(callback);
        env.listeners = callbacks.size;
      };
    },
    fetch(url) {
      env.fetched.push(url);
      if (env.failing.has(url)) return Promise.reject(new Error('404'));
      return Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
    },
    gesture() {
      const previous = env.userActivation;
      env.userActivation = true;
      for (const callback of [...callbacks]) callback();
      env.userActivation = previous;
    },
  };
  return env;
}

/** Espera as promessas pendentes (carregamento do banco, `resume`). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
