import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advanceTrail, newTrailPath, restartTrail, type TrailPath } from './trail-path';

const N = 32;
const STEP = 0.18;
const TELEPORT = 3;

/** Flies a core along +x at `speed` m/s for `seconds`, rendered at `fps`. */
function fly(speed: number, seconds: number, fps: number): TrailPath {
  const path = newTrailPath(N);
  const p = new THREE.Vector3();
  const frames = Math.round(seconds * fps);
  for (let f = 0; f <= frames; f++) {
    p.set((speed * f) / fps, 1.15, 0);
    advanceTrail(path, p, STEP, TELEPORT);
  }
  return path;
}

function laid(path: TrailPath): number[] {
  return path.points.slice(1, path.count).map((v) => v.x);
}

describe('the core trail path (7C)', () => {
  it('a slow core leaves a trail: one sample each step it travels, not each frame', () => {
    // 3 m/s at 120 fps moves 0.025 m a frame, far under a step; it still covers 1.5 m in 0.5 s.
    const path = fly(3, 0.5, 120);
    expect(path.count).toBe(2 + Math.floor(1.5 / STEP + 1e-9));
    const xs = laid(path);
    for (let i = 1; i < xs.length; i++) expect(xs[i - 1]! - xs[i]!).toBeCloseTo(STEP, 6);
  });

  it('the same flight lays the same samples at 30, 60 and 144 fps', () => {
    // Half a second is whole frames at every rate; 4.55 m is not a whole number of steps.
    const ref = laid(fly(9.1, 0.5, 60));
    expect(ref.length).toBe(1 + 25); // where it started, then 25 whole steps
    for (const fps of [30, 144]) {
      const xs = laid(fly(9.1, 0.5, fps));
      expect(xs.length).toBe(ref.length);
      xs.forEach((x, i) => expect(x).toBeCloseTo(ref[i]!, 6));
    }
  });

  it('a long frame lays every sample it skipped, on the line between', () => {
    const path = newTrailPath(N);
    advanceTrail(path, new THREE.Vector3(0, 1, 0), STEP, TELEPORT);
    advanceTrail(path, new THREE.Vector3(1, 1, 1), STEP, TELEPORT); // ~1.41 m in one frame
    expect(path.count).toBe(2 + Math.floor(Math.SQRT2 / STEP));
    for (const v of path.points.slice(1, path.count)) {
      expect(v.x).toBeCloseTo(v.z, 9);
      expect(v.y).toBe(1);
    }
    expect(path.points[0]!.toArray()).toEqual([1, 1, 1]);
  });

  it('never grows past its sample count: the trail is at most N steps long', () => {
    const path = fly(20, 3, 60);
    expect(path.count).toBe(N);
    const length = path.points[0]!.x - path.points[N - 1]!.x;
    expect(length).toBeLessThanOrEqual(N * STEP);
    expect(length).toBeGreaterThan((N - 2) * STEP);
  });

  it('a teleport (the kickoff reset) starts the path over where the core lands', () => {
    const path = fly(12, 0.5, 60);
    const at = new THREE.Vector3(0, 1.15, 0);
    advanceTrail(path, new THREE.Vector3(20, 1.15, 0), STEP, TELEPORT);
    advanceTrail(path, at, STEP, TELEPORT);
    expect(path.count).toBe(2);
    for (const v of path.points) expect(v.equals(at)).toBe(true);
  });

  it('a restart collapses every point onto the core', () => {
    const path = fly(12, 0.5, 60);
    const at = new THREE.Vector3(4, 1.15, -2);
    restartTrail(path, at);
    expect(path.count).toBe(2);
    for (const v of path.points) expect(v.equals(at)).toBe(true);
  });
});
