import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { GameEvent } from '@ff/protocol';
import {
  moveFor,
  threat,
  toLocal,
  WielderAnimator,
  type Placement,
  type WielderPose,
  type WielderState,
} from './wielder-anim';
import { ARM_REACH, RIG } from './wielder-rig';

// The two plinths, mirrored across x = 0, each wielder turned toward the field's centre.
const P0: Placement = { x: -11.5, y: 1.72, z: -14.4, yaw: 0.6, scale: 1.2 };
const P1: Placement = { x: 11.5, y: 1.72, z: -14.4, yaw: -0.6, scale: 1.2 };

const state = (over: Partial<WielderState> = {}): WielderState => ({
  phase: 'playing',
  m: [-4, 2],
  hold: null,
  holdY: null,
  gripping: false,
  connected: true,
  core: [1, 1.2, -2],
  coreV: [3, 0, 1],
  ownGoalX: -21.8,
  ...over,
});
const mirrorState = (s: WielderState): WielderState => ({
  ...s,
  m: [-s.m[0], s.m[1]],
  core: s.core && [-s.core[0], s.core[1], s.core[2]],
  coreV: s.coreV && [-s.coreV[0], s.coreV[1], s.coreV[2]],
  ownGoalX: -s.ownGoalX,
});

const cast = (slot: 0 | 1, ability: string, p: [number, number, number], mag = 0) =>
  ({ type: 'cast', tick: 0, slot, ability, phase: 'tap', p, mag }) as unknown as GameEvent;

/** Steps the animator at 60 fps from t0 to t1 (seconds). */
function run(a: WielderAnimator, s: WielderState, t0: number, t1: number): WielderPose {
  let pose = a.update(s, t0);
  for (let t = t0 + 1 / 60; t <= t1 + 1e-9; t += 1 / 60) pose = a.update(s, t);
  return pose;
}

const shoulder = (a: WielderAnimator) =>
  new THREE.Vector3(a.lead * RIG.shoulderHalf, RIG.shoulderY, 0);
const leadHand = (a: WielderAnimator, p: WielderPose) => p.hand[a.lead === 1 ? 0 : 1];

function expectMirrored(a: WielderPose, b: WielderPose) {
  for (let i = 0; i < 2; i++) {
    const j = 1 - i; // a's left hand is b's right
    for (const [u, v] of [
      [a.hand[i]!, b.hand[j]!],
      [a.pole[i]!, b.pole[j]!],
      [a.palm[i]!, b.palm[j]!],
    ] as const) {
      expect(v.x).toBeCloseTo(-u.x, 9);
      expect(v.y).toBeCloseTo(u.y, 9);
      expect(v.z).toBeCloseTo(u.z, 9);
    }
    expect(b.fist[j]).toBeCloseTo(a.fist[i]!, 9);
    expect(b.glow[j]).toBeCloseTo(a.glow[i]!, 9);
  }
  expect(b.yaw).toBeCloseTo(-a.yaw, 9);
  expect(b.roll).toBeCloseTo(-a.roll, 9);
  expect(b.pitch).toBeCloseTo(a.pitch, 9);
  expect(b.crouch).toBeCloseTo(a.crouch, 9);
  expect(b.hips.x).toBeCloseTo(-a.hips.x, 9);
  expect(b.hips.z).toBeCloseTo(a.hips.z, 9);
  expect(b.look.x).toBeCloseTo(-a.look.x, 9);
  expect(b.look.z).toBeCloseTo(a.look.z, 9);
}

describe('wielder animation (7D, D10): poses from authoritative events and state', () => {
  it('maps casts to moves; held abilities come from the snapshot instead', () => {
    expect(moveFor('pulse')).toBe('throw');
    expect(moveFor('guard')).toBe('guard');
    expect(moveFor('charge')).toBe('charge');
    expect(moveFor('lift')).toBeNull();
    expect(moveFor('draw')).toBeNull();
  });

  it('puts each hand on its own side, the lead hand toward the field’s centre', () => {
    const a = new WielderAnimator(0, P0);
    const b = new WielderAnimator(1, P1);
    expect(a.lead).toBe(-b.lead);
    expect(toLocal(P0, 0, P0.y, 0, new THREE.Vector3()).x * a.lead).toBeGreaterThan(0);
    const pose = run(a, state({ phase: 'countdown' }), 0, 2);
    expect(pose.hand[0].x).toBeGreaterThan(0); // left hand at +X
    expect(pose.hand[1].x).toBeLessThan(0);
  });

  it('mirrors exactly: mirrored play on the mirrored plinth gives the mirrored wielder', () => {
    const a = new WielderAnimator(0, P0);
    const b = new WielderAnimator(1, P1);
    const s0 = state({ hold: 'lift', holdY: 2.2 });
    const s1 = mirrorState(s0);
    run(a, s0, 0, 0.5);
    run(b, s1, 0, 0.5);
    a.onEvent(cast(0, 'pulse', [3, 0.5, 4]), 0.5);
    b.onEvent(cast(1, 'pulse', [-3, 0.5, 4]), 0.5);
    for (const t1 of [0.6, 0.75, 1.0]) {
      const pa = run(a, s0, t1 - 0.1 + 1 / 60, t1);
      const pb = run(b, s1, t1 - 0.1 + 1 / 60, t1);
      expectMirrored(pa, pb);
    }
    a.onEvent(cast(0, 'sweep', [0, 0, 0]), 1.0);
    b.onEvent(cast(1, 'sweep', [0, 0, 0]), 1.0);
    expectMirrored(run(a, s0, 1 + 1 / 60, 1.3), run(b, s1, 1 + 1 / 60, 1.3));
  });

  it('throws at the cast point: the lead arm extends toward it, then returns', () => {
    const a = new WielderAnimator(0, P0);
    const s = state();
    run(a, s, 0, 1);
    const target: [number, number, number] = [2, 0.5, 6];
    a.onEvent(cast(0, 'pulse', target), 1);
    const pose = run(a, s, 1 + 1 / 60, 1.28);
    const sh = shoulder(a);
    const want = toLocal(P0, ...target, new THREE.Vector3())
      .sub(sh)
      .normalize();
    const arm = leadHand(a, pose).clone().sub(sh);
    expect(arm.clone().normalize().dot(want)).toBeGreaterThan(0.97);
    expect(arm.length()).toBeGreaterThan(ARM_REACH * 0.85);
    const after = run(a, s, 1.28 + 1 / 60, 2.2);
    expect(leadHand(a, after).clone().sub(sh).length()).toBeLessThan(ARM_REACH * 0.85);
  });

  it('lift then guard: the guard plays over the lift, and the lift comes back while held', () => {
    const a = new WielderAnimator(0, P0);
    const lift = state({ hold: 'lift', holdY: 1.8 });
    const up = run(a, lift, 0, 0.6);
    expect(Math.min(up.hand[0].y, up.hand[1].y)).toBeGreaterThan(1.6);
    a.onEvent(cast(0, 'guard', [-5, 0, 0]), 0.6);
    const down = run(a, lift, 0.6 + 1 / 60, 1.05);
    expect(Math.max(down.hand[0].y, down.hand[1].y)).toBeLessThan(1.15);
    const back = run(a, lift, 1.05 + 1 / 60, 1.8);
    expect(Math.min(back.hand[0].y, back.hand[1].y)).toBeGreaterThan(1.6);
  });

  it('a lost hand cancels the hold: the arms come down without a jump', () => {
    const a = new WielderAnimator(0, P0);
    run(a, state({ hold: 'lift', holdY: 2 }), 0, 0.6);
    let prev = a.pose.hand[0].clone();
    let biggest = 0;
    for (let t = 0.6 + 1 / 60; t <= 1.2; t += 1 / 60) {
      const p = a.update(state(), t);
      biggest = Math.max(biggest, p.hand[0].distanceTo(prev));
      prev = p.hand[0].clone();
    }
    expect(a.pose.hand[0].y).toBeLessThan(1.4);
    expect(biggest).toBeLessThan(0.08); // no frame moves a hand 8 cm: no snap
  });

  it('a goal scored interrupts a move with a celebration; a goal conceded staggers, then downcast until the kickoff', () => {
    const a = new WielderAnimator(0, P0);
    const s = state();
    run(a, s, 0, 1);
    a.onEvent(cast(0, 'pulse', [5, 0.5, 0]), 1);
    a.onEvent({ type: 'goal', id: 1, tick: 0, scorer: 0, p: [21.8, 1, 0], speed: 9 }, 1.1);
    const joy = run(a, state({ phase: 'goal' }), 1.1 + 1 / 60, 1.6);
    expect(Math.min(joy.hand[0].y, joy.hand[1].y)).toBeGreaterThan(1.9);

    const b = new WielderAnimator(0, P0);
    run(b, s, 0, 1);
    b.onEvent({ type: 'goal', id: 1, tick: 0, scorer: 1, p: [-21.8, 1, 0], speed: 9 }, 1);
    const hit = run(b, state({ phase: 'goal' }), 1 + 1 / 60, 1.2);
    expect(hit.pitch).toBeLessThan(-0.05); // knocked back
    // The plinth stands above the field, so watching the core is looking down too: downcast
    // means looking at the floor before the wielder instead of at the core.
    const coreL = toLocal(P0, 1, 1.2, -2, new THREE.Vector3());
    const low = run(b, state({ phase: 'goal' }), 1.2 + 1 / 60, 2.6).look.clone();
    expect(low.y).toBeLessThan(RIG.headY - 0.8);
    expect(low.distanceTo(coreL)).toBeGreaterThan(1);
    b.onEvent({ type: 'kickoff', id: 2, tick: 0, p: [0, 1, 0], v: [0, 0, 0] }, 2.6);
    const ready = run(b, s, 2.6 + 1 / 60, 3.6);
    // Watching the core again (within 2° as seen from the head).
    const head = new THREE.Vector3(0, RIG.headY, 0);
    const gaze = ready.look.clone().sub(head).normalize();
    expect(gaze.angleTo(coreL.clone().sub(head))).toBeLessThan(0.035);
  });

  it('a won match keeps celebrating', () => {
    const a = new WielderAnimator(1, P1);
    run(a, state(), 0, 1);
    a.onEvent({ type: 'matchEnd', id: 3, tick: 0, winner: 1 }, 1);
    const s = state({ phase: 'matchEnd' });
    expect(Math.min(...run(a, s, 1 + 1 / 60, 1.5).hand.map((h) => h.y))).toBeGreaterThan(1.9);
    // the first ends at 2.8 s; after a breath (0.6 s) another begins
    expect(Math.min(...run(a, s, 1.5 + 1 / 60, 3.2).hand.map((h) => h.y))).toBeLessThan(1.9);
    expect(Math.min(...run(a, s, 3.2 + 1 / 60, 3.9).hand.map((h) => h.y))).toBeGreaterThan(1.9);
  });

  it('goes dormant while the player is disconnected, and wakes when they return', () => {
    const a = new WielderAnimator(0, P0);
    run(a, state(), 0, 1);
    const off = run(a, state({ connected: false, hold: 'lift' }), 1 + 1 / 60, 3);
    expect(off.aura).toBeLessThan(0.3);
    expect(Math.max(off.hand[0].y, off.hand[1].y)).toBeLessThan(1.1);
    const on = run(a, state(), 3 + 1 / 60, 5);
    expect(on.aura).toBeGreaterThan(0.9);
  });

  it('braces when the core bears down on its own goal, not when it heads away', () => {
    const s = state({ core: [-15, 1, 0], coreV: [-7, 0, 0] });
    expect(threat(s)).toBeGreaterThan(0.5);
    expect(threat({ ...s, coreV: [7, 0, 0] })).toBe(0);
    expect(threat({ ...s, phase: 'goal' })).toBe(0);
    const a = new WielderAnimator(0, P0);
    expect(run(a, s, 0, 1.5).crouch).toBeGreaterThan(
      run(new WielderAnimator(0, P0), state(), 0, 1.5).crouch,
    );
  });

  it('stays finite on garbage input', () => {
    const a = new WielderAnimator(0, P0);
    const bad = state({ m: [NaN, Infinity], core: [NaN, NaN, NaN], coreV: [NaN, 0, NaN] });
    const pose = run(a, bad, 0, 1);
    a.onEvent(cast(0, 'pulse', [NaN, 0, NaN]), 1);
    run(a, bad, 1 + 1 / 60, 1.4);
    for (const v of [...pose.hand, ...pose.palm, ...pose.pole, pose.hips, pose.look])
      for (const c of v.toArray()) expect(Number.isFinite(c)).toBe(true);
    for (const n of [pose.yaw, pose.pitch, pose.roll, pose.crouch, pose.aura, ...pose.glow])
      expect(Number.isFinite(n)).toBe(true);
  });
});
