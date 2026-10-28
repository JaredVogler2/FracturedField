import { describe, expect, it } from 'vitest';
import { DEFAULT_ABILITIES } from '@ff/game-data';
import { guardColumns } from './guard-columns';

const G = DEFAULT_ABILITIES.guard;

describe('the guard’s basalt columns (7C, D09) stay inside the barrier’s collider', () => {
  const cols = guardColumns();

  it('every column is inside the box: width, depth and height', () => {
    expect(cols.length).toBeGreaterThan(10);
    for (const c of cols) {
      expect(Math.abs(c.x) + c.radius).toBeLessThanOrEqual(G.halfWidth + 1e-9);
      expect(Math.abs(c.z) + c.radius).toBeLessThanOrEqual(G.halfDepth + 1e-9);
      expect(c.height).toBeLessThanOrEqual(G.halfHeight * 2);
      expect(c.height).toBeGreaterThanOrEqual(G.halfHeight * 2 * 0.88);
    }
  });

  it('they fill it: the wall reads as the barrier the core bounces off', () => {
    const left = Math.min(...cols.map((c) => c.x - c.radius));
    const right = Math.max(...cols.map((c) => c.x + c.radius));
    expect(right - left).toBeGreaterThan(G.halfWidth * 2 * 0.95);
    // Two rows, front and back.
    expect(new Set(cols.map((c) => Math.sign(c.z))).size).toBe(2);
  });

  it('the middle rises first and the whole wall is up within a third of a second', () => {
    const mid = cols.reduce((a, b) => (Math.abs(a.x) < Math.abs(b.x) ? a : b));
    const edge = cols.reduce((a, b) => (Math.abs(a.x) > Math.abs(b.x) ? a : b));
    expect(mid.delay).toBeLessThan(edge.delay);
    expect(Math.max(...cols.map((c) => c.delay))).toBeLessThan(0.13);
  });

  it('is the same wall every time (no per-device randomness)', () => {
    expect(guardColumns()).toEqual(cols);
  });
});
