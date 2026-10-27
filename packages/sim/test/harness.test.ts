import { describe, expect, it } from 'vitest';
import { runPhysicsHarness, HARNESS_TICKS } from '../src/index.js';
import golden from './golden/harness-100.json';

describe('Phase 01 physics harness', () => {
  it('steps exactly 100 fixed ticks and matches the golden output bit-for-bit', async () => {
    const result = await runPhysicsHarness();
    expect(result.ticks).toBe(HARNESS_TICKS);
    expect(result).toEqual(golden);
  });

  it('records a real wall collision and a goal crossing in the correct direction', async () => {
    const result = await runPhysicsHarness();
    expect(result.impactCount).toBeGreaterThan(0);
    expect(result.firstImpacts[0]?.b).toBe(-1); // static arena geometry
    expect(result.goal).toEqual({ scorer: 0, tick: 86 });
  });

  it('is repeatable within one runtime', async () => {
    const a = await runPhysicsHarness();
    const b = await runPhysicsHarness();
    expect(b.hash).toBe(a.hash);
  });
});
