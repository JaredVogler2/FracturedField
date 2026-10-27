/**
 * Synthetic landmark sequences for the gesture suite (D05 §5 fixture categories). All are
 * generated from the procedural hand model — artificial data, no recorded people.
 */
import { rng, timeline, type Key, type TimelineSpec } from '../src/synthetic.js';
import type { LandmarksFrame } from '../src/types.js';

export const HOME = { cx: 0.5, cy: 0.55, size: 0.15 } as const;

export function still(seconds: number, extra: Partial<TimelineSpec> = {}): LandmarksFrame[] {
  return timeline({ seconds, keys: [{ t: 0, hand: { ...HOME, shape: 'open' } }], ...extra });
}

/** Open hand, then a quick push toward the camera (apparent size +27 % in 0.2 s) and back. */
export function pulse(
  opts: { growth?: number; pushS?: number; aspect?: number; seed?: number; fps?: number } = {},
) {
  const g = opts.growth ?? 1.27;
  const push = opts.pushS ?? 0.2;
  return timeline({
    seconds: 2.4,
    aspect: opts.aspect ?? 16 / 9,
    seed: opts.seed ?? 3,
    ...(opts.fps ? { fps: opts.fps } : {}),
    keys: [
      { t: 0, hand: { ...HOME, shape: 'open' } },
      { t: 1.0, hand: { size: HOME.size } },
      { t: 1.0 + push, hand: { size: HOME.size * g } },
      { t: 1.6 + push, hand: { size: HOME.size * g } },
      { t: 2.1 + push, hand: { size: HOME.size } },
    ],
  });
}

/** One fast open-hand stroke from `from` to `to` (normalised centres) taking `seconds`. */
export function swipe(
  from: readonly [number, number],
  to: readonly [number, number],
  seconds = 0.3,
  extra: Partial<TimelineSpec> = {},
) {
  return timeline({
    seconds: 1.0 + seconds + 0.8,
    keys: [
      { t: 0, hand: { cx: from[0], cy: from[1], size: HOME.size, shape: 'open' } },
      { t: 1.0, hand: { cx: from[0], cy: from[1] } },
      { t: 1.0 + seconds, hand: { cx: to[0], cy: to[1] } },
    ],
    ...extra,
  });
}

/** Open → shape held for `holdS` → open. */
export function sign(
  shape: 'fist' | 'vee' | 'thumb' | 'point' | 'three' | 'ok',
  holdS: number,
  extra: { roll?: number; handedness?: 'left' | 'right'; seed?: number; fps?: number } = {},
) {
  const base = { ...HOME, handedness: extra.handedness ?? 'right' } as const;
  return timeline({
    seconds: 0.8 + holdS + 0.8,
    seed: extra.seed ?? 5,
    ...(extra.fps ? { fps: extra.fps } : {}),
    keys: [
      { t: 0, hand: { ...base, shape: 'open', roll: 0 } },
      { t: 0.8, hand: { shape, roll: extra.roll ?? 0 } },
      // Hold the pose (keys interpolate continuous parameters such as roll).
      { t: 0.8 + Math.max(0, holdS - 0.04), hand: { roll: extra.roll ?? 0 } },
      { t: 0.8 + holdS, hand: { shape: 'open', roll: 0 } },
    ],
  });
}

/** Thumbs-up roll for a right hand (thumb pointing at the top of the frame). */
export const THUMB_UP_ROLL = -1.45;

/** Relaxed hand wandering slowly over the play area (idle / aiming without casting). */
export function idle(seconds: number, seed: number): LandmarksFrame[] {
  const r = rng(seed);
  const keys: Key[] = [];
  let cx = 0.5;
  let cy = 0.55;
  for (let t = 0; t <= seconds; t += 0.9 + r() * 1.4) {
    // Slow repositioning within a comfortable box (< ~1 palm width per second).
    cx = Math.min(0.68, Math.max(0.32, cx + (r() - 0.5) * 0.12));
    cy = Math.min(0.72, Math.max(0.38, cy + (r() - 0.5) * 0.1));
    keys.push({
      t,
      hand: {
        cx,
        cy,
        size: HOME.size * (0.96 + r() * 0.08),
        roll: (r() - 0.5) * 0.3,
        shape: r() < 0.7 ? 'relaxed' : 'open',
      },
    });
  }
  return timeline({ seconds, keys, seed, noise: 0.003 });
}

/** Greeting wave: lateral oscillation of `amp` (normalised x) at `hz`. */
export function wave(amp: number, hz: number, seconds = 3): LandmarksFrame[] {
  const keys: Key[] = [];
  const step = 1 / (hz * 8);
  for (let t = 0; t <= seconds; t += step) {
    keys.push({
      t,
      hand: {
        cx: HOME.cx + (t < 0.6 ? 0 : amp * Math.sin(2 * Math.PI * hz * (t - 0.6))),
        cy: HOME.cy,
        size: HOME.size,
        roll: t < 0.6 ? 0 : 0.25 * Math.sin(2 * Math.PI * hz * (t - 0.6)),
        shape: 'open',
      },
    });
  }
  return timeline({ seconds, keys });
}
