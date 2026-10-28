import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MERIDIAN_ARENA } from '@ff/game-data';
import { ATTRACT_PERIOD_S, attractPose } from './camera';
import { SUN_DIR } from './atmosphere';

/** Normalised device coordinates of a world point seen from a pose. */
function ndc(
  pose: ReturnType<typeof attractPose>,
  aspect: number,
  p: THREE.Vector3,
): THREE.Vector3 {
  const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 0.5, 1200);
  cam.position.copy(pose.position);
  cam.lookAt(pose.target);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return p.clone().project(cam);
}

describe('menu cinematic camera', () => {
  const L = MERIDIAN_ARENA.halfLength;
  const times = Array.from({ length: 16 }, (_, i) => (i / 16) * ATTRACT_PERIOD_S);
  const centre = new THREE.Vector3(0, 1, 0);
  const emberGate = new THREE.Vector3(-L, 3, 0);
  // Where the storm break sits in the sky (along the key light, far away).
  const breakAt = SUN_DIR.clone().multiplyScalar(400);

  it('landscape: beyond the TIDE end, the centre and the far gate framed, the break on the right', () => {
    for (const aspect of [16 / 9, 16 / 10, 2.16, 4 / 3])
      for (const t of times) {
        const pose = attractPose(t, aspect, { x: 0, z: 0 });
        const where = `t=${t.toFixed(1)} aspect=${aspect.toFixed(2)}`;
        // Outside the field and above its walls: nothing but sky and the arena in the way.
        expect(pose.position.x, where).toBeGreaterThan(L + 6);
        expect(pose.position.y).toBeGreaterThan(8);
        for (const p of [centre, emberGate]) {
          const v = ndc(pose, aspect, p);
          expect(Math.abs(v.x), where).toBeLessThan(0.95);
          expect(Math.abs(v.y), where).toBeLessThan(0.95);
          expect(v.z).toBeLessThan(1);
        }
        // The break lies in the right half of the view (the menu sits on the left).
        const cam = new THREE.PerspectiveCamera(pose.fov, aspect, 0.5, 1200);
        cam.position.copy(pose.position);
        cam.lookAt(pose.target);
        cam.updateMatrixWorld(true);
        const local = breakAt.clone().applyMatrix4(cam.matrixWorldInverse);
        expect(local.z, where).toBeLessThan(0); // in front
        expect(local.x, where).toBeGreaterThan(0); // right of centre
      }
  });

  it('portrait: down the axis, the far gate in the top half of the screen above the menu', () => {
    for (const aspect of [390 / 844, 393 / 852, 360 / 740])
      for (const t of times) {
        const pose = attractPose(t, aspect, { x: 0, z: 0 });
        expect(pose.position.x).toBeGreaterThan(L + 8);
        const gate = ndc(pose, aspect, emberGate);
        expect(Math.abs(gate.x)).toBeLessThan(0.6);
        expect(gate.y).toBeGreaterThan(0);
        expect(gate.y).toBeLessThan(1);
      }
  });

  it('is continuous (no cuts) and follows the core only partly', () => {
    const a = attractPose(10, 16 / 9);
    const b = attractPose(10.05, 16 / 9);
    expect(a.position.distanceTo(b.position)).toBeLessThan(0.1);
    const centred = attractPose(0, 16 / 9, { x: 0, z: 0 });
    const followed = attractPose(0, 16 / 9, { x: 15, z: 8 });
    const shift = followed.target.clone().sub(centred.target);
    expect(shift.x).toBeGreaterThan(0);
    expect(shift.x).toBeLessThan(15 * 0.5);
    expect(followed.position.equals(centred.position)).toBe(true);
  });

  it('writes into a given pose without allocating a new one', () => {
    const out = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0 };
    expect(attractPose(3, 16 / 9, undefined, out)).toBe(out);
    expect(out.fov).toBeGreaterThan(30);
  });
});
