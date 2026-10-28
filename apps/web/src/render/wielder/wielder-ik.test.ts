import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { aimBone, newSolution, reachAt, solveTwoBone, type TwoBoneLimb } from './wielder-ik';

const ARM: TwoBoneLimb = { upper: 0.3, lower: 0.27, minBend: 0.12, maxBend: 2.6 };
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const shoulder = v(0.2, 1.4, 0);
const pole = v(0.4, 1.0, -0.5); // behind and below: elbows point back and down

describe('two-bone IK (7D, D10): the wielders’ arms and legs', () => {
  it('puts the hand on a target within reach, the bones keeping their lengths', () => {
    const out = solveTwoBone(ARM, shoulder, v(0.35, 1.2, 0.35), pole, newSolution());
    expect(out.reached).toBe(true);
    expect(out.end.distanceTo(v(0.35, 1.2, 0.35))).toBeLessThan(1e-9);
    expect(out.mid.distanceTo(shoulder)).toBeCloseTo(ARM.upper, 9);
    expect(out.end.distanceTo(out.mid)).toBeCloseTo(ARM.lower, 9);
    expect(out.bend).toBeGreaterThanOrEqual(ARM.minBend);
  });

  it('never locks or hyperextends: out of reach, the arm points at the target, still bent', () => {
    const target = v(2, 1.4, 1.5);
    const out = solveTwoBone(ARM, shoulder, target, pole, newSolution());
    expect(out.reached).toBe(false);
    expect(out.bend).toBeCloseTo(ARM.minBend, 9);
    expect(out.end.distanceTo(shoulder)).toBeCloseTo(reachAt(ARM, ARM.minBend), 9);
    const toTarget = target.clone().sub(shoulder).normalize();
    const toEnd = out.end.clone().sub(shoulder).normalize();
    expect(toEnd.dot(toTarget)).toBeCloseTo(1, 9);
    expect(out.mid.distanceTo(shoulder)).toBeCloseTo(ARM.upper, 9);
  });

  it('never folds through itself: a target at the shoulder leaves the elbow at its limit', () => {
    const out = solveTwoBone(ARM, shoulder, shoulder.clone(), pole, newSolution());
    expect(out.reached).toBe(false);
    expect(out.bend).toBeCloseTo(ARM.maxBend, 9);
    for (const c of [...out.mid.toArray(), ...out.end.toArray()])
      expect(Number.isFinite(c)).toBe(true);
  });

  it('bends toward the pole, and the other way when the pole moves across', () => {
    const target = v(0.35, 1.0, 0.25);
    const bendSide = (p: THREE.Vector3) => {
      const out = solveTwoBone(ARM, shoulder, target, p, newSolution());
      const line = target.clone().sub(shoulder).normalize();
      const off = out.mid.clone().sub(shoulder);
      off.addScaledVector(line, -off.dot(line));
      return off.normalize();
    };
    const back = bendSide(v(0.3, 1.2, -1));
    const front = bendSide(v(0.3, 1.2, 1));
    expect(back.z).toBeLessThan(0);
    expect(front.z).toBeGreaterThan(0);
  });

  it('copes with a pole on the line and keeps everything finite', () => {
    const target = v(0.2, 0.9, 0);
    const out = solveTwoBone(ARM, shoulder, target, v(0.2, 0.5, 0), newSolution());
    expect(out.end.distanceTo(target)).toBeLessThan(1e-9);
    expect(out.mid.distanceTo(shoulder)).toBeCloseTo(ARM.upper, 9);
    for (const c of out.mid.toArray()) expect(Number.isFinite(c)).toBe(true);
  });

  it('mirrors exactly: a mirrored shoulder, target and pole give a mirrored elbow', () => {
    const m = (p: THREE.Vector3) => v(-p.x, p.y, p.z);
    const target = v(0.45, 1.25, 0.3);
    const a = solveTwoBone(ARM, shoulder, target, pole, newSolution());
    const b = solveTwoBone(ARM, m(shoulder), m(target), m(pole), newSolution());
    expect(b.mid.distanceTo(m(a.mid))).toBeLessThan(1e-12);
    expect(b.end.distanceTo(m(a.end))).toBeLessThan(1e-12);
  });
});

describe('aimBone: bone rotations from the solved joints', () => {
  it('turns the bone axis onto the aim and its twist reference into the bend plane', () => {
    const axis = v(0, -1, 0);
    const twist = v(0, 0, 1);
    const toward = v(1, -1, 0.5).normalize();
    const twistToward = v(0, 0.3, 1);
    const q = aimBone(axis, twist, toward, twistToward, new THREE.Quaternion());
    expect(axis.clone().applyQuaternion(q).distanceTo(toward)).toBeLessThan(1e-9);
    const t = twist.clone().applyQuaternion(q);
    expect(t.dot(toward)).toBeCloseTo(0, 9);
    // The turned twist reference is the part of `twistToward` across the aim.
    const want = twistToward.clone().addScaledVector(toward, -twistToward.dot(toward)).normalize();
    expect(t.distanceTo(want)).toBeLessThan(1e-9);
  });

  it('leaves a bone already on its aim untouched, and survives a twist along the aim', () => {
    const q = aimBone(v(0, -1, 0), v(0, 0, 1), v(0, -1, 0), v(0, 0, 1), new THREE.Quaternion());
    expect(Math.abs(q.w)).toBeCloseTo(1, 9);
    const r = aimBone(v(0, -1, 0), v(0, 0, 1), v(1, 0, 0), v(1, 0, 0), new THREE.Quaternion());
    for (const c of r.toArray()) expect(Number.isFinite(c)).toBe(true);
    expect(
      v(0, -1, 0)
        .applyQuaternion(r)
        .distanceTo(v(1, 0, 0)),
    ).toBeLessThan(1e-9);
  });
});
