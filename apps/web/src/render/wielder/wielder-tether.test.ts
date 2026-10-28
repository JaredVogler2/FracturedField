import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { layTether, TETHER_MIN_PX, TETHER_SEGMENTS, tetherPoint } from './wielder-tether';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const N = (TETHER_SEGMENTS + 1) * 2;

function mid(pos: Float32Array, i: number): THREE.Vector3 {
  const a = v(pos[i * 6]!, pos[i * 6 + 1]!, pos[i * 6 + 2]!);
  const b = v(pos[i * 6 + 3]!, pos[i * 6 + 4]!, pos[i * 6 + 5]!);
  return a.add(b).multiplyScalar(0.5);
}
function width(pos: Float32Array, i: number): number {
  return v(pos[i * 6]!, pos[i * 6 + 1]!, pos[i * 6 + 2]!).distanceTo(
    v(pos[i * 6 + 3]!, pos[i * 6 + 4]!, pos[i * 6 + 5]!),
  );
}

describe('the spectral arm (7D, D10): hand to force point', () => {
  const hand = v(-11, 4.2, -13.5);
  const field = v(-4, 0.15, 2);
  const eye = v(0, 22, 26);

  it('runs from the hand to the force point, arcing above the chord', () => {
    const pos = new Float32Array(N * 3);
    layTether(hand, field, eye, pos, 0);
    expect(mid(pos, 0).distanceTo(hand)).toBeLessThan(1e-5);
    expect(mid(pos, TETHER_SEGMENTS).distanceTo(field)).toBeLessThan(1e-5);
    const top = tetherPoint(hand, field, 0.5, new THREE.Vector3());
    expect(top.y).toBeGreaterThan((hand.y + field.y) / 2 + 1);
    expect(mid(pos, TETHER_SEGMENTS / 2).distanceTo(top)).toBeLessThan(1e-5);
  });

  it('tapers from the hand to the field and faces the camera', () => {
    const pos = new Float32Array(N * 3);
    layTether(hand, field, eye, pos, 0);
    expect(width(pos, 0)).toBeCloseTo(0.14, 4); // float32 positions
    expect(width(pos, TETHER_SEGMENTS)).toBeCloseTo(0.09, 4);
    // Across the ribbon is square to the line of sight.
    const i = 10;
    const across = v(
      pos[i * 6 + 3]! - pos[i * 6]!,
      pos[i * 6 + 4]! - pos[i * 6 + 1]!,
      pos[i * 6 + 5]! - pos[i * 6 + 2]!,
    );
    const sight = eye.clone().sub(mid(pos, i));
    expect(Math.abs(across.normalize().dot(sight.normalize()))).toBeLessThan(1e-4);
  });

  it('keeps a least width on screen from far away, and says how wide it really is', () => {
    // One render pixel per metre of distance: 1/400 m (a phone sees the plinths from ~55 m).
    const pixel = 1 / 400;
    const far = v(0, 30, 60);
    const pos = new Float32Array(N * 3);
    const px = new Float32Array(N).fill(-1);
    layTether(hand, field, far, pos, 0, pixel, px);
    for (let i = 0; i <= TETHER_SEGMENTS; i++) {
      const onePx = far.distanceTo(mid(pos, i)) * pixel;
      expect(width(pos, i) / onePx).toBeGreaterThanOrEqual(TETHER_MIN_PX - 1e-3);
      // Both vertices of a sample carry its true width in pixels, under the least width here.
      const truth = (0.14 + (0.09 - 0.14) * (i / TETHER_SEGMENTS)) / onePx;
      expect(px[i * 2]).toBeCloseTo(truth, 2);
      expect(px[i * 2 + 1]).toBe(px[i * 2]);
      expect(px[i * 2]).toBeLessThan(TETHER_MIN_PX);
    }
    // Close up the arm is already wider than that: it is laid as without a least width.
    const near = new Float32Array(N * 3);
    const plain = new Float32Array(N * 3);
    layTether(hand, field, eye, near, 0, 1 / 4000, px);
    layTether(hand, field, eye, plain, 0);
    expect([...near]).toEqual([...plain]);
    expect(Math.min(...px)).toBeGreaterThan(TETHER_MIN_PX);
  });

  it('writes where it is told, and stays finite with the eye on the arc', () => {
    const pos = new Float32Array(N * 2 * 3).fill(7);
    layTether(hand, field, hand.clone(), pos, N);
    for (let k = 0; k < N * 3; k++) expect(pos[k]).toBe(7); // the first tether's slots untouched
    for (let k = N * 3; k < N * 6; k++) expect(Number.isFinite(pos[k])).toBe(true);
  });
});
