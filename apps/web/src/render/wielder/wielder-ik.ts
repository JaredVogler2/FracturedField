import * as THREE from 'three';

/**
 * Two-bone inverse kinematics for the wielders' arms and legs (7D / D10): analytic (the law of
 * cosines), with a pole that picks the plane the middle joint bends in, and limits so an elbow or
 * a knee never locks straight, never hyperextends and never folds through itself. Pure maths:
 * positions in, joint positions out; `aimBone` turns them into bone rotations.
 */

export interface TwoBoneLimb {
  /** Length of the bone from the root joint to the middle joint (upper arm, thigh). */
  readonly upper: number;
  /** Length of the bone from the middle joint to the end (forearm, shin). */
  readonly lower: number;
  /** The least the middle joint stays bent, radians from straight: never locked or reversed. */
  readonly minBend: number;
  /** The most it folds, radians from straight (a forearm cannot pass through the upper arm). */
  readonly maxBend: number;
}

export interface TwoBoneSolution {
  /** The middle joint (elbow, knee). */
  readonly mid: THREE.Vector3;
  /** Where the end (wrist, ankle) lands: the target, or as near as the limb allows. */
  readonly end: THREE.Vector3;
  /** The middle joint's bend, radians from straight (0 = straight, never below `minBend`). */
  bend: number;
  /** False when the target was out of the limb's range (it points at it, as far as allowed). */
  reached: boolean;
}

export function newSolution(): TwoBoneSolution {
  return { mid: new THREE.Vector3(), end: new THREE.Vector3(), bend: 0, reached: true };
}

const dir = new THREE.Vector3();
const side = new THREE.Vector3();
const fallback = new THREE.Vector3();

/** Distance from root to end when the middle joint is bent by `bend` (radians from straight). */
export function reachAt(limb: TwoBoneLimb, bend: number): number {
  const { upper: a, lower: b } = limb;
  // The interior angle at the joint is π − bend: d² = a² + b² + 2ab·cos(bend).
  return Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(bend)));
}

/**
 * Solves the limb from `root` toward `target`, bending toward `pole` (a point on the side the
 * joint should point to: in front of and below an elbow, in front of a knee). Writes into `out`.
 */
export function solveTwoBone(
  limb: TwoBoneLimb,
  root: THREE.Vector3,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  out: TwoBoneSolution,
): TwoBoneSolution {
  const { upper: a, lower: b } = limb;
  dir.subVectors(target, root);
  let d = dir.length();
  // The bend plane: the pole's offset from the root → target line.
  side.subVectors(pole, root);
  if (d < 1e-6) dir.copy(side).normalize();
  else dir.divideScalar(d);
  if (dir.lengthSq() < 0.5) dir.set(0, -1, 0);
  side.addScaledVector(dir, -side.dot(dir));
  if (side.lengthSq() < 1e-10) {
    // The pole lies on the line: any perpendicular will do, preferably forward-ish.
    fallback.set(0, 0, 1);
    if (Math.abs(dir.z) > 0.9) fallback.set(1, 0, 0);
    side.copy(fallback).addScaledVector(dir, -fallback.dot(dir));
  }
  side.normalize();
  const far = reachAt(limb, limb.minBend);
  const near = reachAt(limb, limb.maxBend);
  out.reached = d >= near - 1e-9 && d <= far + 1e-9;
  d = Math.min(far, Math.max(near, d));
  // The angle at the root between the line to the end and the upper bone.
  const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  out.end.copy(root).addScaledVector(dir, d);
  out.mid
    .copy(root)
    .addScaledVector(dir, a * cosA)
    .addScaledVector(side, a * sinA);
  const cosM = THREE.MathUtils.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  out.bend = Math.PI - Math.acos(cosM);
  return out;
}

const mLocal = new THREE.Matrix4();
const mWorld = new THREE.Matrix4();
const ax = new THREE.Vector3();
const tw = new THREE.Vector3();
const third = new THREE.Vector3();

/**
 * The rotation that turns a bone's own axis `axis` (unit, in its rest frame) to point along
 * `toward` (world), with its `twist` reference (unit, perpendicular to `axis`) turned as close to
 * `twistToward` as that allows: no roll flips when the aim crosses over. Writes into `out`.
 */
export function aimBone(
  axis: THREE.Vector3,
  twist: THREE.Vector3,
  toward: THREE.Vector3,
  twistToward: THREE.Vector3,
  out: THREE.Quaternion,
): THREE.Quaternion {
  third.crossVectors(axis, twist);
  mLocal.makeBasis(axis, twist, third);
  ax.copy(toward).normalize();
  tw.copy(twistToward).addScaledVector(ax, -twistToward.dot(ax));
  if (tw.lengthSq() < 1e-10) {
    // The twist reference lies along the aim: keep the rest twist as well as possible.
    tw.copy(twist).addScaledVector(ax, -twist.dot(ax));
    if (tw.lengthSq() < 1e-10) tw.copy(third).addScaledVector(ax, -third.dot(ax));
  }
  tw.normalize();
  third.crossVectors(ax, tw);
  mWorld.makeBasis(ax, tw, third);
  // R · local basis = world basis, and a rotation's inverse is its transpose.
  mLocal.transpose();
  return out.setFromRotationMatrix(mWorld.multiply(mLocal));
}
