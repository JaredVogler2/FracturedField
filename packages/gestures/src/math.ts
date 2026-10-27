import type { Point3 } from './types.js';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const sub = (a: Point3, b: Point3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Point3, b: Point3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Point3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Point3, b: Point3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const len = (a: Point3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Point3, b: Point3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const dist2 = (a: Point3, b: Point3): number => Math.hypot(a.x - b.x, a.y - b.y);

export function norm(a: Point3): V3 {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

/** Angle between two vectors in radians, 0 when either is degenerate. */
export function angle(a: Point3, b: Point3): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))));
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export const finite3 = (p: Point3): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/**
 * One Euro filter (Casiez et al., 2012): an adaptive low-pass whose cutoff rises with speed, so a
 * resting hand is smooth (no jitter) while a fast move has little lag — the asymmetric smoothing
 * D05 asks for between idle aiming and fast motion.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private tPrev = 0;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.6,
    private readonly dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (!Number.isFinite(value)) return this.x ?? 0;
    if (this.x === null) {
      this.x = value;
      this.tPrev = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}
