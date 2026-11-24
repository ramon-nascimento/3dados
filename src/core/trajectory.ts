import { quatSlerp, vecLerp, type Quat, type Vec3 } from './math';
import type { DieId } from './types';

/** Trajetória gravada de um dado: um quadro por passo de simulação, mais o inicial. */
export interface DieTrajectory {
  readonly dieId: DieId;
  /** `x, y, z` por quadro. */
  readonly positions: Float32Array;
  /** `x, y, z, w` por quadro. */
  readonly rotations: Float32Array;
  /** Passo em que o dado parou de vez. */
  readonly settledStep: number;
}

/** Um impacto registrado durante a simulação. */
export interface CollisionRecord {
  readonly step: number;
  readonly dieId: DieId;
  /** Outro dado envolvido, ou `null` para a superfície (mesa e paredes). */
  readonly otherDieId: DieId | null;
  /** Intensidade normalizada, de 0 a 1. */
  readonly intensity: number;
}

/**
 * Gravação completa de uma simulação. É dado puro: a física a produz e o
 * render a reproduz, sem que um conheça o outro.
 */
export interface SimulationRecording {
  /** Duração de um passo, em segundos. */
  readonly timestep: number;
  /** Número de passos simulados. Cada trajetória tem `stepCount + 1` quadros. */
  readonly stepCount: number;
  readonly dice: readonly DieTrajectory[];
  /** Em ordem crescente de passo. */
  readonly collisions: readonly CollisionRecord[];
}

function positionAt(trajectory: DieTrajectory, frame: number): Vec3 {
  const i = frame * 3;
  const p = trajectory.positions;
  return { x: p[i]!, y: p[i + 1]!, z: p[i + 2]! };
}

function rotationAt(trajectory: DieTrajectory, frame: number): Quat {
  const i = frame * 4;
  const r = trajectory.rotations;
  return { x: r[i]!, y: r[i + 1]!, z: r[i + 2]!, w: r[i + 3]! };
}

export function frameCount(trajectory: DieTrajectory): number {
  return trajectory.positions.length / 3;
}

/** Posição e rotação em um instante fracionário, em passos. Fora da faixa, usa o extremo. */
export function sampleTrajectory(
  trajectory: DieTrajectory,
  step: number,
): { position: Vec3; rotation: Quat } {
  const last = frameCount(trajectory) - 1;
  const clamped = Math.min(Math.max(step, 0), last);
  const frame = Math.min(Math.floor(clamped), Math.max(last - 1, 0));
  const next = Math.min(frame + 1, last);
  const t = clamped - frame;
  return {
    position: vecLerp(positionAt(trajectory, frame), positionAt(trajectory, next), t),
    rotation: quatSlerp(rotationAt(trajectory, frame), rotationAt(trajectory, next), t),
  };
}

export function finalRotation(trajectory: DieTrajectory): Quat {
  return rotationAt(trajectory, frameCount(trajectory) - 1);
}

export function finalPosition(trajectory: DieTrajectory): Vec3 {
  return positionAt(trajectory, frameCount(trajectory) - 1);
}
