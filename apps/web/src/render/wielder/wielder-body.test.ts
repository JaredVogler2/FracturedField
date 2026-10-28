import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BONES, buildBody, buildSkeleton, GLOW, restJoints, WIELDER_LOOKS } from './wielder-body';
import { RIG } from './wielder-rig';

describe('wielder body (7D, D10): a skinned, original character in one mesh', () => {
  it('builds the skeleton in the rest pose, each bone at its joint', () => {
    const { bones, root, skeleton } = buildSkeleton();
    expect(bones).toHaveLength(BONES.length);
    expect(skeleton.bones).toHaveLength(BONES.length);
    expect(root.name).toBe('root');
    const joints = restJoints();
    const p = new THREE.Vector3();
    for (const b of bones) {
      b.getWorldPosition(p);
      expect(p.distanceTo(joints[b.name as keyof typeof joints])).toBeLessThan(1e-9);
    }
    // Limb lengths are the rig's.
    expect(joints['foreArm.L'].distanceTo(joints['upperArm.L'])).toBeCloseTo(RIG.arm.upper, 9);
    expect(joints['hand.L'].distanceTo(joints['foreArm.L'])).toBeCloseTo(RIG.arm.lower, 9);
    expect(joints['shin.R'].distanceTo(joints['thigh.R'])).toBeCloseTo(RIG.leg.upper, 9);
    expect(joints['foot.R'].distanceTo(joints['shin.R'])).toBeCloseTo(RIG.leg.lower, 9);
  });

  for (const detail of [1, 0]) {
    it(`is fully skinned and stands on its soles (detail ${detail})`, () => {
      const g = buildBody(WIELDER_LOOKS[0], detail);
      const n = g.attributes.position!.count;
      for (const name of ['normal', 'color', 'aMat', 'skinIndex', 'skinWeight'])
        expect(g.attributes[name]!.count).toBe(n);
      const si = g.attributes.skinIndex!.array;
      const sw = g.attributes.skinWeight!.array;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          expect(si[i * 4 + k]).toBeLessThan(BONES.length);
          sum += sw[i * 4 + k]!;
        }
        expect(sum).toBeCloseTo(1, 6);
      }
      g.computeBoundingBox();
      const box = g.boundingBox!;
      expect(box.min.y).toBeGreaterThanOrEqual(0);
      expect(box.min.y).toBeLessThan(0.01); // the soles on the plinth
      expect(box.max.y).toBeGreaterThan(RIG.crownY - 0.01);
      expect(box.max.y).toBeLessThan(RIG.crownY + 0.05);
      expect(box.max.x).toBeCloseTo(-box.min.x, 1); // as wide to either side
      expect(box.max.x).toBeLessThan(0.5);
      for (const c of g.attributes.position!.array) expect(Number.isFinite(c)).toBe(true);
    });
  }

  it('has fewer vertices on the low tier', () => {
    const hi = buildBody(WIELDER_LOOKS[1], 1).attributes.position!.count;
    const lo = buildBody(WIELDER_LOOKS[1], 0).attributes.position!.count;
    expect(lo).toBeLessThan(hi * 0.75);
    expect(hi).toBeLessThan(6000);
  });

  it('faces outward: the torso’s normals point away from the spine', () => {
    const g = buildBody(WIELDER_LOOKS[0], 1);
    const pos = g.attributes.position!;
    const nor = g.attributes.normal!;
    const mat = g.attributes.aMat!;
    let out = 0;
    let all = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // The coat's fabric over the chest between the arms, its back half: the sash (a thin closed
      // ribbon in front) and the conductor ring's metal tubes rightly face every way.
      if (y < 1.2 || y > 1.4 || Math.abs(x) > 0.16 || z > 0 || mat.getY(i) > 0.5) continue;
      all++;
      if (nor.getX(i) * x + nor.getZ(i) * z > 0) out++;
    }
    expect(all).toBeGreaterThan(12);
    expect(out / all).toBeGreaterThan(0.9);
  });

  it('faces outward everywhere: limbs, boots, feet and the coat’s skirt (no part inside out)', () => {
    const g = buildBody(WIELDER_LOOKS[0], 1);
    const j = restJoints();
    const pos = g.attributes.position!;
    const nor = g.attributes.normal!;
    const tally: Record<string, [number, number]> = {};
    const count = (part: string, out: boolean) => {
      const t = (tally[part] ??= [0, 0]);
      t[out ? 0 : 1]++;
    };
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    /** Nearest point of segment a→b to p, and how far along it (0..1). */
    const near = (a: THREE.Vector3, b: THREE.Vector3) => {
      const ab = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      return { q: a.clone().addScaledVector(ab, t), t };
    };
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      for (const s of ['L', 'R'] as const) {
        const segments: [string, THREE.Vector3, THREE.Vector3, number, number, number][] = [
          ['upper arm', j[`upperArm.${s}`], j[`foreArm.${s}`], 0.45, 0.85, 0.065],
          ['thigh', j[`thigh.${s}`], j[`shin.${s}`], 0.3, 0.8, 0.11],
          ['boot', j[`shin.${s}`], j[`foot.${s}`], 0.55, 0.85, 0.09],
        ];
        for (const [part, a, b, t0, t1, r] of segments) {
          const { q, t } = near(a, b);
          if (t > t0 && t < t1 && p.distanceTo(q) < r) count(part, n.dot(p.clone().sub(q)) > 0);
        }
        // The foot, ahead of the boot: away from its own centre line (it runs along +Z).
        const ankle = j[`foot.${s}`];
        if (Math.abs(p.x - ankle.x) < 0.07 && p.z > 0.08 && p.z < 0.14 && p.y > 0.01 && p.y < 0.1)
          count('foot', n.x * (p.x - ankle.x) + n.y * (p.y - 0.045) > 0);
      }
      // The skirt's outside, below the belt, at the back (behind the hands; the front is open).
      if (p.y < 0.95 && p.y > 0.45 && p.z < -0.08 && Math.hypot(p.x, p.z) > 0.2)
        count('skirt', n.x * p.x + n.z * p.z > 0);
    }
    for (const part of ['upper arm', 'thigh', 'boot', 'foot', 'skirt']) {
      const [out, inward] = tally[part] ?? [0, 0];
      expect(out + inward, part).toBeGreaterThan(8);
      expect(out / (out + inward), part).toBeGreaterThan(0.9);
    }
  });

  it('carries the glow channels: the visor and each gauntlet', () => {
    const g = buildBody(WIELDER_LOOKS[0], 1);
    const m = g.attributes.aMat!;
    const seen = new Set<number>();
    for (let i = 0; i < m.count; i++) if (m.getZ(i) > 0.5) seen.add(m.getW(i));
    expect(seen.has(GLOW.visor)).toBe(true);
    expect(seen.has(GLOW.left)).toBe(true);
    expect(seen.has(GLOW.right)).toBe(true);
    // Metal where it should be: some vertices fully metallic, most not.
    let metal = 0;
    for (let i = 0; i < m.count; i++) if (m.getY(i) > 0.5) metal++;
    expect(metal).toBeGreaterThan(m.count * 0.1);
    expect(metal).toBeLessThan(m.count * 0.6);
  });
});
