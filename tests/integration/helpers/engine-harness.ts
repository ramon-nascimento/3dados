import type { DiceAudio } from '../../../src/audio';
import { createStandardRegistry } from '../../../src/core/dice/standard';
import type { DieDefinition, DieRegistry } from '../../../src/core/die-definition';
import type { DiceEventName } from '../../../src/core/events';
import { readFace } from '../../../src/core/face-reading';
import type { Quat, Vec3 } from '../../../src/core/math';
import { createSeededRandomSource } from '../../../src/core/random';
import type { RollOutcome } from '../../../src/core/types';
import type { ResolvedAppearance } from '../../../src/customization';
import type { EffectsEnvironment, EffectsOptions } from '../../../src/effects';
import {
  DiceEngine,
  type EngineRenderer,
  type EngineSimulator,
  type RollHandle,
} from '../../../src/integration/engine';

/** Renderer sem GPU: guarda as transformações e deixa o teste avançar os quadros. */
export class FakeRenderer implements EngineRenderer {
  area = { width: 26, depth: 15 };
  readonly quality = 'high';
  readonly dice = new Map<
    string,
    { definition: DieDefinition; appearance: ResolvedAppearance; position: Vec3; rotation: Quat }
  >();
  /** Aparências recebidas em `prepare`, em ordem. */
  readonly prepared: ResolvedAppearance[][] = [];
  loop: (() => void) | undefined;
  disposed = false;
  /** Objetos de outros módulos (o grupo dos efeitos) colocados na cena. */
  readonly objects = new Set<unknown>();
  /** Quantas vezes `addObject` foi chamado. */
  objectsAdded = 0;
  renders = 0;

  prepare(appearances: readonly ResolvedAppearance[]): Promise<void> {
    this.prepared.push([...appearances]);
    return Promise.resolve();
  }
  setDieAppearance(
    dieId: string,
    _definition: DieDefinition,
    appearance: ResolvedAppearance,
  ): void {
    const die = this.dice.get(dieId)!;
    this.dice.set(dieId, { ...die, appearance });
  }
  addDie(dieId: string, definition: DieDefinition, appearance: ResolvedAppearance): void {
    this.dice.set(dieId, {
      definition,
      appearance,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
  }
  removeDie(dieId: string): void {
    this.dice.delete(dieId);
  }
  setDieTransform(dieId: string, position: Vec3, rotation: Quat): void {
    const die = this.dice.get(dieId)!;
    this.dice.set(dieId, { ...die, position, rotation });
  }
  getDieRotation(dieId: string): Quat {
    return this.dice.get(dieId)!.rotation;
  }
  getDiePosition(dieId: string): Vec3 {
    return this.dice.get(dieId)!.position;
  }
  addObject(object: unknown): void {
    this.objects.add(object);
    this.objectsAdded++;
  }
  removeObject(object: unknown): void {
    this.objects.delete(object);
  }
  startLoop(onFrame: () => void): void {
    this.loop = onFrame;
  }
  stopLoop(): void {
    this.loop = undefined;
  }
  render(): void {
    this.renders++;
  }
  dispose(): void {
    this.disposed = true;
  }

  /** Valor que cada malha exibe, lido da orientação final, por identificador. */
  displayed(): Record<string, number> {
    return Object.fromEntries(
      [...this.dice].map(([dieId, { definition, rotation }]) => [
        dieId,
        readFace(definition, rotation).face.value,
      ]),
    );
  }
}

export function createHarness(
  simulator: EngineSimulator,
  options: {
    seed?: number;
    registry?: DieRegistry;
    area?: { width: number; depth: number };
    audio?: DiceAudio;
    effects?: EffectsOptions;
    effectsEnvironment?: EffectsEnvironment;
  } = {},
) {
  const renderer = new FakeRenderer();
  if (options.area) renderer.area = options.area;
  let time = 0;
  /** Temporizadores do motor, disparados à mão por `flushTimers`. */
  let timers: { at: number; callback: () => void }[] = [];
  const engine = new DiceEngine({
    renderer,
    simulator,
    rng: createSeededRandomSource(options.seed ?? 11),
    registry: options.registry ?? createStandardRegistry(),
    now: () => time,
    ...(options.audio ? { audio: options.audio } : {}),
    ...(options.effects ? { effects: options.effects } : {}),
    ...(options.effectsEnvironment ? { effectsEnvironment: options.effectsEnvironment } : {}),
    setTimer: (callback, ms) => {
      const timer = { at: time + ms, callback };
      timers.push(timer);
      return () => {
        timers = timers.filter((t) => t !== timer);
      };
    },
  });
  const events: { name: DiceEventName; payload: unknown }[] = [];
  const names: DiceEventName[] = [
    'rollStarted',
    'diceCollided',
    'diceSettled',
    'rollCompleted',
    'rollCancelled',
    'rollFailed',
  ];
  for (const name of names) engine.on(name, (payload) => events.push({ name, payload }));

  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  /** Avança quadros de 1/60 s até a rolagem terminar. */
  const play = async (handle: RollHandle): Promise<RollOutcome> => {
    let done = false;
    void handle.result.then(() => (done = true));
    for (let frame = 0; frame < 3_000 && !done; frame++) {
      await tick();
      time += 1000 / 60;
      renderer.loop?.();
    }
    if (!done) throw new Error('a rolagem não terminou');
    return handle.result;
  };

  /** Avança até `count` quadros, parando quando o laço de render desliga. */
  const runFrames = async (count: number): Promise<number> => {
    let frames = 0;
    for (; frames < count && renderer.loop; frames++) {
      await tick();
      time += 1000 / 60;
      renderer.loop?.();
    }
    return frames;
  };

  /** Avança o relógio até o próximo temporizador e o dispara. Devolve se havia algum. */
  const flushTimers = (): boolean => {
    const next = [...timers].sort((a, b) => a.at - b.at)[0];
    if (!next) return false;
    timers = timers.filter((t) => t !== next);
    time = Math.max(time, next.at);
    next.callback();
    return true;
  };

  return {
    engine,
    renderer,
    events,
    play,
    tick,
    runFrames,
    flushTimers,
    now: () => time,
    pendingTimers: () => timers.length,
  };
}
