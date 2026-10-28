import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_RULES } from '@ff/game-data';
import { iceCrystalGeometry } from './water-ice';

const TOP = DEFAULT_RULES.elements.ice.topScale;

describe('ice plate (7C, D09): faceted, but the collider’s own frustum', () => {
  it('every corner stays within 5 % of the collider (base radius 1, top topScale, height 1)', () => {
    const g = iceCrystalGeometry();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      expect(v.y).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(v.y).toBeLessThanOrEqual(0.5 + 1e-6);
      const radial = Math.hypot(v.x, v.z);
      if (radial < 1e-4) continue;
      // The frustum's radius at the corner's original height (within the height jitter).
      const rAt = (y: number) => 1 + (TOP - 1) * (y + 0.5);
      const lo = Math.min(rAt(v.y - 0.07), rAt(v.y + 0.07));
      const hi = Math.max(rAt(v.y - 0.07), rAt(v.y + 0.07));
      expect(radial).toBeGreaterThan(lo * 0.95);
      expect(radial).toBeLessThan(hi * 1.05);
    }
  });

  it('closed: shared corners moved together (no gaps between facets)', () => {
    const g = iceCrystalGeometry();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    // Every edge of the triangle soup is shared by exactly two triangles.
    // Rounded, with -0 (the seam's sin 2π) read as 0.
    const r = (x: number) => String(Math.round(x * 1e4) / 1e4 + 0);
    const key = (i: number) => `${r(pos.getX(i))},${r(pos.getY(i))},${r(pos.getZ(i))}`;
    const edges = new Map<string, number>();
    for (let t = 0; t < pos.count; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = key(t + k);
        const b = key(t + ((k + 1) % 3));
        const e = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    for (const n of edges.values()) expect(n).toBe(2);
  });

  it('faceted: flat normals, one per triangle, facing out of the plate', () => {
    const g = iceCrystalGeometry();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      n.fromBufferAttribute(nrm, t);
      for (let k = 1; k < 3; k++) {
        expect(nrm.getX(t + k)).toBeCloseTo(n.x, 5);
        expect(nrm.getY(t + k)).toBeCloseTo(n.y, 5);
        expect(nrm.getZ(t + k)).toBeCloseTo(n.z, 5);
      }
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++)
        c.add(new THREE.Vector3().fromBufferAttribute(pos, t + k).divideScalar(3));
      // Out of the plate: away from its axis on the sides, up on the top, down on the base.
      const out = new THREE.Vector3(c.x, 0, c.z);
      if (c.y > 0.49) out.set(0, 1, 0);
      else if (c.y < -0.49) out.set(0, -1, 0);
      expect(n.dot(out.normalize())).toBeGreaterThan(0);
    }
  });
});
