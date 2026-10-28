import * as THREE from 'three';

/**
 * The spectral hand (7D / WP9, ADR-0009's "luminous hands"): the hand a wielder reaches across
 * the field with, drawn at its seat's force point. Two poses with the same topology — open and a
 * fist — so one mesh can blend between them per hand in its vertex shader.
 *
 * Built in a hand frame, one hand length long: origin at the wrist, +Z along the fingers, +Y the
 * back of the hand (palm down), +X the thumb's side.
 */

interface FingerSpec {
  /** Knuckle (or thumb root) position, the finger's rest direction and its length. */
  readonly base: readonly [number, number, number];
  readonly dir: readonly [number, number, number];
  readonly length: number;
  readonly radius: number;
  /** Joint bends (radians, toward the palm) open and in a fist. */
  readonly open: readonly [number, number, number];
  readonly fist: readonly [number, number, number];
  /** Axis the joints bend about. */
  readonly axis: readonly [number, number, number];
}

const FINGERS: readonly FingerSpec[] = [
  // index, middle, ring, little: knuckles across the palm's end, a slight splay
  {
    base: [0.15, 0, 0.44],
    dir: [0.1, 0, 1],
    length: 0.42,
    radius: 0.046,
    open: [0.1, 0.12, 0.08],
    fist: [1.45, 1.65, 1.15],
    axis: [1, 0, 0],
  },
  {
    base: [0.05, 0.004, 0.46],
    dir: [0.03, 0, 1],
    length: 0.46,
    radius: 0.048,
    open: [0.1, 0.12, 0.08],
    fist: [1.5, 1.7, 1.15],
    axis: [1, 0, 0],
  },
  {
    base: [-0.05, 0.002, 0.45],
    dir: [-0.04, 0, 1],
    length: 0.43,
    radius: 0.045,
    open: [0.12, 0.14, 0.1],
    fist: [1.55, 1.7, 1.15],
    axis: [1, 0, 0],
  },
  {
    base: [-0.145, -0.004, 0.41],
    dir: [-0.12, 0, 1],
    length: 0.34,
    radius: 0.04,
    open: [0.14, 0.16, 0.12],
    fist: [1.6, 1.7, 1.1],
    axis: [1, 0, 0],
  },
  // the thumb: out from the heel of the palm, folding across the fingers in a fist
  {
    base: [0.19, -0.03, 0.12],
    dir: [0.75, -0.15, 0.65],
    length: 0.38,
    radius: 0.055,
    open: [0.05, 0.1, 0.1],
    fist: [0.9, 0.7, 0.5],
    axis: [0.35, 0.6, -0.72],
  },
];

/** Samples along each finger (its three bones, bent at the joints) and around it. */
const ALONG = 10;

export interface SpectralHandGeometry {
  /** Open pose positions and normals, the fist's, and the shared triangles. */
  readonly open: Float32Array;
  readonly openNormal: Float32Array;
  readonly fist: Float32Array;
  readonly fistNormal: Float32Array;
  readonly index: number[];
  readonly vertices: number;
}

/** A tube's ring centres along a finger in pose `bends`, from its base to its tip. */
export function fingerPath(f: FingerSpec, bends: readonly number[]): THREE.Vector3[] {
  const bone = [0.42, 0.33, 0.25].map((k) => k * f.length);
  const axis = new THREE.Vector3(...f.axis).normalize();
  const dir = new THREE.Vector3(...f.dir).normalize();
  const p = new THREE.Vector3(...f.base);
  const out: THREE.Vector3[] = [p.clone()];
  const q = new THREE.Quaternion();
  // Each bone bends at its own base: ALONG samples spread over the three bones.
  const per = [4, 3, 3];
  for (let b = 0; b < 3; b++) {
    dir.applyQuaternion(q.setFromAxisAngle(axis, bends[b]!));
    for (let k = 1; k <= per[b]!; k++) out.push(p.addScaledVector(dir, bone[b]! / per[b]!).clone());
  }
  return out;
}

/** Builds both poses (`segs` around each finger and the palm). */
export function buildSpectralHand(segs = 8): SpectralHandGeometry {
  const open: number[] = [];
  const fist: number[] = [];
  const index: number[] = [];
  let vertices = 0;
  const ring = (
    centres: readonly THREE.Vector3[],
    radii: readonly number[],
    up: THREE.Vector3,
    out: number[],
  ) => {
    const t = new THREE.Vector3();
    const s = new THREE.Vector3();
    const n = new THREE.Vector3();
    centres.forEach((c, i) => {
      t.subVectors(centres[Math.min(centres.length - 1, i + 1)]!, centres[Math.max(0, i - 1)]!);
      t.normalize();
      n.copy(up).addScaledVector(t, -up.dot(t)).normalize();
      s.crossVectors(t, n);
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const r = radii[i]!;
        out.push(
          c.x + (n.x * Math.cos(a) + s.x * Math.sin(a)) * r,
          c.y + (n.y * Math.cos(a) + s.y * Math.sin(a)) * r,
          c.z + (n.z * Math.cos(a) + s.z * Math.sin(a)) * r,
        );
      }
    });
  };
  const tube = (rings: number) => {
    for (let i = 0; i < rings - 1; i++)
      for (let j = 0; j < segs; j++) {
        const a = vertices + i * segs + j;
        const b = vertices + i * segs + ((j + 1) % segs);
        index.push(a, a + segs, b, b, a + segs, b + segs);
      }
    vertices += rings * segs;
  };
  const up = new THREE.Vector3(0, 1, 0);

  // The palm: wrist to knuckles, an ellipse wide across and thin through (the same in both).
  const palmZ = [0, 0.12, 0.26, 0.38, 0.47];
  const palmW = [0.15, 0.18, 0.205, 0.21, 0.19];
  const palmT = [0.06, 0.065, 0.06, 0.055, 0.045];
  for (const out of [open, fist]) {
    palmZ.forEach((z, i) => {
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        out.push(Math.cos(a) * palmW[i]!, Math.sin(a) * palmT[i]!, z);
      }
    });
  }
  // The palm's rings run along +Z with the angle from +X toward +Y: wind them outward.
  for (let i = 0; i < palmZ.length - 1; i++)
    for (let j = 0; j < segs; j++) {
      const a = vertices + i * segs + j;
      const b = vertices + i * segs + ((j + 1) % segs);
      index.push(a, b, a + segs, b, b + segs, a + segs);
    }
  vertices += palmZ.length * segs;

  // Fingers and thumb, tapering to a rounded tip.
  for (const f of FINGERS) {
    const radii = Array.from({ length: ALONG + 1 }, (_, i) => {
      const u = i / ALONG;
      return f.radius * (1 - 0.3 * u) * (i === ALONG ? 0.35 : 1);
    });
    ring(fingerPath(f, f.open), radii, up, open);
    ring(fingerPath(f, f.fist), radii, up, fist);
    tube(ALONG + 1);
  }

  const normals = (pos: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    const n = new Float32Array(g.attributes.normal!.array);
    g.dispose();
    return n;
  };
  return {
    open: new Float32Array(open),
    openNormal: normals(open),
    fist: new Float32Array(fist),
    fistNormal: normals(fist),
    index,
    vertices,
  };
}

export { FINGERS as SPECTRAL_FINGERS };

const zAxis = new THREE.Vector3();
const xAxis = new THREE.Vector3();
const yAxis = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Places a spectral hand centred at `centre`, reaching away from `from` (the wielder; only the
 * horizontal direction counts), turned `turn` radians about the vertical (a twist) and tipped down
 * by `pitch` toward the field, `size` long: writes its matrix (a left hand is the mirror image)
 * and returns its wrist in `wrist`.
 */
export function placeSpectralHand(
  centre: THREE.Vector3,
  from: THREE.Vector3,
  left: boolean,
  size: number,
  pitch: number,
  out: THREE.Matrix4,
  wrist: THREE.Vector3,
  turn = 0,
): THREE.Vector3 {
  zAxis.set(centre.x - from.x, 0, centre.z - from.z);
  if (zAxis.lengthSq() < 1e-8) zAxis.set(0, 0, 1);
  zAxis.normalize();
  if (turn !== 0) {
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    zAxis.set(zAxis.x * c + zAxis.z * s, 0, zAxis.z * c - zAxis.x * s);
  }
  zAxis.set(zAxis.x * Math.cos(pitch), -Math.sin(pitch), zAxis.z * Math.cos(pitch));
  xAxis.crossVectors(WORLD_UP, zAxis).normalize();
  yAxis.crossVectors(zAxis, xAxis);
  if (left) xAxis.negate();
  wrist.copy(centre).addScaledVector(zAxis, -0.45 * size);
  out
    .makeBasis(xAxis.multiplyScalar(size), yAxis.multiplyScalar(size), zAxis.multiplyScalar(size))
    .setPosition(wrist);
  return wrist;
}
