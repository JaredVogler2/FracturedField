/**
 * The Rift Core's authored geometry (7C / D09): a shell of separate crystal plates around the
 * plasma heart, and the engraved gyroscope bands that turn about it. Pure geometry; materials and
 * motion live in the component.
 */
import * as THREE from 'three';

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/**
 * The shell: the faces of an icosahedron become separate crystal plates, shrunk toward their
 * centres so seams of varying width open between neighbours, with an outer face, an inner face
 * and side walls. The corners are jittered (shared corners alike, so neighbours still meet) and
 * some plates are left out: the shell is broken, and the heart shows through. Per vertex:
 * - `aDir`: the plate's outward direction (unit) — the vertex shader parts the plates along it;
 * - `aSide`: 1 on the side walls (the seams, which glow), 0 on the faces;
 * - `aDepth`: on a side wall, 0 at its outer edge and 1 at its inner edge (light from inside);
 * - `aBary`: barycentric coordinates on the outer face (light bleeds in from its edges); 1 elsewhere;
 * - `aSeed`: one random value per plate (so the plates do not move in lockstep).
 *
 * Non-indexed, with flat normals: every plate reads as a cut facet.
 */
export function corePlateGeometry(
  radius: number,
  {
    detail = 1,
    gap = 0.06,
    thickness = 0.15,
    jitter = 0.14,
    tilt = 0.16,
    proud = 0.06,
    holes = 0.22,
    seed = 7,
  } = {},
): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const src = ico.attributes.position as THREE.BufferAttribute;
  const faces = src.count / 3;
  let rng = seed >>> 0;
  const rand = () => {
    rng = (rng + 0x6d2b79f5) >>> 0;
    let t = rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /** A corner's jitter, the same wherever that corner appears (hashed from its position). */
  const hash = (x: number, y: number, z: number, k: number) => {
    let h = Math.imul(Math.round(x * 1000) + 7919 * k, 73856093);
    h ^= Math.imul(Math.round(y * 1000), 19349663);
    h ^= Math.imul(Math.round(z * 1000), 83492791);
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    return ((h ^ (h >>> 15)) >>> 0) / 4294967296 - 0.5;
  };
  const jittered = (c: THREE.Vector3) => {
    const x = c.x;
    const y = c.y;
    const z = c.z;
    c.x += hash(x, y, z, 1) * jitter;
    c.y += hash(x, y, z, 2) * jitter;
    c.z += hash(x, y, z, 3) * jitter;
    return c.normalize().multiplyScalar(1 + hash(x, y, z, 4) * jitter * 0.6);
  };
  const pos: number[] = [];
  const dir: number[] = [];
  const side: number[] = [];
  const depth: number[] = [];
  const bary: number[] = [];
  const seeds: number[] = [];
  const push = (
    p: THREE.Vector3,
    g: THREE.Vector3,
    isSide: number,
    d: number,
    b: readonly [number, number, number],
    s: number,
  ) => {
    pos.push(p.x, p.y, p.z);
    dir.push(g.x, g.y, g.z);
    side.push(isSide);
    depth.push(d);
    bary.push(b[0], b[1], b[2]);
    seeds.push(s);
  };
  const B0 = [1, 0, 0] as const;
  const B1 = [0, 1, 0] as const;
  const B2 = [0, 0, 1] as const;
  const NONE = [1, 1, 1] as const;
  /** One triangle, wound so its normal points along `out`. */
  const tri = (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    out: THREE.Vector3,
    g: THREE.Vector3,
    isSide: number,
    d: readonly [number, number, number],
    bs: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ],
    s: number,
  ) => {
    tmpA.subVectors(b, a);
    tmpB.subVectors(c, a);
    tmpN.crossVectors(tmpA, tmpB);
    if (tmpN.dot(out) >= 0) {
      push(a, g, isSide, d[0], bs[0], s);
      push(b, g, isSide, d[1], bs[1], s);
      push(c, g, isSide, d[2], bs[2], s);
    } else {
      push(a, g, isSide, d[0], bs[0], s);
      push(c, g, isSide, d[2], bs[2], s);
      push(b, g, isSide, d[1], bs[1], s);
    }
  };
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const outer = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const inner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const centre = new THREE.Vector3();
  const g = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const sideOut = new THREE.Vector3();
  const plateCentre = new THREE.Vector3();
  const axis = new THREE.Vector3();
  for (let f = 0; f < faces; f++) {
    const s = rand();
    const plateGap = gap * (0.6 + 0.8 * rand());
    const plateThick = thickness * (0.75 + 0.5 * rand());
    // Each plate sits a little proud or sunk and tilted on its own: shards, not a tiling.
    const lift = 1 + (rand() - 0.5) * 2 * proud;
    axis.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const angle = (rand() - 0.5) * 2 * tilt;
    if (rand() < holes) continue; // a missing plate: a window onto the heart
    for (let k = 0; k < 3; k++) jittered(corners[k]!.fromBufferAttribute(src, f * 3 + k));
    centre.copy(corners[0]!).add(corners[1]!).add(corners[2]!).divideScalar(3);
    g.copy(centre).normalize();
    inward.copy(g).negate();
    for (let k = 0; k < 3; k++) {
      // Shrink toward the face centre (the seams), tilt about the centre, lift or sink.
      outer[k]!.copy(corners[k]!)
        .sub(centre)
        .multiplyScalar(1 - plateGap)
        .applyAxisAngle(axis, angle)
        .add(centre)
        .multiplyScalar(radius * lift);
      inner[k]!.copy(outer[k]!).multiplyScalar(1 - plateThick);
    }
    tri(outer[0]!, outer[1]!, outer[2]!, g, g, 0, [0, 0, 0], [B0, B1, B2], s);
    tri(inner[0]!, inner[1]!, inner[2]!, inward, g, 0, [1, 1, 1], [NONE, NONE, NONE], s);
    plateCentre.copy(centre).multiplyScalar(radius * lift);
    for (let k = 0; k < 3; k++) {
      const a = outer[k]!;
      const b = outer[(k + 1) % 3]!;
      const ai = inner[k]!;
      const bi = inner[(k + 1) % 3]!;
      // A side wall faces away from the plate's centre, into the seam.
      mid.copy(a).add(b).multiplyScalar(0.5);
      sideOut.copy(mid).sub(plateCentre).normalize();
      tri(a, b, bi, sideOut, g, 1, [0, 0, 1], [NONE, NONE, NONE], s);
      tri(a, bi, ai, sideOut, g, 1, [0, 1, 1], [NONE, NONE, NONE], s);
    }
  }
  ico.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDir', new THREE.Float32BufferAttribute(dir, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setAttribute('aBary', new THREE.Float32BufferAttribute(bary, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geo.computeVertexNormals();
  // Room for the plates to part (see the vertex shader's explode).
  geo.computeBoundingSphere();
  geo.boundingSphere!.radius *= 1.3;
  return geo;
}

/**
 * A gyroscope band: a flat ring with a rectangular section (radial `width`, axial `height`), its
 * axis along +y. The outer face carries uv (u around, v across) for the engraved glyphs; every
 * other face maps outside the glyph strip (v < 0), where it is blank.
 */
export function bandGeometry(
  radius: number,
  width: number,
  height: number,
  segments = 96,
  repeats = 6,
): THREE.BufferGeometry {
  const ri = radius - width;
  const h = height / 2;
  // The section, walked around: outer face, top, inner face, bottom.
  const section: [number, number, number][] = [
    // [radius, y, v]
    [radius, -h, 0],
    [radius, h, 1],
    [ri, h, -1],
    [ri, -h, -1],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const u0 = (i / segments) * repeats;
    const u1 = ((i + 1) / segments) * repeats;
    for (let s = 0; s < 4; s++) {
      const p = section[s]!;
      const q = section[(s + 1) % 4]!;
      const outerFace = s === 0;
      const vp = outerFace ? p[2] : -1;
      const vq = outerFace ? q[2] : -1;
      const P0 = [p[0] * Math.cos(a0), p[1], p[0] * Math.sin(a0)];
      const P1 = [p[0] * Math.cos(a1), p[1], p[0] * Math.sin(a1)];
      const Q0 = [q[0] * Math.cos(a0), q[1], q[0] * Math.sin(a0)];
      const Q1 = [q[0] * Math.cos(a1), q[1], q[0] * Math.sin(a1)];
      // Wound to face out of the section (outward, up, inward, down in turn).
      pos.push(...P0, ...Q0, ...P1, ...P1, ...Q0, ...Q1);
      uv.push(u0, vp, u0, vq, u1, vp, u1, vp, u0, vq, u1, vq);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}
