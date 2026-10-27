/**
 * Arena generators (Phase 07A / D07): deterministic for a seed, non-degenerate (finite positions,
 * unit normals), within triangle budgets, and never inside the playable volume — decor must not
 * create hidden obstacles, hide the goal mouth or overlap a core that is touching a collider.
 */
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import { ARENA_ART } from '../art-tokens';
import {
  capRail,
  COPING,
  crystalCluster,
  fieldPillar,
  footprintPolygon,
  gate,
  gateCavity,
  gateRingHeight,
  goalPosts,
  monolith,
  offsetInward,
  plinth,
  platform,
  polygonArea,
  rayToPolygon,
  rock,
  underside,
  wallBlocks,
  type Footprint,
  type PlatformParams,
} from './geometry';

const FIELD: Footprint = { halfX: 24.8, halfZ: 14.5, chamfer: 4 };
/** The shipped platform configuration around a (chamfered) test outline. */
const PLATFORM: PlatformParams = { ...ARENA_ART.platform, inner: FIELD };

/** FNV-1a over the float bits: equal hashes ⇔ identical vertex data. */
function hash(g: THREE.BufferGeometry): number {
  const a = g.attributes.position!.array as Float32Array;
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 0x01000193) >>> 0;
  return h;
}

function expectSane(g: THREE.BufferGeometry, maxTriangles: number): void {
  const p = g.attributes.position!.array as Float32Array;
  const n = g.attributes.normal!.array as Float32Array;
  expect(p.length % 9).toBe(0);
  expect(p.length / 9).toBeLessThanOrEqual(maxTriangles);
  for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i]!)).toBe(true);
  let bad = 0;
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!);
    if (!(Math.abs(len - 1) < 1e-3)) bad++;
  }
  expect(bad).toBe(0);
}

function inside(poly: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

describe('arena geometry helpers', () => {
  it('the field outline is convex, counter-clockwise, and rays hit it at the right distance', () => {
    const poly = footprintPolygon(FIELD);
    expect(polygonArea(poly)).toBeGreaterThan(0);
    expect(rayToPolygon(poly, 0)).toBeCloseTo(24.8, 6);
    expect(rayToPolygon(poly, Math.PI / 2)).toBeCloseTo(14.5, 6);
    expect(rayToPolygon(poly, Math.PI)).toBeCloseTo(24.8, 6);
    // Toward the chamfered corner the boundary is closer than the box corner.
    const corner = Math.atan2(14.5, 24.8);
    expect(rayToPolygon(poly, corner)).toBeLessThan(Math.hypot(24.8, 14.5));
  });
});

describe('offsetInward (slab joints)', () => {
  /** Distance from point (px, pz) to the infinite line through a and b. */
  const lineDist = (a: readonly number[], b: readonly number[], px: number, pz: number) =>
    Math.abs((b[0]! - a[0]!) * (a[1]! - pz) - (a[0]! - px) * (b[1]! - a[1]!)) /
    Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);

  it('moves every edge of a convex or concave polygon exactly d inward', () => {
    const square = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ] as const;
    // An L: concave (a reflex corner), like a slab wrapping round a field corner.
    const ell = [
      [0, 0],
      [6, 0],
      [6, 2],
      [2, 2],
      [2, 6],
      [0, 6],
    ] as const;
    for (const poly of [square, ell]) {
      expect(polygonArea(poly)).toBeGreaterThan(0);
      const out = offsetInward(poly, 0.1);
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        // Each new edge lies on the old edge's line shifted by d…
        expect(lineDist(poly[i]!, poly[j]!, out[i]![0], out[i]![1])).toBeCloseTo(0.1, 9);
        expect(lineDist(poly[i]!, poly[j]!, out[j]![0], out[j]![1])).toBeCloseTo(0.1, 9);
      }
      // …and to the inside: the area shrinks.
      expect(polygonArea(out)).toBeLessThan(polygonArea(poly));
    }
  });
});

describe('platform', () => {
  it('is deterministic for a seed and different for another', () => {
    const a = platform(PLATFORM);
    const b = platform(PLATFORM);
    const c = platform({ ...PLATFORM, seed: 8 });
    expect(hash(a.geometry)).toBe(hash(b.geometry));
    expect(hash(a.geometry)).not.toBe(hash(c.geometry));
    expect(a.slabs).toBe(b.slabs);
  });

  it('builds 12–20 large bevelled slabs (D07) within the triangle budget, with sane normals', () => {
    for (const seed of [7, 8, 9, 10, 11]) {
      const p = platform({ ...PLATFORM, seed });
      expect(p.slabs, `seed ${seed}`).toBeGreaterThanOrEqual(12);
      expect(p.slabs, `seed ${seed}`).toBeLessThanOrEqual(20);
      expectSane(p.geometry, 60_000);
    }
  });

  it('never intrudes into the field: every vertex near the surface lies outside the outline', () => {
    const p = platform(PLATFORM);
    const poly = footprintPolygon(FIELD);
    let intruding = 0;
    let maxY = -Infinity;
    for (const g of [p.geometry, p.cracked]) {
      const pos = g.attributes.position!.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
        maxY = Math.max(maxY, y);
        if (y > -0.6 && inside(poly, x, z)) intruding++;
      }
    }
    expect(intruding).toBe(0);
    // Slab tops sit at the floor level (never above it: nothing to trip a rolling core visually).
    expect(maxY).toBeLessThanOrEqual(0.03);
  });

  it('keeps the first ring flush with the field floor; beyond it slabs settle to stepped heights', () => {
    const p = platform(PLATFORM);
    const poly = footprintPolygon(FIELD);
    const pos = p.geometry.attributes.position!.array as Float32Array;
    const nrm = p.geometry.attributes.normal!.array as Float32Array;
    const tops: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      if (nrm[i + 1]! < 0.999) continue; // slab tops only
      const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
      if (Math.abs(z) < PLATFORM.channel / 2 + 0.2) continue; // the carved channel beds
      const theta = Math.atan2(z, x);
      const fromField = Math.hypot(x, z) - rayToPolygon(poly, theta);
      if (fromField < 0.6)
        expect(Math.abs(y), `flush at (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeLessThan(0.03);
      else tops.push(y);
    }
    // Real steps (several centimetres) somewhere beyond the first ring.
    expect(Math.min(...tops)).toBeLessThan(-0.08);
  });

  it('carves a channel on the scoring axis behind each gate, with brass laid in its bed', () => {
    const p = platform(PLATFORM);
    const pos = p.geometry.attributes.position!.array as Float32Array;
    const nrm = p.geometry.attributes.normal!.array as Float32Array;
    // No slab top reaches into the channel: within half its width of the axis, beyond the
    // field, every upward face is the bed (sunk well below the slab tops).
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = [pos[i]!, pos[i + 1]!, pos[i + 2]!];
      if (nrm[i + 1]! > 0.999 && Math.abs(x) > FIELD.halfX + 0.5 && Math.abs(z) < 0.2)
        expect(y, `channel floor at x=${x.toFixed(1)}`).toBeLessThan(-0.12);
    }
    p.inlays.computeBoundingBox();
    const b = p.inlays.boundingBox!;
    expect(b.min.x).toBeLessThan(-(FIELD.halfX + 3));
    expect(b.max.x).toBeGreaterThan(FIELD.halfX + 3);
    expect(b.max.y).toBeLessThan(-0.1);
    expect(Math.max(-b.min.z, b.max.z)).toBeLessThan(0.1);
  });

  it('cracks a few slabs open and rests rubble on level slabs near the broken rim', () => {
    const p = platform(PLATFORM);
    expect(p.cracked.attributes.position!.count).toBeGreaterThan(0);
    expectSane(p.cracked, 15_000);
    expect(p.rubble.length).toBeGreaterThanOrEqual(4);
    const poly = footprintPolygon(FIELD);
    for (const [x, y, z] of [...p.rubble, ...p.crystals]) {
      const theta = Math.atan2(z, x);
      expect(Math.hypot(x, z)).toBeGreaterThan(rayToPolygon(poly, theta) + 1);
      expect(Math.hypot(x, z)).toBeLessThan(p.outerAt(theta));
      expect(y).toBeLessThanOrEqual(0);
      expect(y).toBeGreaterThan(-0.2);
    }
    expect(p.crystals.length).toBeGreaterThan(0);
    const c = crystalCluster(4);
    expectSane(c, 2_000);
    c.computeBoundingBox();
    expect(c.boundingBox!.max.y).toBeGreaterThan(0.4);
    expect(c.boundingBox!.max.y).toBeLessThan(1.6);
  });

  it('breaks the rim away from the gate axes, and the rim stays outside the field', () => {
    const p = platform(PLATFORM);
    expect(p.bites.length).toBe(4);
    for (const b of p.bites) expect(Math.abs(Math.sin(b.theta))).toBeGreaterThanOrEqual(0.35);
    for (let t = 0; t < Math.PI * 2; t += 0.05)
      expect(p.outerAt(t)).toBeGreaterThan(rayToPolygon(footprintPolygon(FIELD), t) + 1.5);
  });
});

describe('gate', () => {
  const params = { mouthHalfWidth: 3.6, mouthHeight: 4.6, depth: 3.2 } as const;

  it('leaves the goal mouth open: no gate geometry in front of or inside the scoring opening', () => {
    for (const lod of ['high', 'low'] as const) {
      const g = gate({ ...params, motifSides: 6, lod });
      const ringY = gateRingHeight(params);
      for (const part of [g.stone, g.brass, g.steel, g.motif, g.rings]) {
        const pos = part.attributes.position!.array as Float32Array;
        const lift = part === g.rings ? ringY : 0;
        for (let i = 0; i < pos.length; i += 3) {
          const [x, y, z] = [pos[i]!, pos[i + 1]! + lift, pos[i + 2]!];
          const inMouth =
            Math.abs(z) < params.mouthHalfWidth - 0.05 &&
            y < params.mouthHeight - 0.05 &&
            x > -3 &&
            x < params.depth + 0.5;
          expect(inMouth, `${lod} vertex (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`).toBe(
            false,
          );
        }
      }
    }
  });

  it('is monumental (≥ 7 m tall), has a lighter low LOD, and sane normals', () => {
    const high = gate({ ...params, motifSides: 6, lod: 'high' });
    const low = gate({ ...params, motifSides: 4, lod: 'low' });
    high.stone.computeBoundingBox();
    expect(high.stone.boundingBox!.max.y).toBeGreaterThan(7);
    const tris = (g: typeof high) =>
      [g.stone, g.brass, g.steel, g.motif, g.rings].reduce(
        (s, p) => s + p.attributes.position!.count / 3,
        0,
      );
    expect(tris(low)).toBeLessThan(tris(high) * 0.7);
    for (const part of [high.stone, high.brass, high.steel, low.stone, low.brass])
      expectSane(part, 30_000);
  });
});

describe('rocks, walls, monoliths, underside', () => {
  it('are deterministic and non-degenerate', () => {
    expect(hash(rock(3))).toBe(hash(rock(3)));
    expect(hash(rock(3))).not.toBe(hash(rock(4)));
    expectSane(rock(3), 2_000);
    expect(hash(wallBlocks(5, 34, 1, 1.25))).toBe(hash(wallBlocks(5, 34, 1, 1.25)));
    expectSane(wallBlocks(5, 34, 1, 1.25), 20_000);
    const m = monolith(9, 18, 1.6, 'high');
    expectSane(m.stone, 6_000);
    expectSane(m.brass, 2_000);
    const u = underside(32, 'low');
    expectSane(u.stone, 4_000);
    expectSane(u.steel, 6_000);
  });

  it('wall blocks fill the run length at the wall height', () => {
    const g = wallBlocks(5, 34, 1, 1.25);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x - b.min.x).toBeCloseTo(34 - 0.05, 1);
    expect(b.max.y).toBeGreaterThan(1.2);
    expect(b.max.y).toBeLessThan(1.32);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it('the low detail level keeps the walls and rails in place with far fewer triangles', () => {
    const tris = (g: THREE.BufferGeometry) => g.attributes.position!.count / 3;
    for (const [high, low] of [
      [wallBlocks(5, 34, 1, 1.25), wallBlocks(5, 34, 1, 1.25, 'low')],
      [capRail(34, 1, 1.25), capRail(34, 1, 1.25, 'low')],
    ] as const) {
      expectSane(low, 20_000);
      expect(tris(low)).toBeLessThan(tris(high) * 0.45);
      high.computeBoundingBox();
      low.computeBoundingBox();
      // Same footprint up to the rivet heads (≤ 3.4 cm), which only the high level has.
      const [h, l] = [high.boundingBox!, low.boundingBox!];
      expect(l.min.distanceTo(h.min)).toBeLessThan(0.04);
      expect(l.max.distanceTo(h.max)).toBeLessThan(0.05);
    }
  });

  it('splits the underside tiers’ hidden tops from the lit stone, which never faces up', () => {
    for (const lod of ['high', 'low'] as const) {
      const u = underside(28.8, lod);
      expectSane(u.caps, 400);
      const up = (g: THREE.BufferGeometry) => {
        const n = g.attributes.normal!.array as Float32Array;
        const ys: number[] = [];
        for (let i = 1; i < n.length; i += 3) ys.push(n[i]!);
        return ys;
      };
      // Every cap faces straight up; the widest is the first tier's, just inside the slabs.
      expect(Math.min(...up(u.caps))).toBeGreaterThan(0.999);
      const p = u.caps.attributes.position!.array as Float32Array;
      let rMax = 0;
      let yMax = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        rMax = Math.max(rMax, Math.hypot(p[i]!, p[i + 2]!));
        yMax = Math.max(yMax, p[i + 1]!);
      }
      expect(rMax).toBeCloseTo(28.8 * 0.97, 3);
      expect(yMax).toBeLessThan(-0.5);
      // The lit stone (tier walls and bottoms) has no upward-facing surface left to shade.
      expect(Math.max(...up(u.stone))).toBeLessThan(0.5);
    }
  });
});

describe('the surface-material contract', () => {
  it('every generator output carries position, normal, uv and a vertex colour', () => {
    // Without a colour attribute a vertex-coloured material reads black (WebGL's default).
    const params = { mouthHalfWidth: 3.6, mouthHeight: 4.6, depth: 3.2 } as const;
    const outputs: [string, THREE.BufferGeometry][] = [
      ['platform', platform(PLATFORM).geometry],
      ['rock', rock(3)],
      ['wallBlocks', wallBlocks(5, 34, 1.2, 1.25)],
      ['capRail', capRail(34, 1.2, 1.25)],
      ['goalPosts', goalPosts(3.6, 4.6, 0.25, 'high')],
      ['inlays', platform(PLATFORM).inlays],
      ['crystalCluster', crystalCluster(4)],
    ];
    const groups: [string, Record<string, THREE.BufferGeometry>][] = [
      ['gate', { ...gate({ ...params, motifSides: 6, lod: 'high' }) }],
      ['monolith', monolith(9, 18, 1.6, 'low')],
      ['underside', underside(28.8, 'high')],
      ['fieldPillar high', fieldPillar(0.95, 4.2, 'high')],
      ['fieldPillar low', fieldPillar(0.95, 4.2, 'low')],
      ['plinth 6', plinth(6)],
      ['plinth 4', plinth(4)],
      ['gateCavity', gateCavity(params)],
    ];
    for (const [name, group] of groups)
      for (const [part, g] of Object.entries(group)) outputs.push([`${name}.${part}`, g]);
    for (const [name, g] of outputs)
      for (const a of ['position', 'normal', 'uv', 'color'])
        expect(g.hasAttribute(a), `${name} has ${a}`).toBe(true);
  });
});

describe('field pillars, plinths, wall trim', () => {
  const pillar = MERIDIAN_ARENA.obstacles.find((o) => o.kind === 'pillar')!;
  const r = pillar.radius;
  const h = pillar.height;
  const core = DEFAULT_RULES.core.radius;

  it('never reach a core that touches the pillar collider (resting on the floor or hovering)', () => {
    for (const lod of ['high', 'low'] as const) {
      const p = fieldPillar(r, h, lod);
      const each = (g: THREE.BufferGeometry, f: (rho: number, y: number) => void) => {
        const pos = g.attributes.position!.array as Float32Array;
        for (let i = 0; i < pos.length; i += 3) f(Math.hypot(pos[i]!, pos[i + 2]!), pos[i + 1]!);
      };
      // The shaft stays within the collider's radius over its whole height (the capital is above).
      each(p.stone, (rho, y) => {
        if (y < h - 1e-6) expect(rho).toBeLessThanOrEqual(r + 1e-6);
      });
      // Trim below the top may stand proud of the collider only where a touching core is not:
      // the core's centre sits r + core from the axis, at any height from core (resting) up.
      for (const g of [p.brass, p.rune]) {
        each(g, (rho, y) => {
          if (y > h) return; // the capital, above the shaft
          for (const cy of [core, DEFAULT_RULES.core.hoverHeight]) {
            const d = Math.hypot(r + core - rho, cy - y);
            expect(d, `${lod} trim at ρ=${rho.toFixed(3)} y=${y.toFixed(3)}`).toBeGreaterThan(
              core - 1e-3,
            );
          }
        });
      }
    }
  });

  it("put a plinth's glowing inlay on the same corner bearings as its stone drum", () => {
    for (const sides of [4, 6] as const) {
      const p = plinth(sides);
      const bearings = (g: THREE.BufferGeometry, y: (v: number) => boolean) => {
        const pos = g.attributes.position!.array as Float32Array;
        let best = 0;
        const out = new Set<number>();
        for (let i = 0; i < pos.length; i += 3)
          best = Math.max(best, Math.hypot(pos[i]!, pos[i + 2]!) * (y(pos[i + 1]!) ? 1 : 0));
        for (let i = 0; i < pos.length; i += 3) {
          const rho = Math.hypot(pos[i]!, pos[i + 2]!);
          if (y(pos[i + 1]!) && rho > best - 1e-4) {
            const deg =
              (Math.round((Math.atan2(pos[i + 2]!, pos[i]!) * 180) / Math.PI) + 360) % 360;
            out.add(deg);
          }
        }
        return [...out].sort((a, b) => a - b);
      };
      const drum = bearings(p.stone, (y) => y > 1.59);
      const inlay = bearings(p.inlay, () => true);
      expect(drum.length).toBe(sides);
      expect(inlay).toEqual(drum);
    }
  });

  it('wall trim sits on the coping, inside its width, and the coping caps the wall height', () => {
    const thick = 1.2;
    const height = 1.25;
    const wall = wallBlocks(5, 34, thick, height);
    wall.computeBoundingBox();
    expect(wall.boundingBox!.max.y).toBeCloseTo(height, 2);
    expect(wall.boundingBox!.max.z).toBeLessThanOrEqual((thick + 0.14) / 2 + 1e-6);
    const rail = capRail(34, thick, height);
    const pos = rail.attributes.position!.array as Float32Array;
    for (let i = 0; i < pos.length; i += 3) {
      expect(pos[i + 1]!).toBeGreaterThan(height - 0.011);
      expect(pos[i + 1]!).toBeLessThan(height + 0.08);
      expect(Math.abs(pos[i + 2]!)).toBeLessThanOrEqual((thick + 0.14) / 2);
    }
    expect(COPING).toBeGreaterThan(0.1);
  });
});
