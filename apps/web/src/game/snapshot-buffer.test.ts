import { describe, expect, it } from 'vitest';
import type { WorldSnapshot } from '@ff/protocol';
import { SnapshotBuffer } from './snapshot-buffer';

const TICK_MS = 1000 / 30;

/** A snapshot holding only the core at x, moving at vx m/s. */
function snap(tick: number, x: number, vx: number): WorldSnapshot {
  const core = { id: 1, kind: 'core', owner: -1, p: [x, 1.15, 0], q: [0, 0, 0, 1], v: [vx, 0, 0] };
  const player = { m: [0, 0] };
  return { tick, entities: [core], players: [player, player] } as unknown as WorldSnapshot;
}

describe('snapshot buffer: running ahead of the newest snapshot', () => {
  it('extrapolates a moving body at most ~100 ms (3 ticks) past the newest snapshot', () => {
    const buf = new SnapshotBuffer(TICK_MS, 1);
    buf.push(snap(10, 0, 12), 0);
    const f = buf.sample(1000); // a second with no newer snapshot
    expect(f.extrapolating).toBe(true);
    expect(f.entities.get(1)!.px).toBeCloseTo(12 * 0.1, 6);
  });

  it('with extrapolation off (the Physics Lab) shows the newest snapshot exactly', () => {
    const buf = new SnapshotBuffer(TICK_MS, 1);
    buf.maxExtrapolationTicks = 0;
    buf.push(snap(10, 0, 12), 0);
    const f = buf.sample(1000);
    expect(f.extrapolating).toBe(false);
    expect(f.entities.get(1)!.px).toBe(0);
  });

  it('still interpolates between snapshots either way', () => {
    for (const max of [3, 0]) {
      const buf = new SnapshotBuffer(TICK_MS, 1);
      buf.maxExtrapolationTicks = max;
      buf.push(snap(10, 0, 12), 0);
      buf.push(snap(11, 0.4, 12), TICK_MS);
      // Half a tick after the second arrives, one tick of delay: halfway between them.
      const f = buf.sample(TICK_MS * 1.5);
      expect(f.entities.get(1)!.px).toBeCloseTo(0.2, 6);
    }
  });
});
