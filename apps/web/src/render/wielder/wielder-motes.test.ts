import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { layMotes, moteCorner, MOTES } from './wielder-motes';

const right = new THREE.Vector3(1, 0, 0);
const up = new THREE.Vector3(0, 1, 0);

function quad(pos: Float32Array, k: number): THREE.Vector3[] {
  return [0, 1, 2, 3].map(
    (c) =>
      new THREE.Vector3(pos[(k * 4 + c) * 3], pos[(k * 4 + c) * 3 + 1], pos[(k * 4 + c) * 3 + 2]),
  );
}

describe('energy motes (7D, D10): sparks about the hands', () => {
  it('orbit within their spread of the centre, square to the camera, each its size', () => {
    const centre = new THREE.Vector3(-11, 4, -14);
    const pos = new Float32Array(MOTES * 4 * 3);
    const glow = new Float32Array(MOTES * 4);
    for (const t of [0, 0.7, 3.1]) {
      layMotes(centre, 0.2, 0.05, 1, t, right, up, pos, glow, 0);
      for (let k = 0; k < MOTES; k++) {
        const q = quad(pos, k);
        const mid = q.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(0.25);
        expect(mid.distanceTo(centre)).toBeLessThanOrEqual(0.2 + 1e-5);
        // corners spread along the camera's right and up only, within the mote's size
        for (const c of q) expect(Math.abs(c.z - mid.z)).toBeLessThan(1e-5);
        const w = q[1]!.x - q[0]!.x;
        expect(w).toBeGreaterThan(0.05 * 0.7 - 1e-5);
        expect(w).toBeLessThan(0.05 * 1.3 + 1e-5);
        expect(moteCorner(1)[0]).toBe(1);
        expect(Math.sign(q[1]!.x - mid.x)).toBe(moteCorner(1)[0]);
        expect(Math.sign(q[2]!.y - mid.y)).toBe(moteCorner(2)[1]);
      }
    }
  });

  it('move from frame to frame, flicker, and go dark with the wielder', () => {
    const c = new THREE.Vector3();
    const a = new Float32Array(MOTES * 12);
    const b = new Float32Array(MOTES * 12);
    const ga = new Float32Array(MOTES * 4);
    const gb = new Float32Array(MOTES * 4);
    layMotes(c, 0.2, 0.05, 1, 1, right, up, a, ga, 0);
    layMotes(c, 0.2, 0.05, 1, 1 + 1 / 60, right, up, b, gb, 0);
    let moved = 0;
    for (let i = 0; i < a.length; i++) moved = Math.max(moved, Math.abs(a[i]! - b[i]!));
    expect(moved).toBeGreaterThan(1e-3);
    expect(moved).toBeLessThan(0.05); // no jump between frames
    expect(Math.max(...ga)).toBeLessThanOrEqual(1);
    expect(Math.min(...ga)).toBeGreaterThanOrEqual(0.45 - 1e-6);
    layMotes(c, 0.2, 0.05, 0, 1, right, up, a, ga, 0);
    expect(Math.max(...ga)).toBe(0);
  });

  it('writes only its own slots', () => {
    const pos = new Float32Array(MOTES * 4 * 3 * 2).fill(9);
    const glow = new Float32Array(MOTES * 4 * 2).fill(9);
    layMotes(new THREE.Vector3(), 0.2, 0.05, 1, 0, right, up, pos, glow, MOTES * 4);
    for (let i = 0; i < MOTES * 4 * 3; i++) expect(pos[i]).toBe(9);
    for (let i = 0; i < MOTES * 4; i++) expect(glow[i]).toBe(9);
  });
});
