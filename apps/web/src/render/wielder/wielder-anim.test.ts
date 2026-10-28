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

/** The hand on the side of a local point (+1 the left, −1 the right) and its shoulder. */
const sideOf = (local: THREE.Vector3): 1 | -1 => (local.x >= 0 ? 1 : -1);
const shoulderOf = (h: 1 | -1) => new THREE.Vector3(h * RIG.shoulderHalf, RIG.shoulderY, 0);
const handOf = (h: 1 | -1, p: WielderPose) => p.hand[h === 1 ? 0 : 1];

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
  // The coat's tails: the same swing back, mirrored aside and apart.
  expect(b.coat.x).toBeCloseTo(a.coat.x, 9);
  expect(b.coat.y).toBeCloseTo(-a.coat.y, 9);
  expect(b.coat.z).toBeCloseTo(-a.coat.z, 9);
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

  // A target well to one side is thrown at with that side's arm; one straight ahead (within a
  // few degrees) with the lead hand, the one nearer the field's centre (the left, for slot 0).
  for (const [target, h] of [
    [[10, 0.5, 4], 1],
    [[-18, 0.5, -4], -1],
    [[2, 0.5, 6], 1],
  ] as [[number, number, number], 1 | -1][]) {
    it(`throws at the cast point (${target.join(', ')}) with the ${h === 1 ? 'left' : 'right'} arm, then returns`, () => {
      const a = new WielderAnimator(0, P0);
      const s = state();
      run(a, s, 0, 1);
      a.onEvent(cast(0, 'pulse', target), 1);
      const pose = run(a, s, 1 + 1 / 60, 1.32);
      const local = toLocal(P0, ...target, new THREE.Vector3());
      const sh = shoulderOf(h);
      const want = local.clone().sub(sh).normalize();
      const arm = handOf(h, pose).clone().sub(sh);
      expect(arm.clone().normalize().dot(want)).toBeGreaterThan(0.97);
      expect(arm.length()).toBeGreaterThan(ARM_REACH * 0.85);
      const after = run(a, s, 1.32 + 1 / 60, 2.2);
      expect(handOf(h, after).clone().sub(sh).length()).toBeLessThan(ARM_REACH * 0.85);
    });
  }

  it('casts at the near field out over it, no steeper than 20° below level', () => {
    const a = new WielderAnimator(0, P0);
    const s = state();
    run(a, s, 0, 1);
    const target: [number, number, number] = [-10.5, 0.15, -11.2]; // just off the plinth's foot
    a.onEvent(cast(0, 'pulse', target), 1);
    const pose = run(a, s, 1 + 1 / 60, 1.32);
    const local = toLocal(P0, ...target, new THREE.Vector3());
    const h = sideOf(local);
    const sh = shoulderOf(h);
    const steep = local.clone().sub(sh).normalize();
    expect(steep.y).toBeLessThan(-0.5); // the target itself is well below 20°
    const arm = handOf(h, pose).clone().sub(sh).normalize();
    expect(arm.y).toBeGreaterThan(-0.36);
    expect(arm.y).toBeLessThan(-0.25);
    // …on the target's bearing.
    const flat = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z).normalize();
    expect(flat(arm).dot(flat(steep))).toBeGreaterThan(0.99);
  });

  it('the coat trails the body: back as it lunges into a throw, then settles to the wind', () => {
    const a = new WielderAnimator(0, P0);
    const s = state();
    let calmMax = -Infinity;
    let calmMin = Infinity;
    run(a, s, 0, 1);
    for (let t = 1 + 1 / 60; t <= 4; t += 1 / 60) {
      const x = a.update(s, t).coat.x;
      calmMax = Math.max(calmMax, x);
      calmMin = Math.min(calmMin, x);
    }
    expect(calmMin).toBeGreaterThan(-0.02); // hanging, swaying a little in the wind
    expect(calmMax).toBeLessThan(0.12);
    a.onEvent(cast(0, 'pulse', [6, 0.5, 2]), 4);
    let lunge = -Infinity;
    let aside = 0;
    for (let t = 4 + 1 / 60; t <= 4.6; t += 1 / 60) {
      const c = a.update(s, t).coat;
      lunge = Math.max(lunge, c.x);
      aside = Math.max(aside, Math.abs(c.y));
      for (const v of c.toArray()) expect(Number.isFinite(v)).toBe(true);
      expect(c.x).toBeLessThanOrEqual(0.7);
    }
    expect(lunge).toBeGreaterThan(calmMax + 0.08); // swung back by the lunge
    expect(aside).toBeGreaterThan(0.03); // and aside by the turn
    const settled = run(a, s, 4.6 + 1 / 60, 7).coat;
    expect(settled.x).toBeLessThan(calmMax + 0.02);
    expect(settled.x).toBeGreaterThan(calmMin - 0.02);
  });

  it('aims with the hand on the manipulator’s side and never crosses its arms', () => {
    for (const m of [
      [-20, 6],
      [8, -2],
      [20, 9],
    ] as [number, number][]) {
      const a = new WielderAnimator(0, P0);
      const pose = run(a, state({ m }), 0, 2);
      const local = toLocal(P0, m[0], 0.6, m[1], new THREE.Vector3());
      const h = sideOf(local);
      const sh = shoulderOf(h);
      // The aiming arm points at the manipulator…
      const arm = handOf(h, pose).clone().sub(sh).normalize();
      expect(arm.dot(local.clone().sub(sh).normalize())).toBeGreaterThan(0.95);
      // …and each hand stays on its own side of the body.
      expect(pose.hand[0].x).toBeGreaterThan(0);
      expect(pose.hand[1].x).toBeLessThan(0);
    }
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

  it('flashes at the cast itself, however long the move winds up, and not after it', () => {
    const a = new WielderAnimator(1, P1);
    run(a, state({ m: [4, 2] }), 0, 1);
    expect(a.castFlash).toBe(0);
    a.onEvent(cast(1, 'freeze', [6, 0, 0]), 1);
    const raised = run(a, state({ m: [4, 2] }), 1 + 1 / 60, 1 + 4 / 60);
    // The freeze is still raising its palms (its gauntlets dim) but the flash is whole.
    expect(Math.max(raised.glow[0], raised.glow[1])).toBeLessThan(0.5);
    expect(a.castFlash).toBe(1);
    run(a, state({ m: [4, 2] }), 1 + 5 / 60, 1.7);
    expect(a.castFlash).toBeLessThan(0.05);
    run(a, state({ m: [4, 2] }), 1.7 + 1 / 60, 2);
    expect(a.castFlash).toBe(0);
  });

  it('flinches at a hard hit near its own goal; not at a soft or a far one, nor over a goal', () => {
    const impact = (x: number, impulse: number) =>
      ({ type: 'impact', tick: 0, a: 1, b: 2, p: [x, 1, 0], impulse }) as unknown as GameEvent;
    const calm = run(new WielderAnimator(0, P0), state(), 0, 1.2);
    // Seat 0 defends x = −21.8: a hard hit at x = −17 (as hard as a play's hardest near a goal),
    // one ~150 ms on.
    const a = new WielderAnimator(0, P0);
    run(a, state(), 0, 1);
    a.onEvent(impact(-17, 274), 1);
    const hit = run(a, state(), 1 + 1 / 60, 1.15);
    expect(a.played.flinch).toBe(1);
    expect(hit.pitch).toBeLessThan(calm.pitch - 0.05); // the torso snaps back
    for (const i of [0, 1]) expect(hit.hand[i]!.y).toBeGreaterThan(calm.hand[i]!.y); // hands up
    // It passes: a second on, it stands as a wielder that was never hit.
    const after = run(a, state(), 1.15 + 1 / 60, 2.2);
    const never = run(new WielderAnimator(0, P0), state(), 0, 2.2);
    expect(Math.abs(after.pitch - never.pitch)).toBeLessThan(1e-6);
    for (const i of [0, 1]) expect(after.hand[i]!.distanceTo(never.hand[i]!)).toBeLessThan(0.01);
    // A soft hit, or a hard one at the far end, or one before it knows its goal: no flinch.
    const b = new WielderAnimator(0, P0);
    b.onEvent(impact(-17, 600), 0); // no state yet
    run(b, state(), 0, 1);
    b.onEvent(impact(-17, 120), 1);
    b.onEvent(impact(17, 900), 1);
    expect(b.played.flinch).toBeUndefined();
    // A goal conceded staggers; the hit that scored it does not add a flinch over the stagger.
    const c = new WielderAnimator(0, P0);
    run(c, state(), 0, 1);
    c.onEvent({ type: 'goal', tick: 0, scorer: 1 } as unknown as GameEvent, 1);
    c.onEvent(impact(-21, 700), 1);
    const staggered = run(c, state(), 1 + 1 / 60, 1.2);
    const d = new WielderAnimator(0, P0);
    run(d, state(), 0, 1);
    d.onEvent({ type: 'goal', tick: 0, scorer: 1 } as unknown as GameEvent, 1);
    expect(staggered.pitch).toBeCloseTo(run(d, state(), 1 + 1 / 60, 1.2).pitch, 9);
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
