/**
 * Álgebra mínima de vetores e quatérnios. Os formatos `{x, y, z}` e
 * `{x, y, z, w}` são os mesmos usados pelo Rapier e aceitos pelo three, então
 * nenhum módulo precisa converter dados.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** "Para cima" no mundo: a mesa é o plano XZ. */
export const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vecLength(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Vetor unitário na mesma direção. O vetor nulo é devolvido sem alteração. */
export function vecNormalize(v: Vec3): Vec3 {
  const length = vecLength(v);
  return length === 0 ? v : vecScale(v, 1 / length);
}

export function vecLerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Composição de rotações: aplica `b` primeiro, depois `a`. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Rotação inversa (para quatérnios unitários). */
export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

export function quatDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function quatNormalize(q: Quat): Quat {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length === 0) return QUAT_IDENTITY;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

export function rotateVector(q: Quat, v: Vec3): Vec3 {
  const axis = { x: q.x, y: q.y, z: q.z };
  const t = vecScale(vecCross(axis, v), 2);
  return vecAdd(vecAdd(v, vecScale(t, q.w)), vecCross(axis, t));
}

/**
 * Quatérnio da rotação que leva os eixos canônicos X, Y, Z aos eixos dados.
 * Os eixos precisam formar uma base ortonormal destra.
 */
export function quatFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  const m11 = xAxis.x;
  const m12 = yAxis.x;
  const m13 = zAxis.x;
  const m21 = xAxis.y;
  const m22 = yAxis.y;
  const m23 = zAxis.y;
  const m31 = xAxis.z;
  const m32 = yAxis.z;
  const m33 = zAxis.z;
  const trace = m11 + m22 + m33;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (m32 - m23) * s, y: (m13 - m31) * s, z: (m21 - m12) * s };
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return { w: (m32 - m23) / s, x: 0.25 * s, y: (m12 + m21) / s, z: (m13 + m31) / s };
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return { w: (m13 - m31) / s, x: (m12 + m21) / s, y: 0.25 * s, z: (m23 + m32) / s };
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return { w: (m21 - m12) / s, x: (m13 + m31) / s, y: (m23 + m32) / s, z: 0.25 * s };
}

/** Menor rotação que leva o vetor unitário `from` ao vetor unitário `to`. */
export function quatFromUnitVectors(from: Vec3, to: Vec3): Quat {
  const cosine = vecDot(from, to);
  if (cosine < -1 + 1e-9) {
    // Opostos: meia-volta em torno de qualquer eixo perpendicular.
    const helper = Math.abs(from.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = vecNormalize(vecCross(from, helper));
    return { x: axis.x, y: axis.y, z: axis.z, w: 0 };
  }
  const axis = vecCross(from, to);
  return quatNormalize({ x: axis.x, y: axis.y, z: axis.z, w: 1 + cosine });
}

/** Interpolação esférica pelo caminho mais curto. */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  let cos = quatDot(a, b);
  let end = b;
  if (cos < 0) {
    cos = -cos;
    end = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cos > 0.9995) {
    // Quase iguais: interpolação linear evita divisão por um seno minúsculo.
    return quatNormalize({
      x: a.x + (end.x - a.x) * t,
      y: a.y + (end.y - a.y) * t,
      z: a.z + (end.z - a.z) * t,
      w: a.w + (end.w - a.w) * t,
    });
  }
  const angle = Math.acos(cos);
  const sin = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / sin;
  const wb = Math.sin(t * angle) / sin;
  return {
    x: a.x * wa + end.x * wb,
    y: a.y * wa + end.y * wb,
    z: a.z * wa + end.z * wb,
    w: a.w * wa + end.w * wb,
  };
}
