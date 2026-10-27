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

  it('maps world metres to normalized aim', () => {
    expect(worldToAim(21, -12.5, { halfLength: 21, halfWidth: 12.5 })).toEqual([1, -1]);
    expect(worldToAim(1e9, Number.NaN, { halfLength: 21, halfWidth: 12.5 })).toEqual([1, 0]);
  });
});
