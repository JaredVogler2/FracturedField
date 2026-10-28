import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bandGeometry, corePlateGeometry } from './core-geometry';

const R = 1.2;
/** Vertices per plate: outer face 3, inner face 3, three side walls of two triangles. */
const PER_PLATE = 3 + 3 + 3 * 6;

function attr(geo: THREE.BufferGeometry, name: string) {
  return geo.getAttribute(name) as THREE.BufferAttribute;
}

describe('core plates (7C, D09)', () => {
  it('a broken shell: most of the 80 faces become plates, some are left out, deterministic', () => {
    const geo = corePlateGeometry(R);
    const n = attr(geo, 'position').count;
    expect(n % PER_PLATE).toBe(0);
    const plates = n / PER_PLATE;
    expect(plates).toBeGreaterThan(50);
    expect(plates).toBeLessThan(80);
    expect(corePlateGeometry(R, { holes: 0 }).getAttribute('position').count).toBe(80 * PER_PLATE);
    const again = corePlateGeometry(R);
    expect(Array.from(attr(again, 'position').array)).toEqual(
      Array.from(attr(geo, 'position').array),
    );
    const other = corePlateGeometry(R, { seed: 8 });
    expect(Array.from(attr(other, 'position').array)).not.toEqual(
      Array.from(attr(geo, 'position').array),
    );
  });

  it('every attribute the material reads is present, one value per vertex, in range', () => {
    const geo = corePlateGeometry(R);
    const n = attr(geo, 'position').count;
    for (const [name, size] of [
      ['aDir', 3],
      ['aSide', 1],
      ['aDepth', 1],
      ['aBary', 3],
      ['aSeed', 1],
      ['normal', 3],
    ] as const) {
      expect(attr(geo, name).count, name).toBe(n);
      expect(attr(geo, name).itemSize, name).toBe(size);
    }
    const side = attr(geo, 'aSide');
    const depth = attr(geo, 'aDepth');
    const bary = attr(geo, 'aBary');
    const seed = attr(geo, 'aSeed');
    const dir = attr(geo, 'aDir');
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      expect([0, 1]).toContain(side.getX(i));
      expect(depth.getX(i)).toBeGreaterThanOrEqual(0);
      expect(depth.getX(i)).toBeLessThanOrEqual(1);
      expect(seed.getX(i)).toBeGreaterThanOrEqual(0);
      expect(seed.getX(i)).toBeLessThan(1);
      expect(Math.hypot(dir.getX(i), dir.getY(i), dir.getZ(i))).toBeCloseTo(1, 5);
      const b = bary.getX(i) + bary.getY(i) + bary.getZ(i);
      // The outer faces carry barycentric corners (sum 1); everything else is marked (1, 1, 1).
      if (side.getX(i) === 0 && depth.getX(i) === 0) expect(b).toBeCloseTo(1, 6);
      else expect(b).toBe(3);
      // Inside the shell's envelope (radius, lift and corner jitter).
      p.fromBufferAttribute(attr(geo, 'position'), i);
      expect(p.length()).toBeLessThan(R * 1.2);
      expect(p.length()).toBeGreaterThan(R * 0.6);
    }
  });

  it('outer faces face out, inner faces face the heart, walls face across the seams', () => {
    const geo = corePlateGeometry(R);
    const pos = attr(geo, 'position');
    const side = attr(geo, 'aSide');
    const depth = attr(geo, 'aDepth');
    const dir = attr(geo, 'aDir');
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const tri = new THREE.Triangle();
    const nrm = new THREE.Vector3();
    const g = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      tri.set(a, b, c).getNormal(nrm);
      g.fromBufferAttribute(dir, i);
      const isWall = side.getX(i) === 1;
      const isInner = !isWall && depth.getX(i) === 1;
      const d = nrm.dot(g);
      if (isWall) expect(Math.abs(d)).toBeLessThan(0.75);
      else if (isInner) expect(d).toBeLessThan(-0.6);
      else expect(d).toBeGreaterThan(0.6);
    }
  });
});

describe('gyroscope band (7C, D09)', () => {
  it('a closed ring of four faces per segment, glyph uv on the outer face only', () => {
    const segments = 48;
    const repeats = 5;
    const geo = bandGeometry(1.5, 0.05, 0.12, segments, repeats);
    const pos = attr(geo, 'position');
    const uv = attr(geo, 'uv');
    const normal = attr(geo, 'normal');
    expect(pos.count).toBe(segments * 4 * 6);
    let outer = 0;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      expect(Math.min(Math.abs(r - 1.5), Math.abs(r - 1.45))).toBeLessThan(1e-6);
      expect(Math.abs(Math.abs(pos.getY(i)) - 0.06)).toBeLessThan(1e-6);
      const v = uv.getY(i);
      if (v >= 0) {
        outer++;
        expect(v).toBeLessThanOrEqual(1);
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(repeats);
        // The engraved face looks outward.
        const radial = (pos.getX(i) * normal.getX(i) + pos.getZ(i) * normal.getZ(i)) / r;
        expect(radial).toBeGreaterThan(0.9);
      } else {
        expect(v).toBe(-1);
      }
    }
    expect(outer).toBe(segments * 6);
  });
});
