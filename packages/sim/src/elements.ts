/**
 * Pure helpers for the element layer (Phase 04): softened attraction fields, temperature
 * relaxation and the deterministic discharge graph. No Rapier, no world state — the authority
 * (GameWorld) feeds plain data in and applies the results, which keeps every rule unit-testable.
 *
 * These are game-scale approximations with physical inspiration, not simulations: attraction uses
 * Plummer softening (as in N-body codes) so it is finite at zero distance; heat relaxes
 * exponentially toward ambient; charge spreads over a contact graph with per-hop attenuation.
 */
import type { ElementRules } from '@ff/game-data';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Acceleration toward a source at offset (dx, dy, dz) = source − body:
 *   a = k · r / (r² + ε²)^1.5   (Plummer softening: 0 at r = 0, peak near r = ε/√2)
 * clamped to `maxA` and smoothly tapered to zero at `radius`, so a body never feels a step.
 */
export function softenedPull(
  dx: number,
  dy: number,
  dz: number,
  strength: number,
  softening: number,
  maxA: number,
  radius: number,
  out: Vec3Like = { x: 0, y: 0, z: 0 },
): Vec3Like {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  if (!Number.isFinite(dx + dy + dz) || !(strength > 0)) return out;
  const r2 = dx * dx + dy * dy + dz * dz;
  const r = Math.sqrt(r2);
  if (r >= radius || r < 1e-9) return out;
  const eps2 = softening * softening;
  // k / (r² + ε²)^1.5 multiplies the (unnormalised) offset vector.
  let s = strength / Math.pow(r2 + eps2, 1.5);
  const mag = s * r;
  if (mag > maxA) s = maxA / r;
  const edge = 1 - r / radius;
  const taper = edge >= 0.25 ? 1 : (edge / 0.25) * (edge / 0.25) * (3 - 2 * (edge / 0.25));
  s *= taper;
  out.x = dx * s;
  out.y = dy * s;
  out.z = dz * s;
  return out;
}

/** Exponential relaxation of `value` toward `target` at `ratePerSecond` over `dt` seconds. */
export function relaxToward(
  value: number,
  target: number,
  ratePerSecond: number,
  dt: number,
): number {
  if (!Number.isFinite(value)) return target;
  return value + (target - value) * (1 - Math.exp(-ratePerSecond * dt));
}

/** Smoothstep-shaped overlap weight of a point at distance `d` inside a disc of radius `r`. */
export function discWeight(d: number, r: number): number {
  if (!(r > 0) || d >= r) return 0;
  const k = 1 - d / r;
  return k * k * (3 - 2 * k);
}

/* ------------------------------------------------------------------------------------------ */
/* Discharge graph                                                                             */
/* ------------------------------------------------------------------------------------------ */

export interface Conductor {
  /** Stable sort key: deterministic traversal regardless of insertion order. */
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Footprint radius (pool radius, body radius). */
  readonly r: number;
  /** Floor patch (a water pool) rather than a body. */
  readonly flat: boolean;
}

export interface DischargeResult {
  /** Conductor indices in discharge order (seeds first, then breadth-first). */
  readonly order: readonly number[];
  /** Charge 0..1 per conductor index (0 = not reached). */
  readonly charge: readonly number[];
  /** [from, to] conductor indices; from = -1 for the caster's own spark. */
  readonly links: readonly (readonly [number, number])[];
}

function connected(a: Conductor, b: Conductor, slack: number, contactHeight: number): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const dh = Math.sqrt(dx * dx + dz * dz);
  if (a.flat && b.flat) return dh <= a.r + b.r + slack;
  if (a.flat || b.flat) {
    const pool = a.flat ? a : b;
    const body = a.flat ? b : a;
    return dh <= pool.r + body.r * 0.5 + slack && body.y - body.r <= contactHeight;
  }
  const dy = a.y - b.y;
  return Math.sqrt(dh * dh + dy * dy) <= a.r + b.r + slack;
}

/**
 * Spreads one discharge from a cast point. Conductors within `rules.radius` (plus their own
 * footprint) are seeded with charge 1; each hop keeps `attenuation` of its parent's charge and the
 * spread stops below `minCharge` or after `maxNodes`. Ties are broken by conductor key, so the
 * result is identical on every runtime.
 */
export function discharge(
  conductors: readonly Conductor[],
  cx: number,
  cz: number,
  rules: ElementRules['charge'],
  contactHeight: number,
): DischargeResult {
  const n = conductors.length;
  const charge = new Array<number>(n).fill(0);
  const order: number[] = [];
  const links: [number, number][] = [];
  const idx = [...conductors.keys()].sort((i, j) =>
    conductors[i]!.key < conductors[j]!.key ? -1 : conductors[i]!.key > conductors[j]!.key ? 1 : 0,
  );
  const seeds = idx
    .map((i) => {
      const c = conductors[i]!;
      const d = Math.hypot(c.x - cx, c.z - cz) - c.r;
      return { i, d };
    })
    .filter((s) => s.d <= rules.radius)
    .sort((a, b) => a.d - b.d || (conductors[a.i]!.key < conductors[b.i]!.key ? -1 : 1));
  const queue: number[] = [];
  for (const s of seeds) {
    if (order.length >= rules.maxNodes) break;
    charge[s.i] = 1;
    order.push(s.i);
    links.push([-1, s.i]);
    queue.push(s.i);
  }
  while (queue.length > 0 && order.length < rules.maxNodes) {
    const from = queue.shift()!;
    const next = charge[from]! * rules.attenuation;
    if (next < rules.minCharge) continue;
    for (const to of idx) {
      if (order.length >= rules.maxNodes) break;
      if (to === from || charge[to]! >= next) continue;
      if (!connected(conductors[from]!, conductors[to]!, rules.contactSlack, contactHeight))
        continue;
      const first = charge[to] === 0;
      charge[to] = next;
      if (first) {
        order.push(to);
        links.push([from, to]);
      }
      queue.push(to);
    }
  }
  return { order, charge, links };
}
