import { DEFAULT_ABILITIES } from '@ff/game-data';
import type { EffectSnapshot } from '@ff/protocol';

const SWEEP = DEFAULT_ABILITIES.sweep;

/**
 * The crosswind at a point (m/s², world x and z) from the snapshot's SWEEP fields, with the same
 * smooth radial falloff and fades as the authority's own `windAt`. Visual only: flames lean, embers
 * and smoke drift with it; the authority moves the flames themselves.
 */
export function windAt(
  effects: readonly EffectSnapshot[],
  x: number,
  z: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  out.x = 0;
  out.z = 0;
  for (const fx of effects) {
    if (fx.kind !== 'sweep') continue;
    const r = Math.hypot(x - fx.p[0], z - fx.p[2]);
    if (!(r < fx.r)) continue;
    const life = Math.max(0, Math.min(1, fx.ttl / 6, (fx.maxTtl - fx.ttl + 1) / 4));
    const k = 1 - r / fx.r;
    const a = SWEEP.windAcceleration * (k * k * (3 - 2 * k)) * life;
    out.x += fx.d[0] * a;
    out.z += fx.d[1] * a;
  }
  return out;
}
