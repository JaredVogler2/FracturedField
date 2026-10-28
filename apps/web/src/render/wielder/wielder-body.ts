import * as THREE from 'three';
import { RIG } from './wielder-rig';

/**
 * A wielder's body (7D / D10): an original, procedurally authored character, faceless behind a
 * lacquered mask with a glowing visor slit, in a long ceremonial coat with a sash and a brass
 * belt, metal pauldrons, conductor gauntlets over mitten hands, and boots planted on the plinth.
 * Every part is lofted from cross-sections along the skeleton and skinned to it, all in one mesh
 * with per-vertex colour, roughness, metalness and glow: one draw call per wielder.
 *
 * Built in the rest pose (arms hanging 12° out from the body) in RIG's frame: +Y up, +Z forward,
 * +X the wielder's left.
 */

/** The skeleton's bones; a bone's index is its skin index. */
export const BONES = [
  'root',
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'clavicle.L',
  'upperArm.L',
  'foreArm.L',
  'hand.L',
  'fingers.L',
  'clavicle.R',
  'upperArm.R',
  'foreArm.R',
  'hand.R',
  'fingers.R',
  'thigh.L',
  'shin.L',
  'foot.L',
  'thigh.R',
  'shin.R',
  'foot.R',
] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;

const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  'clavicle.L': 'chest',
  'upperArm.L': 'clavicle.L',
  'foreArm.L': 'upperArm.L',
  'hand.L': 'foreArm.L',
  'fingers.L': 'hand.L',
  'clavicle.R': 'chest',
  'upperArm.R': 'clavicle.R',
  'foreArm.R': 'upperArm.R',
  'hand.R': 'foreArm.R',
  'fingers.R': 'hand.R',
  'thigh.L': 'hips',
  'shin.L': 'thigh.L',
  'foot.L': 'shin.L',
  'thigh.R': 'hips',
  'shin.R': 'thigh.R',
  'foot.R': 'shin.R',
};

/** The arms hang this far out from the body in the rest pose (radians). */
export const REST_ARM_ANGLE = 0.21;

/** Rest positions of the joints (the bone origins), in RIG's frame. */
export function restJoints(): Record<BoneName, THREE.Vector3> {
  const j = {} as Record<BoneName, THREE.Vector3>;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  j.root = v(0, 0, 0);
  j.hips = v(0, RIG.hipY, 0);
  j.spine = v(0, RIG.spineY, 0);
  j.chest = v(0, RIG.chestY, 0);
  j.neck = v(0, RIG.neckY, 0);
  j.head = v(0, RIG.headY, 0);
  for (const [s, side] of [
    [1, 'L'],
    [-1, 'R'],
  ] as const) {
    const down = v(s * Math.sin(REST_ARM_ANGLE), -Math.cos(REST_ARM_ANGLE), 0);
    const shoulder = v(s * RIG.shoulderHalf, RIG.shoulderY, 0);
    const elbow = shoulder.clone().addScaledVector(down, RIG.arm.upper);
    const wrist = elbow.clone().addScaledVector(down, RIG.arm.lower);
    j[`clavicle.${side}`] = v(s * 0.04, RIG.shoulderY - 0.03, 0);
    j[`upperArm.${side}`] = shoulder;
    j[`foreArm.${side}`] = elbow;
    j[`hand.${side}`] = wrist;
    j[`fingers.${side}`] = wrist.clone().addScaledVector(down, 0.085);
    const hip = v(s * RIG.hipHalf, RIG.hipJointY, 0);
    j[`thigh.${side}`] = hip;
    j[`shin.${side}`] = v(s * RIG.hipHalf, RIG.hipJointY - RIG.leg.upper, 0);
    j[`foot.${side}`] = v(s * RIG.hipHalf, RIG.ankleY, 0);
  }
  return j;
}

/** The skeleton in its rest pose: bones with identity rotations at their joint offsets. */
export function buildSkeleton(): {
  bones: THREE.Bone[];
  root: THREE.Bone;
  skeleton: THREE.Skeleton;
} {
  const joints = restJoints();
  const bones = BONES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  BONES.forEach((name, i) => {
    const parent = PARENT[name];
    const bone = bones[i]!;
    if (parent) {
      bones[B[parent]]!.add(bone);
      bone.position.subVectors(joints[name], joints[parent]);
    } else bone.position.copy(joints[name]);
  });
  const root = bones[0]!;
  root.updateMatrixWorld(true);
  return { bones, root, skeleton: new THREE.Skeleton(bones) };
}

/** What a seat's wielder is made of (colours linear-ish sRGB hex). */
export interface WielderLook {
  /** Coat fabric, its trim, the sash. */
  readonly coat: string;
  readonly trim: string;
  readonly sash: string;
  /** The seat's metal (copper or silver) and its glow. */
  readonly metal: string;
  readonly glow: string;
  /** Mask lacquer, leather (boots, under-gauntlet, gloves). */
  readonly mask: string;
  readonly leather: string;
}

/** Glow channels: which uniform scales a vertex's glow. */
export const GLOW = { body: 0, left: 1, right: 2, visor: 3 } as const;

type Weights = readonly (readonly [number, number])[];

interface Section {
  /** Centre, the section's two axes (unit, perpendicular), its half-widths along them. */
  c: THREE.Vector3;
  ax: THREE.Vector3;
  az: THREE.Vector3;
  rx: number;
  rz: number;
}

/** Per-vertex surface: colour, roughness, metalness, glow strength and channel. */
interface Surface {
  color: THREE.Color;
  rough: number;
  metal: number;
  glow: number;
  channel: number;
}

interface Builder {
  pos: number[];
  col: number[];
  mat: number[];
  si: number[];
  sw: number[];
  idx: number[];
}

/**
 * Lofts rings of `segs` vertices through `sections` (closed loops unless `arc` is given) and
 * appends them: `skin(i, a)` and `surface(i, a)` give each vertex's bone weights and surface by
 * section index and angle; `shape` may move a vertex (a mask's flat face). Normals come later.
 */
function loft(
  b: Builder,
  sections: readonly Section[],
  segs: number,
  skin: (i: number, a: number) => Weights,
  surface: (i: number, a: number, s: Surface) => void,
  opts: { arc?: [number, number]; shape?: (p: THREE.Vector3, i: number, a: number) => void } = {},
): void {
  const base = b.pos.length / 3;
  const [a0, a1] = opts.arc ?? [0, Math.PI * 2];
  const closed = !opts.arc;
  const cols = closed ? segs : segs + 1;
  const p = new THREE.Vector3();
  const s: Surface = { color: new THREE.Color(), rough: 0.7, metal: 0, glow: 0, channel: 0 };
  sections.forEach((sec, i) => {
    for (let j = 0; j < cols; j++) {
      const a = a0 + ((a1 - a0) * j) / segs;
      p.copy(sec.c)
        .addScaledVector(sec.ax, Math.cos(a) * sec.rx)
        .addScaledVector(sec.az, Math.sin(a) * sec.rz);
      opts.shape?.(p, i, a);
      b.pos.push(p.x, p.y, p.z);
      s.glow = 0;
      s.channel = 0;
      surface(i, a, s);
      b.col.push(s.color.r, s.color.g, s.color.b);
      b.mat.push(s.rough, s.metal, s.glow, s.channel);
      const w = skin(i, a);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += w[k]?.[1] ?? 0;
      for (let k = 0; k < 4; k++) {
        b.si.push(w[k]?.[0] ?? 0);
        b.sw.push((w[k]?.[1] ?? 0) / (sum || 1));
      }
    }
  });
  for (let i = 0; i < sections.length - 1; i++) {
    for (let j = 0; j < (closed ? segs : segs); j++) {
      const j1 = closed ? (j + 1) % segs : j + 1;
      const r0 = base + i * cols;
      const r1 = base + (i + 1) * cols;
      // Winding: outward faces for sections running along +axis with the angle turning from ax
      // toward az; `orient` below fixes any part built the other way round.
      b.idx.push(r0 + j, r1 + j, r0 + j1, r0 + j1, r1 + j, r1 + j1);
    }
  }
}

/** Sections along a polyline of joints, each perpendicular to the path, `fwd` keeping roll. */
function limb(
  points: readonly THREE.Vector3[],
  radii: readonly (readonly [number, number])[],
  fwd: THREE.Vector3,
): Section[] {
  return points.map((c, i) => {
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(points.length - 1, i + 1)]!;
    const d = next.clone().sub(prev).normalize();
    const az = fwd.clone().addScaledVector(d, -fwd.dot(d)).normalize();
    const ax = new THREE.Vector3().crossVectors(az, d).normalize();
    return { c: c.clone(), ax, az, rx: radii[i]![0], rz: radii[i]![1] };
  });
}

/** `n` points evenly from `a` to `b` (inclusive). */
function along(a: THREE.Vector3, b: THREE.Vector3, n: number): THREE.Vector3[] {
  return Array.from({ length: n }, (_, i) => a.clone().lerp(b, i / (n - 1)));
}

/** Weights blending bone `a` into bone `b` as `t` goes 0 → 1 (smoothstep). */
function blend(a: number, b: number, t: number): Weights {
  const k = Math.min(1, Math.max(0, t));
  const s = k * k * (3 - 2 * k);
  return s <= 0
    ? [[a, 1]]
    : s >= 1
      ? [[b, 1]]
      : [
          [a, 1 - s],
          [b, s],
        ];
}

/** The rest-pose body for one seat's look; `detail` 1 (high) to 0 (low) sets the ring counts. */
export function buildBody(look: WielderLook, detail: number): THREE.BufferGeometry {
  const j = restJoints();
  const b: Builder = { pos: [], col: [], mat: [], si: [], sw: [], idx: [] };
  const seg = detail >= 0.5 ? 16 : 10;
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3(0, 0, 1);
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const coat = new THREE.Color(look.coat);
  const trim = new THREE.Color(look.trim);
  const sash = new THREE.Color(look.sash);
  const metal = new THREE.Color(look.metal);
  const mask = new THREE.Color(look.mask);
  const leather = new THREE.Color(look.leather);
  const ring = (y: number, rx: number, rz: number, z = 0): Section => ({
    c: new THREE.Vector3(0, y, z),
    ax: X,
    az: Z,
    rx,
    rz,
  });
  const fabric = (s: Surface, c: THREE.Color, rough = 0.82) => {
    s.color.copy(c);
    s.rough = rough;
    s.metal = 0;
  };
  const metallic = (s: Surface, c: THREE.Color, rough = 0.32) => {
    s.color.copy(c);
    s.rough = rough;
    s.metal = 1;
  };

  // Torso: pelvis to the neck's base, broad in the chest; the coat's body, trimmed at the waist.
  const torsoY = [0.9, 1.0, 1.1, 1.2, 1.3, 1.38, 1.44, 1.49, 1.53];
  const torsoR: [number, number][] = [
    [0.15, 0.1],
    [0.14, 0.095],
    [0.125, 0.088],
    [0.15, 0.1],
    [0.175, 0.112],
    [0.19, 0.115],
    [0.18, 0.11],
    [0.13, 0.09],
    [0.06, 0.055],
  ];
  loft(
    b,
    torsoY.map((y, i) => ring(y, torsoR[i]![0], torsoR[i]![1], i >= 4 ? 0.01 : 0)),
    seg,
    (i) => {
      const y = torsoY[i]!;
      if (y < RIG.spineY) return blend(B.hips, B.spine, (y - 0.98) / (RIG.spineY - 0.98));
      if (y < RIG.chestY)
        return blend(B.spine, B.chest, (y - RIG.spineY) / (RIG.chestY - RIG.spineY));
      return blend(B.chest, B.neck, (y - 1.46) / 0.07);
    },
    (i, a, s) => {
      fabric(s, coat);
      // The coat's front edges and the shoulder seams in trim.
      const front = Math.sin(a);
      if (front > 0.96 && torsoY[i]! > 1.0) fabric(s, trim, 0.6);
    },
  );

  // A high collar, flared, trimmed.
  loft(
    b,
    [
      ring(1.47, 0.085, 0.075, 0.005),
      ring(1.56, 0.07, 0.065, 0.0),
      ring(1.6, 0.078, 0.072, -0.005),
    ],
    seg,
    (i) => (i === 0 ? [[B.chest, 1]] : blend(B.chest, B.neck, i / 2)),
    (_i, _a, s) => fabric(s, trim, 0.55),
  );

  // Neck and the masked head: a smooth helmet with a flat lacquered face plate and a glowing slit.
  const headY = [1.6, 1.64, 1.69, 1.74, 1.77, 1.8, 1.83, 1.855, 1.87];
  const headR: [number, number][] = [
    [0.05, 0.05],
    [0.075, 0.085],
    [0.09, 0.1],
    [0.095, 0.105],
    [0.095, 0.104],
    [0.09, 0.1],
    [0.075, 0.085],
    [0.05, 0.06],
    [0.012, 0.015],
  ];
  loft(
    b,
    headY.map((y, i) => ring(y, headR[i]![0], headR[i]![1], 0.01)),
    seg,
    (i) => (i === 0 ? blend(B.neck, B.head, 0.5) : [[B.head, 1]]),
    (i, a, s) => {
      const y = headY[i]!;
      const front = Math.sin(a);
      if (front > 0.55 && y > 1.73 && y < 1.78) {
        // The visor slit: dark glass that glows the seat's colour.
        s.color.setRGB(0.02, 0.02, 0.025);
        s.rough = 0.2;
        s.metal = 0;
        s.glow = 1;
        s.channel = GLOW.visor;
      } else if (front > 0.4 && y < 1.73) metallic(s, mask, 0.18);
      else metallic(s, mask, 0.28);
      if (Math.abs(Math.cos(a)) < 0.12 && y > 1.79) metallic(s, metal, 0.3); // the crest line
    },
    {
      // Flatten the face into a plate, and raise a low crest from brow to nape.
      shape: (p, i, a) => {
        const front = Math.sin(a);
        if (front > 0.5) p.z = Math.min(p.z, 0.01 + 0.09 + (front - 0.5) * 0.012);
        if (headY[i]! > 1.79 && Math.abs(Math.cos(a)) < 0.2) p.y += 0.012;
      },
    },
  );

  // Arms, gauntlets and hands, both sides.
  for (const side of ['L', 'R'] as const) {
    const s = side === 'L' ? 1 : -1;
    const sh = j[`upperArm.${side}`];
    const el = j[`foreArm.${side}`];
    const wr = j[`hand.${side}`];
    const kn = j[`fingers.${side}`];
    const dirArm = wr.clone().sub(sh).normalize();
    const channel = side === 'L' ? GLOW.left : GLOW.right;
    // Sleeve: shoulder to wrist, the coat's fabric over the upper arm.
    const armPts = [
      sh.clone().addScaledVector(dirArm, -0.02),
      ...along(sh, el, 4).slice(1),
      ...along(el, wr, 4).slice(1),
    ];
    const armR: [number, number][] = [
      [0.06, 0.06],
      [0.056, 0.054],
      [0.05, 0.05],
      [0.045, 0.046],
      [0.046, 0.047],
      [0.042, 0.043],
      [0.036, 0.036],
    ];
    const upperLen = RIG.arm.upper;
    loft(
      b,
      limb(armPts, armR, fwd),
      seg,
      (i) => {
        const d = armPts[i]!.distanceTo(sh) * (i === 0 ? -1 : 1);
        if (d < 0.03) return blend(B[`clavicle.${side}`], B[`upperArm.${side}`], (d + 0.02) / 0.05);
        if (d < upperLen + 0.04)
          return blend(B[`upperArm.${side}`], B[`foreArm.${side}`], (d - (upperLen - 0.04)) / 0.08);
        return blend(
          B[`foreArm.${side}`],
          B[`hand.${side}`],
          (d - (upperLen + RIG.arm.lower - 0.03)) / 0.04,
        );
      },
      (_i, _a, su) => fabric(su, coat),
    );
    // Pauldron: a metal shell over the shoulder.
    const pdir = new THREE.Vector3(s, 0.35, 0).normalize();
    const pc = sh.clone().addScaledVector(up, 0.02);
    loft(
      b,
      [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const r = 0.095 * Math.sin(Math.PI * (0.5 + 0.5 * t)) + 0.004;
        const c = pc.clone().addScaledVector(pdir, 0.015 + 0.06 * (1 - t));
        return {
          c,
          ax: Z,
          az: new THREE.Vector3().crossVectors(pdir, Z).normalize(),
          rx: r * 1.05,
          rz: r,
        };
      }),
      seg,
      () => [
        [B[`upperArm.${side}`], 0.6],
        [B[`clavicle.${side}`], 0.4],
      ],
      (i, _a, su) => {
        metallic(su, metal, 0.34);
        if (i === 1) {
          su.glow = 0.6;
          su.channel = channel;
        }
      },
    );
    // Gauntlet: a flared metal cuff over the forearm, conductor lines that glow with the cast.
    const gPts = along(el.clone().lerp(wr, 0.35), wr.clone().addScaledVector(dirArm, 0.012), 5);
    const gR: [number, number][] = [
      [0.05, 0.051],
      [0.054, 0.055],
      [0.058, 0.059],
      [0.062, 0.062],
      [0.064, 0.064],
    ];
    loft(
      b,
      limb(gPts, gR, fwd),
      seg,
      (i) => blend(B[`foreArm.${side}`], B[`hand.${side}`], (i - 3) / 1.5),
      (i, a, su) => {
        metallic(su, metal, 0.28);
        if (i === 2 || (i === 4 && Math.sin(a) > -0.2)) {
          su.glow = 1;
          su.channel = channel;
        }
      },
    );
    // Hand: a gloved mitten (palm to knuckles), the fingers on their own bone, and a thumb.
    const palmPts = along(wr, kn, 3);
    const palmFwd = new THREE.Vector3(-s, 0, 0); // the palm faces the body at rest
    loft(
      b,
      limb(
        palmPts,
        [
          [0.038, 0.018],
          [0.046, 0.02],
          [0.045, 0.018],
        ],
        palmFwd,
      ),
      seg,
      () => [[B[`hand.${side}`], 1]],
      (_i, _a, su) => fabric(su, leather, 0.6),
    );
    const tip = kn.clone().addScaledVector(dirArm, 0.075);
    loft(
      b,
      limb(
        along(kn, tip, 3),
        [
          [0.044, 0.017],
          [0.04, 0.016],
          [0.02, 0.012],
        ],
        palmFwd,
      ),
      seg,
      (i) =>
        i === 0 ? blend(B[`hand.${side}`], B[`fingers.${side}`], 0.5) : [[B[`fingers.${side}`], 1]],
      (_i, _a, su) => fabric(su, leather, 0.6),
    );
    const tBase = wr.clone().addScaledVector(dirArm, 0.03).addScaledVector(Z, 0.03);
    const tEnd = tBase.clone().addScaledVector(dirArm, 0.05).addScaledVector(Z, 0.025);
    loft(
      b,
      limb(
        [tBase, tEnd],
        [
          [0.016, 0.016],
          [0.011, 0.011],
        ],
        palmFwd,
      ),
      Math.max(6, seg / 2),
      () => [[B[`hand.${side}`], 1]],
      (_i, _a, su) => fabric(su, leather, 0.6),
    );

    // Leg: hip to ankle in the trousers; a boot from mid-shin, its foot reaching forward.
    const hip = j[`thigh.${side}`];
    const knee = j[`shin.${side}`];
    const ankle = j[`foot.${side}`];
    const legPts = [
      ...along(hip.clone().addScaledVector(up, 0.03), knee, 4),
      ...along(knee, ankle, 4).slice(1),
    ];
    const legR: [number, number][] = [
      [0.085, 0.085],
      [0.075, 0.078],
      [0.066, 0.068],
      [0.056, 0.06],
      [0.058, 0.062],
      [0.05, 0.054],
      [0.044, 0.046],
    ];
    loft(
      b,
      limb(legPts, legR, fwd),
      seg,
      (i) => {
        const y = legPts[i]!.y;
        if (y > knee.y + 0.04) return blend(B.hips, B[`thigh.${side}`], (hip.y + 0.03 - y) / 0.05);
        return blend(B[`thigh.${side}`], B[`shin.${side}`], (knee.y + 0.04 - y) / 0.08);
      },
      (_i, _a, su) => fabric(su, coat, 0.85),
    );
    const bootPts = along(
      knee.clone().lerp(ankle, 0.35),
      ankle.clone().addScaledVector(up, -0.02),
      4,
    );
    loft(
      b,
      limb(
        bootPts,
        [
          [0.056, 0.06],
          [0.054, 0.058],
          [0.05, 0.055],
          [0.052, 0.058],
        ],
        fwd,
      ),
      seg,
      (i) => blend(B[`shin.${side}`], B[`foot.${side}`], (i - 2) / 1.2),
      (i, _a, su) => {
        fabric(su, leather, 0.5);
        if (i === 0) metallic(su, metal, 0.35); // the boot's metal rim
      },
    );
    // The foot: heel to toe along +Z, flat on the sole.
    const footSecs: Section[] = [-0.06, -0.02, 0.04, 0.1, 0.15].map((z, i) => ({
      c: new THREE.Vector3(hip.x, 0.045 - (i === 4 ? 0.01 : 0), z),
      ax: X,
      az: up,
      rx: [0.045, 0.05, 0.052, 0.046, 0.03][i]!,
      rz: [0.045, 0.046, 0.04, 0.032, 0.02][i]!,
    }));
    loft(
      b,
      footSecs,
      seg,
      () => [[B[`foot.${side}`], 1]],
      (_i, _a, su) => fabric(su, leather, 0.5),
      { shape: (p) => void (p.y = Math.max(0.002, p.y)) },
    );
  }

  // The coat's skirt: from the waist to just below the knees, open at the front, its sides
  // following the thighs and its back the hips.
  const skirtY = [1.12, 1.0, 0.86, 0.72, 0.6, 0.5];
  const open = 0.42;
  loft(
    b,
    skirtY.map((y, i) => ring(y, 0.135 + i * 0.03, 0.098 + i * 0.026, -0.005 * i)),
    seg + 4,
    (i, a) => {
      const down = i / (skirtY.length - 1);
      if (i === 0)
        return [
          [B.hips, 0.7],
          [B.spine, 0.3],
        ];
      const lateral = Math.cos(a);
      const thigh = lateral > 0 ? B['thigh.L'] : B['thigh.R'];
      const k = Math.min(1, Math.abs(lateral) * 1.3) * Math.min(1, down * 1.2) * 0.7;
      return [
        [B.hips, 1 - k],
        [thigh, k],
      ];
    },
    (i, a, s) => {
      fabric(s, coat);
      const edge =
        Math.abs(a - Math.PI / 2 - open) < 0.08 ||
        Math.abs(a - (Math.PI / 2 + Math.PI * 2 - open)) < 0.08;
      if (i === skirtY.length - 1 || edge) fabric(s, trim, 0.6);
    },
    { arc: [Math.PI / 2 + open, Math.PI / 2 + Math.PI * 2 - open] },
  );

  // A brass belt with a glowing buckle.
  loft(
    b,
    [ring(1.075, 0.132, 0.096), ring(1.105, 0.13, 0.094), ring(1.135, 0.131, 0.095)],
    seg,
    () => [
      [B.hips, 0.6],
      [B.spine, 0.4],
    ],
    (_i, a, s) => {
      metallic(s, metal, 0.36);
      if (Math.sin(a) > 0.97) {
        s.glow = 0.9;
        s.channel = GLOW.body;
      }
    },
  );

  // The sash: from the lead... the left shoulder across the chest to the right hip, both seats.
  const sashSecs: Section[] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const y = 1.46 - 0.38 * t;
    const x = 0.14 - 0.26 * t;
    const zFront = 0.115 + 0.02 * Math.sin(Math.PI * t);
    const c = new THREE.Vector3(x, y, zFront);
    const dir = new THREE.Vector3(-0.26, -0.38, 0).normalize();
    const ax = new THREE.Vector3().crossVectors(dir, Z).normalize();
    sashSecs.push({ c, ax, az: Z, rx: 0.04, rz: 0.004 });
  }
  loft(
    b,
    sashSecs,
    8,
    (i) => (i < 3 ? blend(B.chest, B.spine, i / 3) : blend(B.spine, B.hips, (i - 3) / 3)),
    (_i, a, s) => {
      fabric(s, sash, 0.7);
      if (Math.abs(Math.cos(a)) > 0.9) {
        s.glow = 0.35;
        s.channel = GLOW.body;
      }
    },
  );

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(b.mat, 4));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
  g.setIndex(b.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A seat's look: amber and copper for EMBER (slot 0), cyan and silver for TIDE (slot 1). */
export const WIELDER_LOOKS: readonly [WielderLook, WielderLook] = [
  {
    coat: '#2b1a15',
    trim: '#7a4a2a',
    sash: '#8c3a14',
    metal: '#b8733f',
    glow: '#ff8a3a',
    mask: '#15110f',
    leather: '#1d1512',
  },
  {
    coat: '#141c26',
    trim: '#4f6274',
    sash: '#145a78',
    metal: '#c3cad2',
    glow: '#5fd4ff',
    mask: '#0f1216',
    leather: '#14171c',
  },
];
