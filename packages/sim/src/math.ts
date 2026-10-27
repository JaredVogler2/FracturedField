/** Allocation-light vector helpers used by the simulation hot path. */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const EPSILON = 1e-6;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function isFiniteNumber(v: number): boolean {
  return Number.isFinite(v);
}

export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

export function v3(x = 0, y = 0, z = 0): V3 {
  return { x, y, z };
}

export function length3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export function length2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}

/**
 * Scales `out` in place so its magnitude does not exceed `max`. Non-finite components are zeroed
 * (a NaN must never reach the physics engine).
 */
export function clampMagnitude3(out: V3, max: number): V3 {
  if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  const len = length3(out.x, out.y, out.z);
  if (len > max && len > EPSILON) {
    const s = max / len;
    out.x *= s;
    out.y *= s;
    out.z *= s;
  }
  return out;
}

/** Linear falloff: 1 inside `full`, 0 at/after `radius`. */
export function linearFalloff(distance: number, full: number, radius: number): number {
  if (distance <= full) return 1;
  if (distance >= radius) return 0;
  return 1 - (distance - full) / (radius - full);
}

export function quatFromYaw(yaw: number): { x: number; y: number; z: number; w: number } {
  const h = yaw * 0.5;
  return { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
}
