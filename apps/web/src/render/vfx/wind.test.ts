import { describe, expect, it } from 'vitest';
import { DEFAULT_ABILITIES } from '@ff/game-data';
import type { EffectSnapshot } from '@ff/protocol';
import { windAt } from './wind';

const SWEEP = DEFAULT_ABILITIES.sweep;

function sweep(over: Partial<EffectSnapshot> = {}): EffectSnapshot {
  return {
    id: 1,
    kind: 'sweep',
    owner: 0,
    p: [0, 0, 0],
    r: SWEEP.radius,
    ttl: 30,
    maxTtl: 54,
    s: 1,
    d: [0, -1],
    ...over,
  };
}

describe('the crosswind the flames lean in (mirrors the authority’s sweep falloff)', () => {
  it('is full strength at the centre of a running sweep, along its direction', () => {
    const w = windAt([sweep()], 0, 0);
    expect(w.x).toBeCloseTo(0, 6);
    expect(w.z).toBeCloseTo(-SWEEP.windAcceleration, 6);
  });

  it('falls off smoothly to zero at the edge and is zero outside', () => {
    const half = windAt([sweep()], SWEEP.radius / 2, 0);
    // smoothstep(0.5) = 0.5
    expect(half.z).toBeCloseTo(-SWEEP.windAcceleration * 0.5, 6);
    expect(windAt([sweep()], SWEEP.radius, 0).z).toBe(0);
    expect(windAt([sweep()], 0, SWEEP.radius + 1).z).toBe(0);
  });

  it('fades in over the first ticks and out over the last ones, and sums sweeps', () => {
    expect(windAt([sweep({ ttl: 54, maxTtl: 54 })], 0, 0).z).toBeCloseTo(
      -SWEEP.windAcceleration / 4,
      6,
    );
    expect(windAt([sweep({ ttl: 3 })], 0, 0).z).toBeCloseTo(-SWEEP.windAcceleration / 2, 6);
    const two = windAt([sweep(), sweep({ id: 2, d: [1, 0] })], 0, 0);
    expect(two.x).toBeCloseTo(SWEEP.windAcceleration, 6);
    expect(two.z).toBeCloseTo(-SWEEP.windAcceleration, 6);
  });

  it('ignores other effects and bad numbers', () => {
    const pool = { ...sweep(), kind: 'pool' as const };
    expect(windAt([pool], 0, 0)).toEqual({ x: 0, z: 0 });
    const w = windAt([sweep()], Number.NaN, 0);
    expect(w).toEqual({ x: 0, z: 0 });
  });
});
