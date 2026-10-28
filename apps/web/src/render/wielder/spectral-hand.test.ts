import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  buildSpectralHand,
  fingerPath,
  placeSpectralHand,
  SPECTRAL_FINGERS,
} from './spectral-hand';

const at = (a: Float32Array, i: number) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

describe('spectral hand (7D, WP9): an open hand and a fist with one topology', () => {
  for (const segs of [8, 6]) {
    it(`builds both poses vertex for vertex, finite, with unit normals (${segs} around)`, () => {
      const h = buildSpectralHand(segs);
      for (const a of [h.open, h.fist, h.openNormal, h.fistNormal])
        expect(a.length).toBe(h.vertices * 3);
      for (const a of [h.open, h.fist, h.openNormal, h.fistNormal])
        for (const c of a) expect(Number.isFinite(c)).toBe(true);
      for (let i = 0; i < h.vertices; i++) {
        expect(at(h.openNormal, i).length()).toBeCloseTo(1, 5);
        expect(at(h.fistNormal, i).length()).toBeCloseTo(1, 5);
      }
      expect(Math.max(...h.index)).toBe(h.vertices - 1);
      expect(h.index.length % 3).toBe(0);
    });
  }

  it('is a hand one length long: fingers along +Z, wider than thick', () => {
    const h = buildSpectralHand();
    const box = new THREE.Box3().setFromArray(h.open);
    expect(box.max.z).toBeGreaterThan(0.85);
    expect(box.max.z).toBeLessThan(1.05);
    expect(box.min.z).toBeGreaterThan(-0.15);
    expect(box.max.x - box.min.x).toBeGreaterThan(0.4);
    expect(box.max.y - box.min.y).toBeLessThan(box.max.x - box.min.x);
  });

  it('closes into a fist: every fingertip comes back over the palm, below it', () => {
    for (const f of SPECTRAL_FINGERS.slice(0, 4)) {
      const open = fingerPath(f, f.open).at(-1)!;
      const fist = fingerPath(f, f.fist).at(-1)!;
      expect(fist.z).toBeLessThan(open.z - 0.25); // drawn back toward the wrist
      expect(fist.z).toBeLessThan(0.6); // over the palm's end, not beyond it
      expect(fist.y).toBeLessThan(-0.02); // curled under to the palm's side (tips meet the palm)
    }
    // The bones keep their length in either pose.
    for (const f of SPECTRAL_FINGERS) {
      const len = (path: THREE.Vector3[]) =>
        path.reduce((s, p, i) => (i ? s + p.distanceTo(path[i - 1]!) : 0), 0);
      expect(len(fingerPath(f, f.open))).toBeCloseTo(f.length, 6);
      expect(len(fingerPath(f, f.fist))).toBeCloseTo(f.length, 6);
    }
  });
});

describe('placing a spectral hand (7D, WP9)', () => {
  const centre = new THREE.Vector3(-4, 1.35, 2);
  const wielder = new THREE.Vector3(-11.5, 1.72, -14.9);

  it('reaches away from its wielder, tipped down onto the field, its wrist behind the centre', () => {
    const m = new THREE.Matrix4();
    const wrist = placeSpectralHand(centre, wielder, false, 0.9, 0.35, m, new THREE.Vector3());
    const fingers = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const away = new THREE.Vector3(centre.x - wielder.x, 0, centre.z - wielder.z).normalize();
    expect(new THREE.Vector3(fingers.x, 0, fingers.z).normalize().dot(away)).toBeCloseTo(1, 6);
    expect(fingers.y).toBeCloseTo(-Math.sin(0.35), 6);
    expect(wrist.distanceTo(centre)).toBeCloseTo(0.45 * 0.9, 6);
    expect(new THREE.Vector3().setFromMatrixPosition(m).distanceTo(wrist)).toBeLessThan(1e-9);
    // The back of the hand faces up; the hand is its size.
    expect(new THREE.Vector3(0, 1, 0).transformDirection(m).y).toBeGreaterThan(0.9);
    expect(new THREE.Vector3().setFromMatrixScale(m).x).toBeCloseTo(0.9, 6);
    expect(m.determinant()).toBeGreaterThan(0);
  });

  it('twists about the vertical: a quarter turn swings the fingers a quarter round', () => {
    const a = new THREE.Matrix4();
    const b = new THREE.Matrix4();
    placeSpectralHand(centre, wielder, false, 0.9, 0.35, a, new THREE.Vector3());
    const wrist = placeSpectralHand(
      centre,
      wielder,
      false,
      0.9,
      0.35,
      b,
      new THREE.Vector3(),
      Math.PI / 2,
    );
    const flat = (m: THREE.Matrix4) => {
      const f = new THREE.Vector3(0, 0, 1).transformDirection(m);
      return new THREE.Vector3(f.x, 0, f.z).normalize();
    };
    expect(flat(a).dot(flat(b))).toBeCloseTo(0, 6);
    expect(new THREE.Vector3(0, 0, 1).transformDirection(b).y).toBeCloseTo(-Math.sin(0.35), 6);
    expect(wrist.distanceTo(centre)).toBeCloseTo(0.45 * 0.9, 6); // turning round its centre
  });

  it('a left hand is the mirror image of a right one', () => {
    const r = new THREE.Matrix4();
    const l = new THREE.Matrix4();
    placeSpectralHand(centre, wielder, false, 0.9, 0.35, r, new THREE.Vector3());
    placeSpectralHand(centre, wielder, true, 0.9, 0.35, l, new THREE.Vector3());
    expect(l.determinant()).toBeLessThan(0);
    const thumb = (m: THREE.Matrix4) => new THREE.Vector3(1, 0, 0).transformDirection(m);
    expect(thumb(l).dot(thumb(r))).toBeCloseTo(-1, 6);
  });
});
