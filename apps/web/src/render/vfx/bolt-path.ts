import { mulberry32 } from '../procedural';

/**
 * Lightning paths for the charge arcs (7C / D09): a jagged line between two conductors by midpoint
 * displacement, bowed slightly upward, plus a few forks that die out. Deterministic for a seed, so
 * both devices draw the same arc for the same discharge (the seed comes from the event).
 */

export interface BoltPaths {
  /** xyz of every point, the main path first, then each fork. */
  points: Float32Array;
  /** [start, count] of each path in `points` (in points); [0] is the main path. */
  paths: [number, number][];
  /** Brightness of each path (the main path 1, forks dimmer). */
  weight: number[];
}

/** Levels of subdivision of the main path (2^levels segments). */
export const MAIN_LEVELS = 4;
const FORK_LEVELS = 3;
export const MAX_FORKS = 3;
/** Points one bolt can need: the main path and every fork. */
export const BOLT_POINTS = (1 << MAIN_LEVELS) + 1 + MAX_FORKS * ((1 << FORK_LEVELS) + 1);

export function newBoltPaths(): BoltPaths {
  return { points: new Float32Array(BOLT_POINTS * 3), paths: [], weight: [] };
}

/** Sideways offsets of one path being subdivided (reused; nothing here is re-entrant). */
const scratch = new Float32Array(((1 << MAIN_LEVELS) + 1) * 2);

/**
 * Writes the subdivided path from a to b into `out` at point `at` and returns the point count.
 * Each level moves every midpoint sideways by up to `rough` of its segment's length (halving per
 * level), perpendicular to the a→b line.
 */
function subdivide(
  out: Float32Array,
  at: number,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  levels: number,
  rough: number,
  arch: number,
  rnd: () => number,
): number {
  const n = (1 << levels) + 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-6;
  // A basis across the line: u horizontal-ish, v the rest.
  let ux = -dz;
  const uy = 0;
  let uz = dx;
  let ul = Math.hypot(ux, uz);
  if (ul < 1e-6) {
    ux = 1;
    uz = 0;
    ul = 1;
  }
  ux /= ul;
  uz /= ul;
  const vx = (dy * uz - dz * uy) / len;
  const vy = (dz * ux - dx * uz) / len;
  const vz = (dx * uy - dy * ux) / len;
  // Straight line, then displace midpoints level by level (offsets along u and v only).
  const off = scratch;
  off.fill(0, 0, n * 2);
  let step = n - 1;
  let amp = rough * len;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) {
      off[i * 2] = (off[(i - half) * 2]! + off[(i + half) * 2]!) / 2 + (rnd() - 0.5) * amp;
      off[i * 2 + 1] =
        (off[(i - half) * 2 + 1]! + off[(i + half) * 2 + 1]!) / 2 + (rnd() - 0.5) * amp * 0.6;
    }
    step = half;
    amp *= 0.5;
  }
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const bow = Math.sin(s * Math.PI) * arch * len;
    const k = (at + i) * 3;
    out[k] = a[0] + dx * s + ux * off[i * 2]! + vx * off[i * 2 + 1]!;
    out[k + 1] = a[1] + dy * s + uy * off[i * 2]! + vy * off[i * 2 + 1]! + bow;
    out[k + 2] = a[2] + dz * s + uz * off[i * 2]! + vz * off[i * 2 + 1]!;
  }
  return n;
}

/** The main arc from a to b and its forks, for `seed`. */
export function boltPaths(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  seed: number,
  out: BoltPaths = newBoltPaths(),
): BoltPaths {
  const rnd = mulberry32(seed >>> 0 || 1);
  out.paths.length = 0;
  out.weight.length = 0;
  const pts = out.points;
  // Bowed well up: a discharge jumps through the air between conductors, clear of the water.
  const main = subdivide(pts, 0, a, b, MAIN_LEVELS, 0.22, 0.28, rnd);
  out.paths.push([0, main]);
  out.weight.push(1);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  let at = main;
  const forks = 1 + Math.floor(rnd() * MAX_FORKS);
  for (let f = 0; f < forks; f++) {
    // From a point a fifth to four fifths along, off to one side and a little down.
    const i = Math.floor(main * (0.2 + rnd() * 0.6));
    const from: [number, number, number] = [pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!];
    const j = Math.min(main - 1, i + 1);
    const tx = pts[j * 3]! - from[0];
    const tz = pts[j * 3 + 2]! - from[2];
    const tl = Math.hypot(tx, tz) || 1;
    const side = rnd() < 0.5 ? -1 : 1;
    const ang = (0.5 + rnd() * 0.6) * side;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const fl = len * (0.15 + rnd() * 0.2);
    const to: [number, number, number] = [
      from[0] + ((tx * c - tz * s) / tl) * fl,
      Math.max(0.05, from[1] - fl * (0.1 + rnd() * 0.3)),
      from[2] + ((tx * s + tz * c) / tl) * fl,
    ];
    const n = subdivide(pts, at, from, to, FORK_LEVELS, 0.3, 0, rnd);
    out.paths.push([at, n]);
    out.weight.push(0.45 + rnd() * 0.25);
    at += n;
  }
  return out;
}
