import { describe, expect, it } from 'vitest';
import { BOLT_POINTS, MAIN_LEVELS, MAX_FORKS, boltPaths } from './bolt-path';

const A: [number, number, number] = [0, 0.6, 0];
const B: [number, number, number] = [6, 0.9, 2];
const LEN = Math.hypot(6, 0.3, 2);

function point(p: Float32Array, i: number): [number, number, number] {
  return [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
}

/** Distance from q to the segment a–b. */
function offLine(q: [number, number, number]): number {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const w = [q[0] - A[0], q[1] - A[1], q[2] - A[2]];
  const t = Math.max(0, Math.min(1, (w[0]! * d[0]! + w[1]! * d[1]! + w[2]! * d[2]!) / LEN ** 2));
  return Math.hypot(w[0]! - d[0]! * t, w[1]! - d[1]! * t, w[2]! - d[2]! * t);
}

describe('charge arc paths (7C, D09): jagged, forked, the same for the same discharge', () => {
  it('the main path runs exactly from one conductor to the other', () => {
    const b = boltPaths(A, B, 1234);
    const [start, count] = b.paths[0]!;
    expect(count).toBe((1 << MAIN_LEVELS) + 1);
    expect(point(b.points, start)).toEqual(A.map(Math.fround));
    const end = point(b.points, start + count - 1);
    for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(B[i]!, 5);
  });

  it('is jagged but stays near the line between them', () => {
    const b = boltPaths(A, B, 99);
    const [start, count] = b.paths[0]!;
    let most = 0;
    for (let i = start; i < start + count; i++) most = Math.max(most, offLine(point(b.points, i)));
    expect(most).toBeGreaterThan(0.02 * LEN);
    expect(most).toBeLessThan(0.45 * LEN);
  });

  it('forks: one to three, each starting on the main path, dimmer than it', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const b = boltPaths(A, B, seed);
      const forks = b.paths.length - 1;
      expect(forks).toBeGreaterThanOrEqual(1);
      expect(forks).toBeLessThanOrEqual(MAX_FORKS);
      const used = b.paths.reduce((n, [, c]) => n + c, 0);
      expect(used).toBeLessThanOrEqual(BOLT_POINTS);
      const [m0, mc] = b.paths[0]!;
      for (let f = 1; f < b.paths.length; f++) {
        const from = point(b.points, b.paths[f]![0]);
        let onMain = false;
        for (let i = m0; i < m0 + mc; i++) {
          const q = point(b.points, i);
          if (Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2]) < 1e-5) onMain = true;
        }
        expect(onMain).toBe(true);
        expect(b.weight[f]).toBeLessThan(1);
      }
    }
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = boltPaths(A, B, 777);
    const again = boltPaths(A, B, 777);
    expect(Array.from(again.points)).toEqual(Array.from(a.points));
    expect(again.paths).toEqual(a.paths);
    const other = boltPaths(A, B, 778);
    expect(Array.from(other.points)).not.toEqual(Array.from(a.points));
  });

  it('never produces a NaN, even for coincident or vertical endpoints', () => {
    for (const b of [A, [0, 3, 0] as [number, number, number]]) {
      const out = boltPaths(A, b, 5);
      const used = out.paths.reduce((n, [, c]) => n + c, 0);
      for (let i = 0; i < used * 3; i++) expect(Number.isFinite(out.points[i])).toBe(true);
    }
  });
});
