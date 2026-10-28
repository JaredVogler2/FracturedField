/**
 * Procedural architecture for the Shattered Meridian (Phase 07A / D07). Every generator is pure
 * and seeded: the same seed builds the same vertices on every client, nothing here touches the
 * physics world, and every piece of decor stays outside the playable volume (tested).
 *
 * Conventions: metres, +Y up, the field centred on the origin with its scoring axis along X.
 * Generators return merged BufferGeometries (one draw call per material) with position, normal,
 * uv and a per-vertex colour used as a subtle albedo/value variation by the materials.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32, ValueNoise2D } from '../procedural';

export type Vec2 = readonly [number, number];

/** A chamfered rectangle centred on the origin (the field floor outline). */
export interface Footprint {
  readonly halfX: number;
  readonly halfZ: number;
  readonly chamfer: number;
}

/** The outline as a convex polygon, counter-clockwise in (x, z). */
export function footprintPolygon(fp: Footprint): Vec2[] {
  const { halfX: x, halfZ: z, chamfer: c } = fp;
  return [
    [x, -z + c],
    [x, z - c],
    [x - c, z],
    [-x + c, z],
    [-x, z - c],
    [-x, -z + c],
    [-x + c, -z],
    [x - c, -z],
  ];
}

/** Distance from the origin to a convex polygon's boundary along the direction `theta`. */
export function rayToPolygon(poly: readonly Vec2[], theta: number): number {
  const dx = Math.cos(theta);
  const dz = Math.sin(theta);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    const ex = bx - ax;
    const ez = bz - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * ez - az * ex) / den;
    const u = (ax * dz - az * dx) / den;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}

/** Applies a constant colour (value variation) to every vertex of a geometry. */
function tint(g: THREE.BufferGeometry, v: number): THREE.BufferGeometry {
  const n = g.attributes.position!.count;
  const c = new Float32Array(n * 3).fill(v);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/**
 * Per-vertex value by facing: upward faces get `v`, vertical and downward faces fall toward
 * `v · side` — joints and undersides read dark from above, as ambient occlusion would make them.
 * Faces turned away from the origin (a slab's outer rim, open to the sky) fall only to
 * `v · outward`.
 */
function tintByFacing(
  g: THREE.BufferGeometry,
  v: number,
  side: number,
  outward = side,
): THREE.BufferGeometry {
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const c = new Float32Array(nrm.count * 3);
  for (let i = 0; i < nrm.count; i++) {
    let s = side;
    if (outward !== side) {
      const len = Math.hypot(pos.getX(i), pos.getZ(i)) || 1;
      if ((nrm.getX(i) * pos.getX(i) + nrm.getZ(i) * pos.getZ(i)) / len > 0.5) s = outward;
    }
    const k = v * (s + (1 - s) * Math.sqrt(Math.max(0, nrm.getY(i))));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Merges and drops the inputs; throws on an empty list (a generator bug). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  for (const p of prepared) {
    if (!p.attributes.color) tint(p, 1);
    if (!p.attributes.uv) {
      p.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(p.attributes.position!.count * 2), 2),
      );
    }
  }
  const merged = mergeGeometries(prepared, false);
  if (!merged) throw new Error('arena geometry: incompatible parts');
  for (const p of parts) p.dispose();
  for (const p of prepared) if (!parts.includes(p)) p.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** Extrudes a horizontal polygon (x, z) downward from y = 0, with bevelled edges. */
function slab(poly: readonly Vec2[], thickness: number, bevel: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.05, thickness - 2 * bevel),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 1,
  });
  // Shape plane (x, y) → world (x, z); extrusion +Z → world −Y; the bevel's top face at y = 0.
  g.rotateX(Math.PI / 2);
  g.translate(0, -bevel, 0);
  return g;
}

/** Signed polygon area in (x, z); positive for counter-clockwise. */
export function polygonArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]!;
    const [x1, z1] = poly[(i + 1) % poly.length]!;
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

/**
 * Offsets a simple counter-clockwise polygon inward by `d` metres, every edge moving parallel to
 * itself (mitred corners, clamped at sharp ones) — the slab joints. `d` must be small next to the
 * edges, as it is for joints. (Moving vertices toward the centroid instead would pull the inner
 * edge of a slab that wraps a field corner toward the field.)
 */
export function offsetInward(poly: readonly Vec2[], d: number): Vec2[] {
  const n = poly.length;
  return poly.map(([x, z], i) => {
    const [ax, az] = poly[(i - 1 + n) % n]!;
    const [bx, bz] = poly[(i + 1) % n]!;
    const l1 = Math.hypot(x - ax, z - az) || 1;
    const l2 = Math.hypot(bx - x, bz - z) || 1;
    // Inward (left) normals of the incoming and outgoing edges.
    const n1x = -(z - az) / l1;
    const n1z = (x - ax) / l1;
    const n2x = -(bz - z) / l2;
    const n2z = (bx - x) / l2;
    const mx = n1x + n2x;
    const mz = n1z + n2z;
    const ml = Math.hypot(mx, mz) || 1;
    const cos = (mx * n1x + mz * n1z) / ml;
    const len = d / Math.max(cos, 0.3);
    return [x + (mx / ml) * len, z + (mz / ml) * len] as Vec2;
  });
}

export interface PlatformParams {
  readonly seed: number;
  /** The field floor outline the slabs wrap around. */
  readonly inner: Footprint;
  /** Mean radius of the shattered outer edge. */
  readonly outerRadius: number;
  /** Number of angular sectors (each splits radially into slabs ≤ maxSlabDepth deep). */
  readonly sectors: number;
  readonly maxSlabDepth: number;
  readonly thickness: readonly [number, number];
  /** Joint width between slabs. */
  readonly gap: number;
  /** Broken bites taken out of the outer edge (never near the gate axes). */
  readonly bites: number;
  /** Slabs the rift has cracked open (glowing fissures; near the bites first). */
  readonly cracked: number;
  /** Width of the carved channels on the scoring axis behind each gate (0: none). */
  readonly channel: number;
}

export interface Platform {
  readonly geometry: THREE.BufferGeometry;
  /** The rift-cracked slabs (drawn with the glowing-crack material). */
  readonly cracked: THREE.BufferGeometry;
  /** Slab count (for budgets and tests). */
  readonly slabs: number;
  /** Where the edge broke away (radians, depth in metres): debris and fragments go there. */
  readonly bites: readonly { readonly theta: number; readonly depth: number }[];
  /** Outer radius as a function of angle (the shattered rim), for placing set dressing. */
  readonly outerAt: (theta: number) => number;
  /** Where loose rubble rests on level slab tops near the broken rim: [x, top y, z]. */
  readonly rubble: readonly (readonly [number, number, number])[];
  /** Brass inlays laid in the channel beds. */
  readonly inlays: THREE.BufferGeometry;
  /** Where rift crystals grow out of level cracked slabs: [x, top y, z]. */
  readonly crystals: readonly (readonly [number, number, number])[];
}

/**
 * The basal platform around the field: a ring of large bevelled basalt slabs whose inner edge
 * follows the field floor and whose outer rim is irregular and broken. The platform is old and
 * fractured, not a clean disc: slabs beyond the first ring have settled to stepped heights, some
 * outer slabs have sunk and tilted, and the rift has cracked a few open. Behind each gate a channel
 * carved along the scoring axis, brass laid in its bed, splits the slabs.
 */
export function platform(p: PlatformParams): Platform {
  const rand = mulberry32(p.seed);
  const noise = new ValueNoise2D(p.seed ^ 0x5eed, 64);
  const innerPoly = footprintPolygon(p.inner);
  const bites: { theta: number; depth: number; width: number }[] = [];
  for (let i = 0; bites.length < p.bites && i < p.bites * 20; i++) {
    const theta = rand() * Math.PI * 2;
    // Keep the gate footings (scoring axis, θ ≈ 0 and π) and the camera-facing side intact.
    const fromAxis = Math.min(Math.abs(Math.sin(theta)), 1);
    if (fromAxis < 0.35) continue;
    if (
      bites.some(
        (b) => Math.abs(Math.atan2(Math.sin(b.theta - theta), Math.cos(b.theta - theta))) < 0.5,
      )
    )
      continue;
    // Never bite closer than 2.5 m to the field: near the corners the outline reaches far out.
    const available = p.outerRadius * 0.93 - rayToPolygon(innerPoly, theta) - 2.5;
    const depth = Math.min(1.6 + rand() * 2.2, available);
    if (depth < 1) continue;
    bites.push({ theta, depth, width: 0.07 + rand() * 0.08 });
  }
  const outerAt = (theta: number): number => {
    const n = noise.fbm(Math.cos(theta) * 3 + 7, Math.sin(theta) * 3 + 7, 3) - 0.5;
    let r = p.outerRadius * (1 + 0.07 * n);
    for (const b of bites) {
      const d = Math.atan2(Math.sin(theta - b.theta), Math.cos(theta - b.theta)) / b.width;
      r -= b.depth * Math.exp(-d * d * 2);
    }
    return r;
  };
  interface Slab {
    readonly g: THREE.BufferGeometry;
    readonly t0: number;
    readonly t1: number;
    readonly f0: number;
    readonly f1: number;
    /** Top height for a level slab; null when sunk and tilted. */
    readonly top: number | null;
    readonly ring: number;
    readonly outer: boolean;
  }
  const built: Slab[] = [];
  // Jittered sector boundaries; with channels, two of them lie exactly on the scoring axis.
  const bounds: number[] = [];
  for (let i = 0; i < p.sectors; i++) {
    bounds.push(((i + 0.5 + (rand() - 0.5) * 0.5) / p.sectors) * Math.PI * 2);
  }
  if (p.channel > 0) {
    bounds[0] = 0;
    let near = 1;
    for (let i = 1; i < p.sectors; i++)
      if (Math.abs(bounds[i]! - Math.PI) < Math.abs(bounds[near]! - Math.PI)) near = i;
    bounds[near] = Math.PI;
  }
  const onAxis = (t: number) => p.channel > 0 && Math.abs(Math.sin(t)) < 1e-9;
  const rIn = (t: number) => rayToPolygon(innerPoly, t) + p.gap;
  // The outline's corner bearings: a slab's inner edge must bend exactly there, or the straight
  // run between two samples on either side would cut across the corner into the field.
  const TAU = Math.PI * 2;
  const corners = innerPoly.map(([x, z]) => (Math.atan2(z, x) + TAU) % TAU);
  for (let i = 0; i < p.sectors; i++) {
    const t0 = bounds[i]!;
    const t1 = i + 1 < p.sectors ? bounds[i + 1]! : bounds[0]! + Math.PI * 2;
    const n = Math.max(3, Math.ceil(((t1 - t0) * p.outerRadius) / 2.2));
    const thetas = Array.from({ length: n + 1 }, (_, k) => t0 + ((t1 - t0) * k) / n);
    for (const c of corners) {
      for (const cc of [c, c + TAU]) {
        if (cc > t0 + 1e-6 && cc < t1 - 1e-6 && thetas.every((t) => Math.abs(t - cc) > 1e-4))
          thetas.push(cc);
      }
    }
    thetas.sort((a, b) => a - b);
    const steps = thetas.length - 1;
    const rIns = thetas.map(rIn);
    const rOut = thetas.map((t) => outerAt(t));
    const depth = rOut.reduce((s, r, k) => s + (r - rIns[k]!), 0) / rOut.length;
    const pieces = Math.max(1, Math.ceil(depth / p.maxSlabDepth));
    const splits = [0];
    for (let j = 1; j < pieces; j++) splits.push(j / pieces + (rand() - 0.5) * (0.25 / pieces));
    splits.push(1);
    // A channel side keeps a constant half-width from the axis at every radius.
    const open0 = onAxis(t0);
    const open1 = onAxis(t1);
    for (let j = 0; j < pieces; j++) {
      const f0 = splits[j]!;
      const f1 = splits[j + 1]!;
      const at = (k: number, f: number): Vec2 => {
        const r = rIns[k]! + (rOut[k]! - rIns[k]!) * f;
        let t = thetas[k]!;
        if (k === 0 && open0) t += p.channel / 2 / r;
        if (k === steps && open1) t -= p.channel / 2 / r;
        return [Math.cos(t) * r, Math.sin(t) * r];
      };
      const poly: Vec2[] = [];
      for (let k = 0; k <= steps; k++) poly.push(at(k, f0));
      for (let k = steps; k >= 0; k--) poly.push(at(k, f1));
      const outline = offsetInward(polygonArea(poly) > 0 ? poly : poly.reverse(), p.gap / 2);
      const thickness = p.thickness[0] + rand() * (p.thickness[1] - p.thickness[0]);
      const g = slab(outline, thickness, 0.07);
      const outer = j === pieces - 1;
      // The first ring stays flush with the field floor; beyond it the slabs have settled.
      const lift = j === 0 ? -0.005 - rand() * 0.02 : -0.03 - rand() * 0.11;
      let top: number | null = lift;
      if (outer && j > 0 && rand() < 0.3) {
        // Sunk and tilted: the rim has settled over centuries.
        const mid = at(Math.floor(steps / 2), (f0 + f1) / 2);
        const axis = new THREE.Vector3(-Math.sin(thetas[0]!), 0, Math.cos(thetas[0]!)).normalize();
        g.translate(-mid[0], 0, -mid[1]);
        g.applyMatrix4(new THREE.Matrix4().makeRotationAxis(axis, (rand() - 0.5) * 0.09));
        g.translate(mid[0], -(0.12 + rand() * 0.35), mid[1]);
        top = null;
      } else g.translate(0, lift, 0);
      // Each slab its own value (legible at phone size); dark joints and undersides, but the rim
      // open to the sky stays readable.
      tintByFacing(g, 0.72 + rand() * 0.38, 0.38, outer ? 0.78 : 0.38);
      built.push({ g, t0, t1, f0, f1, top, ring: j, outer });
    }
  }
  // The rift cracked the slabs where the rim broke first, then a few more beyond the first ring.
  const angleTo = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const mid = (s: Slab) => (s.t0 + s.t1) / 2;
  const cracked = new Set<Slab>();
  for (const b of bites) {
    const near = built
      .filter((s) => s.outer && !cracked.has(s))
      .sort((x, y) => angleTo(mid(x), b.theta) - angleTo(mid(y), b.theta))[0];
    if (near && cracked.size < p.cracked) cracked.add(near);
  }
  const candidates = built.filter((s) => s.ring > 0 && !cracked.has(s));
  while (cracked.size < p.cracked && candidates.length) {
    cracked.add(candidates.splice(Math.floor(rand() * candidates.length), 1)[0]!);
  }
  // Rubble rests on level slab tops just inside the broken rim.
  const rubble: [number, number, number][] = [];
  const slabAt = (t: number, r: number) =>
    built.find((s) => {
      const tn = ((t % TAU) + TAU) % TAU;
      const tt = tn + (tn < s.t0 ? TAU : 0);
      if (tt < s.t0 || tt >= s.t1) return false;
      const a = rIn(t);
      const span = outerAt(t) - a;
      return r >= a + span * s.f0 + 0.4 && r <= a + span * s.f1 - 0.4;
    });
  for (const b of bites) {
    for (let i = 0; i < 4; i++) {
      const t = b.theta + (rand() - 0.5) * 0.3;
      const r = outerAt(t) - 0.8 - rand() * 2.6;
      const s = slabAt(t, r);
      if (s && s.top !== null) rubble.push([Math.cos(t) * r, s.top, Math.sin(t) * r]);
    }
  }
  // Rift crystals grow out of the level cracked slabs.
  const crystals: [number, number, number][] = [];
  for (const s of cracked) {
    if (s.top === null) continue;
    for (let i = 0; i < 3; i++) {
      const t = s.t0 + (s.t1 - s.t0) * (0.2 + rand() * 0.6);
      const a = rIn(t);
      const span = outerAt(t) - a;
      const r = a + span * (s.f0 + (s.f1 - s.f0) * (0.25 + rand() * 0.5));
      if (slabAt(t, r) === s) crystals.push([Math.cos(t) * r, s.top, Math.sin(t) * r]);
    }
  }
  // Channel beds: a sunken stone bed under each channel with a brass strip laid along it.
  const beds: THREE.BufferGeometry[] = [];
  const strips: THREE.BufferGeometry[] = [];
  if (p.channel > 0) {
    for (const a of [0, Math.PI]) {
      const r0 = rIn(a) - p.gap / 2;
      const r1 = outerAt(a) - 0.25;
      const len = r1 - r0;
      const place = new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(a) * (r0 + len / 2), 0, Math.sin(a) * (r0 + len / 2)),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a),
        new THREE.Vector3(1, 1, 1),
      );
      const bed = new RoundedBoxGeometry(len, 0.5, p.channel + 0.3, 2, 0.04);
      bed.translate(0, -0.16 - 0.25, 0);
      beds.push(tint(bed.applyMatrix4(place), 0.62));
      const strip = new RoundedBoxGeometry(len - 0.5, 0.05, 0.12, 1, 0.02);
      strip.translate(0, -0.16 + 0.015, 0);
      strips.push(strip.applyMatrix4(place));
    }
  }
  return {
    geometry: merge([...built.filter((s) => !cracked.has(s)).map((s) => s.g), ...beds]),
    cracked: merge([...cracked].map((s) => s.g)),
    slabs: built.length,
    bites: bites.map(({ theta, depth }) => ({ theta, depth })),
    outerAt,
    rubble,
    inlays: strips.length ? merge(strips) : new THREE.BufferGeometry(),
    crystals,
  };
}

/**
 * A rift crystal cluster: a few hexagonal bipyramids of different sizes leaning out from a common
 * root (centred on the origin, growing up +Y about 1 m), for the translucent rift-glass material.
 */
export function crystalCluster(seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const count = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < count; i++) {
    const h = 0.45 + rand() * 0.75;
    const r = 0.07 + rand() * 0.09;
    // Hexagonal bipyramid: a short prism with pointed ends.
    const prism = new THREE.CylinderGeometry(r, r, h * 0.55, 6, 1, true);
    const top = new THREE.ConeGeometry(r, h * 0.35, 6, 1, true);
    top.translate(0, (h * 0.55) / 2 + (h * 0.35) / 2, 0);
    const bottom = new THREE.ConeGeometry(r, h * 0.1, 6, 1, true);
    bottom.rotateX(Math.PI);
    bottom.translate(0, (-h * 0.55) / 2 - h * 0.05, 0);
    const shard = merge([prism, top, bottom]);
    shard.translate(0, h * 0.35, 0);
    shard.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler((rand() - 0.5) * 1.1, rand() * Math.PI * 2, (rand() - 0.5) * 1.1),
      ),
    );
    parts.push(shard);
  }
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

/**
 * A fractured rock: a noise-displaced icosphere with a few flat fracture planes (fresh breaks),
 * so silhouettes read as broken stone rather than blobs.
 */
export function rock(seed: number, detail = 2, fractures = 3): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const noise = new ValueNoise2D(seed ^ 0xbeef, 32);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const planes: { n: THREE.Vector3; d: number }[] = [];
  for (let i = 0; i < fractures; i++) {
    const n = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    planes.push({ n, d: 0.55 + rand() * 0.3 });
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise.fbm(v.x * 1.7 + v.z * 0.6 + 11, v.y * 1.7 - v.z * 0.4 + 5, 4);
    v.multiplyScalar(0.78 + n * 0.45);
    for (const pl of planes) {
      const s = v.dot(pl.n);
      if (s > pl.d) v.addScaledVector(pl.n, pl.d - s);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  return tint(flat, 0.9 + rand() * 0.15);
}

/** Height of a wall run's coping (capstones) — the top `COPING` metres of its height. */
export const COPING = 0.2;

/**
 * A wall run along local X, centred: bevelled stone blocks with a slight per-block jitter, under
 * a coping of longer capstones that overhang both faces (the stones break joint with the blocks).
 */
export function wallBlocks(
  seed: number,
  length: number,
  thickness: number,
  height: number,
  lod: Lod = 'high',
): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const parts: THREE.BufferGeometry[] = [];
  const body = height - COPING;
  const count = Math.max(1, Math.round(length / 2.6));
  const unit = length / count;
  const gap = 0.05;
  // Bevel segments: a 6 cm bevel is a pixel or two on a phone — one segment reads the same there.
  const bevel = lod === 'high' ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const h = body * (0.985 + rand() * 0.03);
    const b = new RoundedBoxGeometry(unit - gap, h, thickness, bevel, 0.06);
    b.translate(-length / 2 + unit * (i + 0.5), h / 2, (rand() - 0.5) * 0.03);
    tint(b, 0.82 + rand() * 0.2);
    parts.push(b);
  }
  const caps = Math.max(1, Math.round(length / 3.4));
  const capLen = length / caps;
  for (let i = 0; i < caps; i++) {
    const c = new RoundedBoxGeometry(capLen - 0.04, COPING, thickness + 0.14, bevel, 0.05);
    c.translate(-length / 2 + capLen * (i + 0.5), body + COPING / 2, 0);
    tint(c, 0.95 + rand() * 0.12);
    parts.push(c);
  }
  return merge(parts);
}

/**
 * Brass trim along both top edges of a wall's coping (`y` = the coping's top, `thickness` = the
 * wall's): a thin bright line that marks the field boundary from any camera, rivet heads every
 * ~0.8 m. Brass is an accent here, never a broad field of colour.
 */
export function capRail(
  length: number,
  thickness: number,
  y: number,
  lod: Lod = 'high',
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const edge = (thickness + 0.14) / 2 - 0.065;
  for (const s of [-1, 1]) {
    const strip = new RoundedBoxGeometry(length + 0.02, 0.06, 0.1, 1, 0.02);
    strip.translate(0, y + 0.02, s * edge);
    parts.push(strip);
  }
  // Rivets are sub-pixel at phone resolution: the low detail level keeps only the strips.
  if (lod === 'low') return merge(parts);
  const n = Math.max(2, Math.round(length / 0.8));
  for (let i = 0; i <= n; i++) {
    const x = -length / 2 + (length * i) / n;
    for (const s of [-1, 1]) {
      const rivet = new THREE.CylinderGeometry(0.03, 0.034, 0.024, 8);
      rivet.translate(x, y + 0.062, s * edge);
      parts.push(rivet);
    }
  }
  return merge(parts);
}

/** Detail level: geometry segments for the closest view (high) or phones / far views (low). */
export type Lod = 'high' | 'low';

export interface GateGeometry {
  readonly stone: THREE.BufferGeometry;
  readonly brass: THREE.BufferGeometry;
  readonly steel: THREE.BufferGeometry;
  /** Emissive team motif (hexagon for seat 0, diamond for seat 1 — matches the HUD glyphs). */
  readonly motif: THREE.BufferGeometry;
  /** The rotating rings (animated by the component around the gate's local X axis). */
  readonly rings: THREE.BufferGeometry;
}

export interface GateParams {
  readonly mouthHalfWidth: number;
  readonly mouthHeight: number;
  readonly depth: number;
  /** 6 (hexagon, seat 0) or 4 (diamond, seat 1). */
  readonly motifSides: 4 | 6;
  readonly lod: Lod;
}

/** A tapering, bevelled pylon with recessed panels and a stepped footing (built around y = 0). */
function pylon(
  h: number,
  w: number,
  d: number,
  seg: number,
): {
  stone: THREE.BufferGeometry[];
  brass: THREE.BufferGeometry[];
} {
  const stone: THREE.BufferGeometry[] = [];
  const brass: THREE.BufferGeometry[] = [];
  // Stepped footing.
  for (let i = 0; i < 2; i++) {
    const s = 1.35 - i * 0.15;
    const f = new RoundedBoxGeometry(w * s, 0.32, d * s, 2, 0.05);
    f.translate(0, 0.16 + i * 0.32, 0);
    stone.push(tint(f, 0.82));
  }
  // Shaft: a bevelled box tapered toward the top.
  const shaft = new RoundedBoxGeometry(w, h, d, seg > 24 ? 3 : 2, 0.08);
  const p = shaft.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h + 0.5;
    const k = 1 - 0.14 * y;
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
  }
  shaft.computeVertexNormals();
  shaft.translate(0, h / 2 + 0.64, 0);
  stone.push(tint(shaft, 0.95));
  // Brass frames around a panel on the field-facing and outer faces, leaning with the taper.
  const tilt = Math.atan((0.14 * w * 0.5) / h);
  const ph = h * 0.62;
  const pd = d * 0.62;
  for (const sx of [-1, 1]) {
    const bars = [
      new RoundedBoxGeometry(0.06, ph, 0.09, 1, 0.02).translate(0, 0, -pd / 2),
      new RoundedBoxGeometry(0.06, ph, 0.09, 1, 0.02).translate(0, 0, pd / 2),
      new RoundedBoxGeometry(0.06, 0.09, pd + 0.09, 1, 0.02).translate(0, -ph / 2, 0),
      new RoundedBoxGeometry(0.06, 0.09, pd + 0.09, 1, 0.02).translate(0, ph / 2, 0),
    ];
    for (const bar of bars) {
      bar.rotateZ(sx * tilt);
      bar.translate(sx * (w * 0.5 * 0.93 + 0.012), h * 0.5 + 0.64, 0);
      brass.push(bar);
    }
  }
  // Brass bands.
  for (const yf of [0.08, 0.92]) {
    const band = new RoundedBoxGeometry(
      w * (1 - 0.14 * yf) + 0.08,
      0.16,
      d * (1 - 0.14 * yf) + 0.08,
      1,
      0.03,
    );
    band.translate(0, h * yf + 0.64, 0);
    brass.push(band);
  }
  return { stone, brass };
}

/** A curve for the arch: a slightly pointed (two-centred) arch in the local YZ plane. */
class ArchCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private readonly halfSpan: number,
    private readonly springY: number,
    private readonly point: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    // Two arcs whose centres sit `point` inward from each spring point meet at a crown.
    const side = t < 0.5 ? -1 : 1;
    const u = t < 0.5 ? t * 2 : (1 - t) * 2; // 0 at the spring, 1 at the crown
    const r = this.halfSpan + this.point;
    const cz = -side * this.point;
    const crownAngle = Math.acos(this.point / r);
    const a = u * crownAngle;
    const z = cz + side * r * Math.cos(a);
    const y = this.springY + r * Math.sin(a);
    return target.set(0, y, z);
  }
}

/**
 * A rift gate: two tapering pylons on stepped footings, a thick pointed arch springing from
 * them, a keystone carrying the seat's motif, bronze tie beams, two counter-rotating rings and
 * the steel frame of the goal mouth. The goal's collision (posts, cavity) is unchanged; the gate
 * stands around and behind it, never inside the mouth.
 */
export function gate(p: GateParams): GateGeometry {
  const seg = p.lod === 'high' ? 48 : 16;
  const pylonW = 1.5;
  const pylonD = 1.3;
  const pylonH = 5.6;
  const pylonZ = p.mouthHalfWidth + 1.05;
  const stone: THREE.BufferGeometry[] = [];
  const brass: THREE.BufferGeometry[] = [];
  const steel: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const py = pylon(pylonH, pylonW, pylonD, seg);
    for (const g of py.stone) {
      g.translate(0, 0, s * pylonZ);
      stone.push(g);
    }
    for (const g of py.brass) {
      g.translate(0, 0, s * pylonZ);
      brass.push(g);
    }
  }
  // The arch: a bevelled rectangular section swept along a pointed curve.
  const springY = pylonH + 0.64;
  const curve = new ArchCurve(pylonZ, springY, pylonZ * 0.18);
  const section = new THREE.Shape();
  const sw = 0.55;
  const sd = 0.42;
  section.moveTo(-sw, -sd);
  section.lineTo(sw, -sd);
  section.lineTo(sw, sd);
  section.lineTo(-sw, sd);
  section.lineTo(-sw, -sd);
  const arch = new THREE.ExtrudeGeometry(section, {
    steps: seg,
    bevelEnabled: false,
    extrudePath: curve,
  });
  stone.push(tint(arch, 0.92));
  // Inner brass soffit band following the arch.
  const soffit = new THREE.TubeGeometry(
    new ArchCurve(pylonZ - 0.62, springY, pylonZ * 0.18),
    seg,
    0.07,
    6,
    false,
  );
  brass.push(soffit);
  // Keystone with the motif.
  const crown = curve.getPoint(0.5);
  const key = new RoundedBoxGeometry(1.25, 1.2, 1.15, 2, 0.06);
  key.translate(0, crown.y + 0.15, 0);
  stone.push(tint(key, 1.04));
  const motif = new THREE.RingGeometry(
    0.22,
    0.34,
    p.motifSides,
    1,
    p.motifSides === 4 ? Math.PI / 4 : 0,
  );
  motif.rotateY(Math.PI / 2);
  motif.translate(-0.59, crown.y + 0.15, 0);
  const motifBack = motif.clone();
  motifBack.rotateY(Math.PI);
  // Bronze tie beams between the pylons above the mouth.
  for (const y of [p.mouthHeight + 1.05, p.mouthHeight + 2.0]) {
    const beam = new THREE.CylinderGeometry(0.11, 0.11, pylonZ * 2 - pylonW * 0.9, 12);
    beam.rotateX(Math.PI / 2);
    beam.translate(0.35, y, 0);
    brass.push(beam);
  }
  // Steel frame of the mouth (behind the posts, outside the scoring plane). Its top is rounded
  // almost to a half-cylinder: from the gameplay camera a flat top mirrors the storm break whole
  // (a white bar across the EMBER gate, 7B round b4); rounded, it catches the sun as a line.
  const frameTop = new RoundedBoxGeometry(0.5, 0.36, p.mouthHalfWidth * 2 + 1.2, 5, 0.16);
  frameTop.translate(0.35, p.mouthHeight + 0.42, 0);
  steel.push(frameTop);
  // Gyroscope rings, centred on the origin: the component places them at gateRingHeight() and
  // spins them about the gate's axis (decor above the mouth, never in it). A hub and two spokes
  // turn with them.
  const ringA = new THREE.TorusGeometry(1.15, 0.07, 8, seg * 2);
  const ringB = new THREE.TorusGeometry(0.82, 0.05, 8, seg * 2);
  ringB.rotateX(Math.PI / 2);
  for (const r of [ringA, ringB]) r.rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.13, 0.13, 0.34, 12);
  hub.rotateZ(Math.PI / 2);
  const spokes = [-1, 1].map((s) => {
    const spoke = new THREE.CylinderGeometry(0.035, 0.035, 1.05, 6);
    spoke.rotateX(Math.PI / 2);
    spoke.translate(0, 0, s * (0.1 + 1.05 / 2));
    return spoke;
  });
  // The fixed mounting, behind the rings' sweep (gate-local X, outside the inner group's 0.35
  // offset): an axle from the hub back to a hanger that drops from a bracket on the keystone.
  const ringY = gateRingHeight(p);
  const back = 0.35 + 0.82 + 0.12;
  const axle = new THREE.CylinderGeometry(0.05, 0.05, back - 0.35 - 0.17, 8);
  axle.rotateZ(Math.PI / 2);
  axle.translate((back + 0.35 + 0.17) / 2, ringY, 0);
  const keyY = crown.y + 0.15;
  const hanger = new THREE.CylinderGeometry(0.06, 0.06, keyY - ringY, 8);
  hanger.translate(back, (keyY + ringY) / 2, 0);
  const bracket = new RoundedBoxGeometry(back - 0.95, 0.2, 0.22, 1, 0.04);
  bracket.translate((back + 0.95) / 2, keyY, 0);
  const collar = new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10);
  collar.rotateZ(Math.PI / 2);
  collar.translate(back, ringY, 0);
  steel.push(axle, hanger, bracket, collar);
  return {
    stone: merge(stone),
    brass: merge(brass),
    steel: merge(steel),
    motif: merge([motif, motifBack]),
    rings: merge([ringA, ringB, hub, ...spokes]),
  };
}

/** Height above the floor at which a gate's rings turn (for the animating component). */
export function gateRingHeight(p: Pick<GateParams, 'mouthHalfWidth' | 'mouthHeight'>): number {
  const pylonZ = p.mouthHalfWidth + 1.05;
  const springY = 5.6 + 0.64;
  const crown = new ArchCurve(pylonZ, springY, pylonZ * 0.18).getPoint(0.5);
  return (p.mouthHeight + springY + crown.y) / 3 + 0.8;
}

/**
 * A monumental exterior column: a tapering fluted prism broken off at the top along a fracture
 * plane, on a stepped base. Height and break are seeded.
 */
export function monolith(
  seed: number,
  height: number,
  radius: number,
  lod: Lod,
): {
  stone: THREE.BufferGeometry;
  brass: THREE.BufferGeometry;
} {
  const rand = mulberry32(seed);
  const sides = lod === 'high' ? 24 : 10;
  const shaft = new THREE.CylinderGeometry(
    radius * 0.86,
    radius,
    height,
    sides,
    lod === 'high' ? 10 : 4,
  );
  const p = shaft.attributes.position as THREE.BufferAttribute;
  const cut = new THREE.Vector3(rand() - 0.5, 1.6, rand() - 0.5).normalize();
  const cutD = height * 0.5 - radius * (0.3 + rand() * 0.6);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const r = Math.hypot(v.x, v.z);
    if (r > 1e-6) {
      const flute = 1 - 0.035 * Math.max(0, Math.cos(a * (lod === 'high' ? 12 : 5))) ** 2;
      v.x *= flute;
      v.z *= flute;
    }
    const s = v.dot(cut);
    if (s > cutD) v.addScaledVector(cut, cutD - s);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const shaftFlat = shaft.toNonIndexed();
  shaft.dispose();
  shaftFlat.computeVertexNormals();
  shaftFlat.translate(0, height / 2 + 1.2, 0);
  const parts = [tint(shaftFlat, 0.9 + rand() * 0.1)];
  for (let i = 0; i < 3; i++) {
    const s = radius * (1.5 - i * 0.18);
    const step = new THREE.CylinderGeometry(s, s * 1.04, 0.4, Math.max(8, sides / 2));
    step.translate(0, 0.2 + i * 0.4, 0);
    parts.push(tint(step, 0.8));
  }
  const bands: THREE.BufferGeometry[] = [];
  for (const yf of [0.18, 0.55]) {
    const y = height * yf + 1.2;
    const r = radius * (1 - 0.14 * yf) * 1.03;
    const band = new THREE.TorusGeometry(r, 0.09, 6, sides * 2);
    band.rotateX(Math.PI / 2);
    band.translate(0, y, 0);
    bands.push(band);
  }
  return { stone: merge(parts), brass: merge(bands) };
}

/**
 * The platform's underside: an inverted stepped stone mass and concentric steel ribs with radial
 * spokes — the engineering that holds the arena up, readable from the elevated camera.
 */
export function underside(
  radius: number,
  lod: Lod,
): {
  stone: THREE.BufferGeometry;
  /**
   * The tiers' upward-facing tops: hidden under the slabs (or, from the side, in the deep shadow
   * under the tier above), so they take an unlit dark material — a software rasteriser shades
   * hidden pixels too, and the first is as wide as the platform.
   */
  caps: THREE.BufferGeometry;
  steel: THREE.BufferGeometry;
  ember: THREE.BufferGeometry;
} {
  // Even, so the caps' rim vertices (CircleGeometry from θ = π/2) meet the walls' exactly.
  const sides = lod === 'high' ? 40 : 18;
  const stone: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  const tiers = [
    { top: radius * 0.97, bottom: radius * 0.82, h: 2.2, y: -2.0 },
    { top: radius * 0.8, bottom: radius * 0.55, h: 3.0, y: -4.4 },
    { top: radius * 0.52, bottom: radius * 0.2, h: 5.5, y: -8.4 },
  ];
  for (const t of tiers) {
    const y = t.y - t.h / 2 + 1.1;
    const wall = new THREE.CylinderGeometry(t.top, t.bottom, t.h, sides, 2, true);
    wall.translate(0, y, 0);
    stone.push(tint(wall, 0.62));
    const bottom = new THREE.CircleGeometry(t.bottom, sides, Math.PI / 2).rotateX(Math.PI / 2);
    bottom.translate(0, y - t.h / 2, 0);
    stone.push(tint(bottom, 0.62));
    const top = new THREE.CircleGeometry(t.top, sides, Math.PI / 2).rotateX(-Math.PI / 2);
    top.translate(0, y + t.h / 2, 0);
    caps.push(top);
  }
  const steel: THREE.BufferGeometry[] = [];
  for (const [r, y] of [
    [radius * 1.0, -2.2],
    [radius * 0.84, -3.4],
    [radius * 0.6, -6.0],
  ] as const) {
    const ring = new THREE.TorusGeometry(r, 0.24, 8, sides * 2);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    steel.push(ring);
  }
  const spokes = lod === 'high' ? 16 : 8;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = radius * 0.62;
    const spoke = new THREE.BoxGeometry(len, 0.3, 0.22);
    spoke.translate(radius * 0.4, -3.0, 0);
    spoke.rotateY(a);
    steel.push(spoke);
  }
  // Glowing conduits hugging the lower tiers, held off the stone by steel clamps.
  const ember: THREE.BufferGeometry[] = [];
  const clamps = lod === 'high' ? 36 : 18;
  for (const c of [
    { r: radius * 0.7, y: -4.9, tube: 0.14 },
    { r: radius * 0.35, y: -10.5, tube: 0.1 },
  ]) {
    const conduit = new THREE.TorusGeometry(c.r, c.tube, 8, sides * 2);
    conduit.rotateX(Math.PI / 2);
    conduit.translate(0, c.y, 0);
    ember.push(conduit);
    for (let i = 0; i < clamps; i++) {
      const a = (i / clamps) * Math.PI * 2;
      // Thin along the conduit, deep toward the stone (local Z → radial after the turn).
      const clamp = new THREE.BoxGeometry(0.12, c.tube * 3.4, 0.9);
      clamp.rotateY(-a - Math.PI / 2);
      clamp.translate(Math.cos(a) * (c.r - 0.3), c.y, Math.sin(a) * (c.r - 0.3));
      steel.push(clamp);
    }
  }
  return { stone: merge(stone), caps: merge(caps), steel: merge(steel), ember: merge(ember) };
}

/**
 * A bronze fire brazier (Phase 07B practicals), standing on the ground at the origin: a stepped
 * foot, a slender stem with a collar, and a wide flared bowl whose rim sits at `BRAZIER_RIM`.
 * Returns the bronze body and the bed of coals inside the bowl (lit by the fire's own shader).
 */
export const BRAZIER_RIM = 1.42;

export function brazier(lod: Lod): { bronze: THREE.BufferGeometry; coals: THREE.BufferGeometry } {
  const seg = lod === 'high' ? 28 : 14;
  // Outer profile from the foot up to the rim, then down the inside of the bowl.
  const profile: [number, number][] = [
    [0.0, 0.0],
    [0.44, 0.0],
    [0.44, 0.07],
    [0.34, 0.11],
    [0.3, 0.16],
    [0.15, 0.24],
    [0.11, 0.42],
    [0.1, 0.92],
    [0.17, 0.97],
    [0.17, 1.02],
    [0.13, 1.05],
    [0.22, 1.09],
    [0.46, 1.2],
    [0.6, 1.36],
    [0.66, BRAZIER_RIM],
    [0.62, BRAZIER_RIM + 0.02],
    [0.55, 1.36],
    [0.4, 1.26],
    [0.0, 1.22],
  ];
  const bronze = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
  bronze.computeVertexNormals();
  // A heaped bed of coals just below the rim.
  const coals = new THREE.ConeGeometry(0.5, 0.16, seg, 1, true);
  coals.translate(0, 1.3, 0);
  return { bronze: merge([tint(bronze, 0.9)]), coals: merge([coals]) };
}

/**
 * A field pillar standing exactly on its collider: a fluted shaft (never wider than the collider
 * where the core can touch it), a low brass base, a banded stone capital, a glowing rune band.
 */
export function fieldPillar(
  radius: number,
  height: number,
  lod: Lod,
): { stone: THREE.BufferGeometry; brass: THREE.BufferGeometry; rune: THREE.BufferGeometry } {
  const seg = lod === 'high' ? 48 : 24;
  const flutes = lod === 'high' ? 16 : 0;
  const shaft = new THREE.CylinderGeometry(radius * 0.97, radius, height, seg, 1, false);
  if (flutes) {
    const p = shaft.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      if (Math.hypot(x, z) < radius * 0.5) continue;
      const k = 1 - 0.045 * Math.max(0, Math.cos(Math.atan2(z, x) * flutes)) ** 3;
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    shaft.computeVertexNormals();
  }
  shaft.translate(0, height / 2, 0);
  const base = new THREE.CylinderGeometry(radius * 1.05, radius * 1.08, 0.32, seg);
  base.translate(0, 0.16, 0);
  // A stone capital with a brass band round it: no broad brass face looking up at the sky.
  const cap = new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, 0.24, seg);
  cap.translate(0, height + 0.12, 0);
  const band = new THREE.CylinderGeometry(radius * 1.112, radius * 1.112, 0.08, seg, 1, true);
  band.translate(0, height + 0.12, 0);
  // A band of inscription (render: a glyph texture wrapping it twice), not a solid glowing ring.
  const rune = new THREE.CylinderGeometry(radius * 1.004, radius * 1.004, 0.18, seg, 1, true);
  rune.translate(0, height * 0.68, 0);
  return {
    stone: merge([tint(shaft, 1), tint(cap, 0.9)]),
    brass: merge([base, band]),
    rune: merge([rune]),
  };
}

/**
 * A wielder's plinth behind the far wall: a stone drum with the seat's outline (hexagon or
 * diamond — the HUD glyphs), a brass edge band and a glowing inlay of the same shape.
 */
export function plinth(sides: 4 | 6): {
  stone: THREE.BufferGeometry;
  brass: THREE.BufferGeometry;
  inlay: THREE.BufferGeometry;
} {
  const body = new THREE.CylinderGeometry(1.45, 1.7, 1.6, sides);
  body.translate(0, 0.8, 0);
  const top = new THREE.CylinderGeometry(1.55, 1.5, 0.12, sides);
  top.translate(0, 1.66, 0);
  const foot = new THREE.CylinderGeometry(1.74, 1.78, 0.14, sides);
  foot.translate(0, 0.07, 0);
  // Brass only as an edge band (open-ended): a broad brass face reflects the dark sky as mottle.
  const band = new THREE.CylinderGeometry(1.565, 1.565, 0.07, sides, 1, true);
  band.translate(0, 1.66, 0);
  // Cylinder corners sit at 90° + k·360°/sides from +X (toward +Z); a hexagonal ring needs a 30°
  // start to put its corners on the same bearings (a square's already match).
  const inlay = new THREE.RingGeometry(0.85, 1.0, sides, 1, sides === 6 ? Math.PI / 6 : 0);
  inlay.rotateX(-Math.PI / 2);
  inlay.translate(0, 1.725, 0);
  return {
    stone: merge([tint(body, 0.92), tint(top, 1), tint(foot, 0.85)]),
    brass: merge([band]),
    inlay: merge([inlay]),
  };
}

/** The two goal posts, on their colliders (the +X end; the component mirrors it). */
export function goalPosts(
  mouthHalfWidth: number,
  mouthHeight: number,
  postRadius: number,
  lod: Lod,
): THREE.BufferGeometry {
  const seg = lod === 'high' ? 24 : 12;
  return merge(
    [-1, 1].map((s) => {
      const post = new THREE.CylinderGeometry(postRadius, postRadius * 1.1, mouthHeight, seg);
      post.translate(0, mouthHeight / 2, s * mouthHalfWidth);
      return post;
    }),
  );
}

/**
 * The goal cavity's walls on their colliders (the +X end): the side walls, and the back wall with
 * the roof (which a camera behind the gate hides, so they are separate).
 */
export function gateCavity(g: {
  readonly depth: number;
  readonly mouthHeight: number;
  readonly mouthHalfWidth: number;
}): { sides: THREE.BufferGeometry; back: THREE.BufferGeometry } {
  const sides = [-1, 1].map((s) => {
    const b = new THREE.BoxGeometry(g.depth, g.mouthHeight, 0.5);
    b.translate(g.depth / 2, g.mouthHeight / 2, s * (g.mouthHalfWidth + 0.25));
    return tint(b, 0.85);
  });
  const back = new THREE.BoxGeometry(0.5, g.mouthHeight, g.mouthHalfWidth * 2 + 1);
  back.translate(g.depth + 0.25, g.mouthHeight / 2, 0);
  const roof = new THREE.BoxGeometry(g.depth + 0.5, 0.5, g.mouthHalfWidth * 2 + 1);
  roof.translate(g.depth / 2, g.mouthHeight + 0.25, 0);
  return { sides: merge(sides), back: merge([tint(back, 0.7), tint(roof, 0.85)]) };
}
