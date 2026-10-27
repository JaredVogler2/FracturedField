import { describe, expect, it } from 'vitest';
import type { ActionIntent } from '@ff/protocol';
import { IntentEmitter, worldToAim } from '../src/index.js';

describe('IntentEmitter', () => {
  it('sequences intents, clamps values and throttles aim', () => {
    const out: ActionIntent[] = [];
    const e = new IntentEmitter(0, 'touch', (_s, i) => out.push(i), 10);
    e.aim([2, Number.NaN], 0);
    e.aim([0.5, 0.5], 20); // throttled (< 100 ms)
    e.aim([0.5, 0.5], 150);
    e.edge({ action: 'pulse', phase: 'tap', intensity: 7 }, [0.1, 0.1], 160);
    expect(out.map((i) => i.seq)).toEqual([0, 1, 2]);
    expect(out[0]!.aim).toEqual([1, 0]);
    expect(out[2]!.intensity).toBe(1);
    expect(out.every((i) => i.source === 'touch')).toBe(true);
  });

  it('releases held abilities exactly once', () => {
    const out: ActionIntent[] = [];
    const e = new IntentEmitter(1, 'keyboard', (_s, i) => out.push(i));
    e.edge({ action: 'lift', phase: 'start' }, [0, 0], 0);
    e.releaseAll(10);
    e.releaseAll(20);
    e.edge({ action: 'lift', phase: 'end' }, [0, 0], 30);
    expect(out.map((i) => `${i.action}:${i.phase}`)).toEqual(['lift:start', 'lift:end']);
  });

  it('carries the hand channel: clamped, sent on change, kept alive while described, opened once when dropped', () => {
    const out: ActionIntent[] = [];
    const e = new IntentEmitter(0, 'camera', (_s, i) => out.push(i), 15);
    const at = (t: number, grip: number, push = 0, twist = 0) =>
      e.aim([0.2, 0.1], t, false, { grip, push, twist });
    at(0, Number.NaN, 7, -7); // hostile values clamp
    expect(out.at(-1)!.hand).toEqual({ grip: 0, push: 1, twist: -1 });
    at(100, 0.2); // aim still, but the hand changed
    expect(out).toHaveLength(2);
    at(120, 0.21); // within the throttle and below the change threshold: nothing
    expect(out).toHaveLength(2);
    // A described hand — closed, or open and still — is re-sent every keep-alive interval, so the
    // authority never takes it for gone.
    for (let t = 200; t <= 1000; t += 16) at(t, 1);
    for (let t = 1016; t <= 1800; t += 16) at(t, 0);
    const kept = out.filter((i) => i.clientTime >= 200).map((i) => i.clientTime);
    for (let k = 1; k < kept.length; k++) expect(kept[k]! - kept[k - 1]!).toBeLessThanOrEqual(120);
    expect(out.at(-1)!.hand).toEqual({ grip: 0, push: 0, twist: 0 });
    // An input that stops describing a hand opens it once (what it held is let go at once), then
    // sends plain aims; inputs that never describe one send none.
    at(2000, 1);
    e.aim([0.5, 0.5], 2200);
    expect(out.at(-1)!.hand).toEqual({ grip: 0, push: 0, twist: 0 });
    e.aim([0.6, 0.5], 2400);
    expect(out.at(-1)!.hand).toBeUndefined();
  });

  it('maps world metres to normalized aim', () => {
    expect(worldToAim(21, -12.5, { halfLength: 21, halfWidth: 12.5 })).toEqual([1, -1]);
    expect(worldToAim(1e9, Number.NaN, { halfLength: 21, halfWidth: 12.5 })).toEqual([1, 0]);
  });
});
