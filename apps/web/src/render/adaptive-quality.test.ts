/**
 * Adaptive quality: steps down only under sustained low frame rates, back up only after a long
 * comfortable stretch, never above the starting tier, never on a single hitch, and never
 * oscillates between thresholds.
 */
import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, type TierName } from './adaptive-quality';

/** Runs `seconds` of frames at `fps` from time `t0` (ms); returns the changes and the end time. */
function run(q: AdaptiveQuality, fps: number, seconds: number, t0: number) {
  const changes: { at: number; tier: TierName }[] = [];
  const dt = 1000 / fps;
  let t = t0;
  for (let n = 0; n < seconds * fps; n++) {
    t += dt;
    const c = q.sample(dt, t);
    if (c) changes.push({ at: t, tier: c });
  }
  return { changes, t };
}

describe('AdaptiveQuality', () => {
  it('holds steady at 60 fps', () => {
    const q = new AdaptiveQuality('high');
    expect(run(q, 60, 60, 0).changes).toEqual([]);
    expect(q.tier).toBe('high');
  });

  it('steps down once after ≥ 5 s of sustained low frame rate, then waits before the next step', () => {
    const q = new AdaptiveQuality('high');
    const a = run(q, 60, 3, 0);
    const b = run(q, 25, 7, a.t);
    expect(b.changes.map((c) => c.tier)).toEqual(['medium']);
    // The smoothed rate takes a moment to fall, then must stay low for the 5 s hold.
    expect(b.changes[0]!.at - a.t).toBeGreaterThanOrEqual(5000);
    // Still slow: the next step needs the cooldown plus another full hold.
    const c = run(q, 25, 14, b.t);
    expect(c.changes.map((x) => x.tier)).toEqual(['low']);
    expect(c.changes[0]!.at - b.changes[0]!.at).toBeGreaterThanOrEqual(8000 + 5000);
    // And it never goes below low.
    expect(run(q, 10, 30, c.t).changes).toEqual([]);
  });

  it('ignores a short dip and single hitches', () => {
    const q = new AdaptiveQuality('high');
    let t = run(q, 60, 5, 0).t;
    t = run(q, 20, 2, t).t; // a 2 s dip
    const after = run(q, 60, 10, t);
    expect(after.changes).toEqual([]);
    // Hitches (a 2 s frame, e.g. a tab switch) are not load.
    for (let i = 0; i < 20; i++) expect(q.sample(2000, after.t + i * 2000)).toBeNull();
    expect(q.tier).toBe('high');
  });

  it('steps back up after a long comfortable stretch, never above the starting tier', () => {
    const q = new AdaptiveQuality('medium');
    let r = run(q, 25, 8, 0);
    expect(q.tier).toBe('low');
    r = run(q, 60, 30, r.t);
    expect(r.changes.map((c) => c.tier)).toEqual(['medium']);
    // Comfortable for ages: still medium (the device class ceiling).
    expect(run(q, 60, 120, r.t).changes).toEqual([]);
    expect(q.tier).toBe('medium');
  });

  it('does not oscillate between the thresholds', () => {
    const q = new AdaptiveQuality('high');
    const r = run(q, 25, 8, 0);
    expect(q.tier).toBe('medium');
    // 48 fps is neither low enough to step down nor high enough to step up.
    expect(run(q, 48, 120, r.t).changes).toEqual([]);
  });
});
