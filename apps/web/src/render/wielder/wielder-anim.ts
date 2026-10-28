import * as THREE from 'three';
import type { AbilityId, GameEvent, MatchPhase, PlayerSlot } from '@ff/protocol';
import { ARM_REACH, RIG } from './wielder-rig';

/**
 * A wielder's animation (7D / D10), derived only from authoritative state: the cast, grip, goal,
 * kickoff and match-end events, and the snapshot's manipulator, held ability, grip and
 * connection. Both devices see the same events, so both draw the same moves; the casting itself
 * never waits for an animation. Pure: it produces targets (hands, elbows, palms, torso, head) in
 * the wielder's own frame (RIG's), which the rig turns into bone rotations with IK.
 *
 * Every pose is written against the lead hand's side `lead` (+1: the wielder's left, +X): the
 * hand nearer the field's centre. The two plinths mirror each other, so mirrored play gives
 * exactly mirrored wielders (stage symmetry, D10).
 */

/** Where a wielder stands: its plinth top, the way it faces (yaw about +Y), its scale. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
}

/** World point → the wielder's frame (unscaled RIG units). */
export function toLocal(
  pl: Placement,
  x: number,
  y: number,
  z: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const dx = x - pl.x;
  const dz = z - pl.z;
  const c = Math.cos(pl.yaw);
  const s = Math.sin(pl.yaw);
  return out.set((dx * c - dz * s) / pl.scale, (y - pl.y) / pl.scale, (dx * s + dz * c) / pl.scale);
}

/** What the snapshot says about this wielder's player and the core, each frame. */
export interface WielderState {
  readonly phase: MatchPhase;
  /** The manipulator on the arena plane (world x, z). */
  readonly m: readonly [number, number];
  readonly hold: AbilityId | null;
  /** Height of the body a held ability is lifting (world y), if any. */
  readonly holdY: number | null;
  readonly gripping: boolean;
  readonly connected: boolean;
  /** The core (world), if there is one. */
  readonly core: readonly [number, number, number] | null;
  readonly coreV: readonly [number, number, number] | null;
  /** World x of the goal this wielder defends. */
  readonly ownGoalX: number;
}

/** The targets the rig follows, in the wielder's frame. Hands: [left, right]. */
export interface WielderPose {
  readonly hand: [THREE.Vector3, THREE.Vector3];
  /** Points the elbows bend toward. */
  readonly pole: [THREE.Vector3, THREE.Vector3];
  /** Palm normals (unit). */
  readonly palm: [THREE.Vector3, THREE.Vector3];
  /** Finger curl, 0 open to 1 a fist. */
  readonly fist: [number, number];
  /** Gauntlet glow, 0..1. */
  readonly glow: [number, number];
  /** Hips offset from rest, and the torso's turn (yaw), lean forward (pitch) and tilt (roll). */
  readonly hips: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  /** Knee bend, 0 standing to 1 a deep crouch. */
  crouch: number;
  /** What the head looks at. */
  readonly look: THREE.Vector3;
  /** The energy around the wielder, 0..1 (dim when disconnected). */
  aura: number;
}

export function newPose(): WielderPose {
  return {
    hand: [new THREE.Vector3(), new THREE.Vector3()],
    pole: [new THREE.Vector3(), new THREE.Vector3()],
    palm: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1)],
    fist: [0, 0],
    glow: [0, 0],
    hips: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    crouch: 0,
    look: new THREE.Vector3(0, RIG.headY, 6),
    aura: 1,
  };
}

/** `into` ← `into` + (`from` − `into`)·w, every field (palms renormalised). */
export function blendPose(into: WielderPose, from: WielderPose, w: number): WielderPose {
  if (w <= 0) return into;
  const k = Math.min(1, w);
  for (let i = 0; i < 2; i++) {
    into.hand[i]!.lerp(from.hand[i]!, k);
    into.pole[i]!.lerp(from.pole[i]!, k);
    into.palm[i]!.lerp(from.palm[i]!, k);
    if (into.palm[i]!.lengthSq() < 1e-8) into.palm[i]!.copy(from.palm[i]!);
    into.palm[i]!.normalize();
    into.fist[i] = into.fist[i]! + (from.fist[i]! - into.fist[i]!) * k;
    into.glow[i] = into.glow[i]! + (from.glow[i]! - into.glow[i]!) * k;
  }
  into.hips.lerp(from.hips, k);
  into.yaw += (from.yaw - into.yaw) * k;
  into.pitch += (from.pitch - into.pitch) * k;
  into.roll += (from.roll - into.roll) * k;
  into.crouch += (from.crouch - into.crouch) * k;
  into.look.lerp(from.look, k);
  into.aura += (from.aura - into.aura) * k;
  return into;
}

function copyPose(into: WielderPose, from: WielderPose): WielderPose {
  for (let i = 0; i < 2; i++) {
    into.hand[i]!.copy(from.hand[i]!);
    into.pole[i]!.copy(from.pole[i]!);
    into.palm[i]!.copy(from.palm[i]!);
    into.fist[i] = from.fist[i]!;
    into.glow[i] = from.glow[i]!;
  }
  into.hips.copy(from.hips);
  into.yaw = from.yaw;
  into.pitch = from.pitch;
  into.roll = from.roll;
  into.crouch = from.crouch;
  into.look.copy(from.look);
  into.aura = from.aura;
  return into;
}

/** The one-shot moves: each plays once from its event, over the arms (and torso). */
export type WielderMove =
  'throw' | 'sweep' | 'guard' | 'infuse' | 'freeze' | 'charge' | 'magnetize' | 'gravity' | 'focus';

const MOVE_SECONDS: Record<WielderMove, number> = {
  throw: 0.62,
  sweep: 0.7,
  guard: 0.85,
  infuse: 0.9,
  freeze: 0.9,
  charge: 0.9,
  magnetize: 0.9,
  gravity: 0.9,
  focus: 0.9,
};

/** Which move an accepted cast plays (holds are drawn from the snapshot instead). */
export function moveFor(ability: AbilityId): WielderMove | null {
  switch (ability) {
    case 'pulse':
      return 'throw';
    case 'sweep':
    case 'guard':
    case 'infuse':
    case 'freeze':
    case 'charge':
    case 'magnetize':
    case 'gravity':
    case 'focus':
      return ability;
    default:
      return null; // lift and draw are held: the snapshot's `hold` drives them
  }
}

const CELEBRATE_SECONDS = 1.8;
const STAGGER_SECONDS = 0.9;
/** Time constants (s) of the layers' weights: holds snap in, moods settle. */
const HOLD_TAU = 0.08;
const MOOD_TAU = 0.25;
/** Natural frequency (rad/s) of the critically damped springs the hands follow. */
const HAND_OMEGA = 26;

type Mood = 'ready' | 'dejected' | 'victorious';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const finite = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const dirT = new THREE.Vector3();
const offset = new THREE.Vector3();

/** One wielder's animation state. Feed it events and a state each frame; read `pose`. */
export class WielderAnimator {
  /** +1 when the lead hand is the wielder's left (+X), −1 when it is the right. */
  readonly lead: 1 | -1;
  /** The pose to draw this frame (hands spring-smoothed). */
  readonly pose = newPose();

  private move: { kind: WielderMove; start: number; target: THREE.Vector3; hot: boolean } | null =
    null;
  private outcome: { kind: 'celebrate' | 'stagger'; start: number } | null = null;
  private mood: Mood = 'ready';
  private wAim = 0;
  private wLift = 0;
  private wDraw = 0;
  private wGrip = 0;
  private wDormant = 0;
  private wDejected = 0;
  private danger = 0;
  private lastT = 0;
  private sprung = false;
  private readonly x: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly vel: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly base = newPose();
  private readonly layer = newPose();
  private readonly target = newPose();
  private readonly m = new THREE.Vector3();
  private readonly coreL = new THREE.Vector3();

  constructor(
    readonly slot: PlayerSlot,
    readonly place: Placement,
  ) {
    // The lead hand is on the side of the field's centre.
    this.lead = toLocal(place, 0, place.y, 0, tmp).x >= 0 ? 1 : -1;
  }

  /** An authoritative event, at render time `t` (seconds). */
  onEvent(e: GameEvent, t: number): void {
    switch (e.type) {
      case 'cast': {
        if (e.slot !== this.slot || (e.phase !== 'tap' && e.phase !== 'start')) return;
        const kind = moveFor(e.ability);
        if (!kind) return;
        this.move = {
          kind,
          start: t,
          target: this.local(e.p[0], e.p[1], e.p[2]),
          hot: e.mag === 1,
        };
        return;
      }
      case 'grip':
        // Letting go throws: the release plays as a throw along the body's flight.
        if (e.slot === this.slot && e.phase === 'end') {
          this.move = {
            kind: 'throw',
            start: t,
            target: this.local(e.p[0] + e.v[0] * 0.3, e.p[1], e.p[2] + e.v[2] * 0.3),
            hot: false,
          };
        }
        return;
      case 'goal':
        this.outcome = { kind: e.scorer === this.slot ? 'celebrate' : 'stagger', start: t };
        this.mood = e.scorer === this.slot ? 'ready' : 'dejected';
        this.move = null;
        return;
      case 'kickoff':
        this.mood = 'ready';
        return;
      case 'matchEnd':
        this.mood = e.winner === this.slot ? 'victorious' : e.winner === -1 ? 'ready' : 'dejected';
        if (e.winner === this.slot) this.outcome = { kind: 'celebrate', start: t };
        return;
      default:
        return;
    }
  }

  /** Advances to render time `t` (seconds) with the snapshot's `state`; returns `pose`. */
  update(state: WielderState, t: number): WielderPose {
    const dt = this.sprung ? Math.min(0.1, Math.max(0, t - this.lastT)) : 0;
    this.lastT = t;
    const L = this.lead;
    const pl = this.place;
    const ease = (tau: number) => (dt <= 0 ? 0 : 1 - Math.exp(-dt / tau));
    const toward = (w: number, goal: number, tau: number) => w + (goal - w) * ease(tau);

    const playing = state.phase === 'playing';
    const live = state.connected;
    this.wAim = toward(this.wAim, playing && live ? 1 : 0, MOOD_TAU);
    this.wLift = toward(this.wLift, live && state.hold === 'lift' ? 1 : 0, HOLD_TAU);
    this.wDraw = toward(this.wDraw, live && state.hold === 'draw' ? 1 : 0, HOLD_TAU);
    this.wGrip = toward(this.wGrip, live && state.gripping ? 1 : 0, HOLD_TAU);
    this.wDormant = toward(this.wDormant, live ? 0 : 1, MOOD_TAU * 2);
    const sad = this.mood === 'dejected' && !this.outcome;
    this.wDejected = toward(this.wDejected, sad ? 1 : 0, MOOD_TAU);

    toLocal(pl, finite(state.m[0]), 0.6, finite(state.m[1]), this.m);
    const core = state.core;
    if (core) toLocal(pl, finite(core[0]), finite(core[1], 1), finite(core[2]), this.coreL);
    this.danger = toward(this.danger, live ? threat(state) : 0, MOOD_TAU);

    // Base: hovering energy between the hands, breathing; the head follows the core.
    const b = this.base;
    const breathe = Math.sin(t * 2 * Math.PI * 0.23);
    const orbit = t * 2 * Math.PI * 0.4;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1; // left hand at +X
      const ph = orbit + this.role(i) * Math.PI;
      b.hand[i]!.set(
        side * 0.13 + L * Math.cos(ph) * 0.02,
        1.1 + breathe * 0.008 + Math.sin(ph) * 0.02,
        0.3,
      );
      b.pole[i]!.set(side * 0.7, 0.9, -0.5);
      b.palm[i]!.set(-side, 0, 0);
      b.fist[i] = 0.2;
      b.glow[i] = 0.35;
    }
    b.hips.set(0, 0, 0);
    b.yaw = 0;
    b.pitch = breathe * 0.015;
    b.roll = 0;
    b.crouch = 0.05;
    if (core) b.look.copy(this.coreL);
    else b.look.set(0, RIG.headY, 6);
    b.aura = 1;

    // Aim: the lead hand reaches toward the manipulator, the torso turns with it.
    const lp = this.layer;
    copyPose(lp, b);
    const shoulderLead = tmp2.set(L * RIG.shoulderHalf, RIG.shoulderY, 0);
    dirT.copy(this.m).sub(shoulderLead).normalize();
    this.leadHand(lp)
      .copy(shoulderLead)
      .addScaledVector(dirT, ARM_REACH * 0.8);
    this.leadPalm(lp).copy(dirT);
    this.offHand(lp).set(L * 0.02, 1.2, 0.26);
    this.offPalm(lp).set(L, 0, 0);
    lp.yaw = THREE.MathUtils.clamp(Math.atan2(this.m.x, this.m.z), -0.6, 0.6) * 0.5;
    this.glowLead(lp, 0.55);
    blendPose(b, lp, this.wAim);

    // Moods: dormant when the player's link is gone, downcast after conceding.
    copyPose(lp, b);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      lp.hand[i]!.set(side * 0.19, 0.92, 0.1);
      lp.palm[i]!.set(0, -0.3, 1).normalize();
      lp.fist[i] = 0.1;
      lp.glow[i] = 0.05;
    }
    lp.pitch = 0.16;
    lp.look.set(0, 0.3, 2.5);
    lp.aura = 0.15;
    blendPose(b, lp, this.wDormant);
    lp.aura = 0.7;
    lp.glow[0] = lp.glow[1] = 0.2;
    lp.pitch = 0.12;
    lp.crouch = 0.1;
    blendPose(b, lp, this.wDejected * (1 - this.wDormant));

    // Bracing while the core bears down on the wielder's own goal.
    if (this.danger > 0) {
      b.crouch += 0.25 * this.danger;
      b.pitch += 0.12 * this.danger;
      for (let i = 0; i < 2; i++) {
        b.hand[i]!.y += 0.06 * this.danger;
        b.hand[i]!.x += (i === 0 ? 1 : -1) * 0.05 * this.danger;
      }
    }

    const tp = this.target;
    copyPose(tp, b);

    // Held abilities, straight from the snapshot.
    if (this.wLift > 0.001) {
      copyPose(lp, tp);
      const rise =
        state.holdY === null
          ? 0
          : THREE.MathUtils.clamp((finite(state.holdY, 1) - 1) * 0.08, -0.06, 0.12);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1;
        lp.hand[i]!.set(
          side * 0.26,
          1.7 +
            rise +
            Math.sin(t * 2 * Math.PI * 0.5) * 0.03 +
            Math.sin(t * 41 + this.role(i)) * 0.006,
          0.32,
        );
        lp.palm[i]!.set(0, 1, 0);
        lp.pole[i]!.set(side * 0.8, 1.0, -0.3);
        lp.fist[i] = 0.15;
        lp.glow[i] = 0.8 + 0.15 * Math.sin(t * 9 + this.role(i));
      }
      lp.pitch = -0.08;
      blendPose(tp, lp, this.wLift);
    }
    if (this.wDraw > 0.001) {
      copyPose(lp, tp);
      const pull = 0.5 - 0.5 * Math.cos(t * 2 * Math.PI * 1.2);
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? 1 : -1;
        lp.hand[i]!.set(side * 0.12, 1.25, 0.5 - 0.22 * pull);
        lp.palm[i]!.set(0, 0, -1);
        lp.fist[i] = 0.6;
        lp.glow[i] = 0.7;
      }
      lp.pitch = 0.05 - 0.08 * pull;
      blendPose(tp, lp, this.wDraw);
    }
    if (this.wGrip > 0.001) {
      copyPose(lp, tp);
      this.leadHand(lp)
        .copy(shoulderLead)
        .addScaledVector(dirT, ARM_REACH * 0.95);
      this.leadPalm(lp).copy(dirT);
      this.fistLead(lp, 1);
      this.glowLead(lp, 0.95);
      lp.pitch = 0.1;
      blendPose(tp, lp, this.wGrip);
    }

    // The one-shot move from the last cast.
    const mv = this.move;
    if (mv) {
      const u = (t - mv.start) / MOVE_SECONDS[mv.kind];
      if (u >= 1 || u < 0) this.move = null;
      else {
        copyPose(lp, tp);
        this.playMove(lp, mv.kind, u, mv.target, mv.hot, t);
        // In at once (the event is the release), out over the last part.
        blendPose(tp, lp, 1 - smooth(0.55, 1, u));
      }
    }

    // A goal, scored or conceded, and a won match.
    const oc = this.outcome;
    if (oc) {
      const dur = oc.kind === 'celebrate' ? CELEBRATE_SECONDS : STAGGER_SECONDS;
      const u = (t - oc.start) / dur;
      if (u >= 1) {
        // A won match keeps celebrating, with a breath between.
        this.outcome = this.mood === 'victorious' ? { kind: 'celebrate', start: t + 0.6 } : null;
      } else if (u >= 0) {
        copyPose(lp, tp);
        if (oc.kind === 'celebrate') celebrate(lp, u, t, (i) => this.role(i));
        else stagger(lp, u);
        blendPose(tp, lp, smooth(0, 0.08, u) * (1 - smooth(0.75, 1, u)));
      }
    }

    // The hands follow their targets on critically damped springs: no snapping between layers,
    // and remote updates at the snapshot rate never twitch them.
    const out = copyPose(this.pose, tp);
    for (let i = 0; i < 2; i++) {
      const x = this.x[i]!;
      const v = this.vel[i]!;
      const goal = tp.hand[i]!;
      if (!this.sprung) {
        x.copy(goal);
        v.set(0, 0, 0);
        continue;
      }
      // Semi-implicit Euler on x'' = ω²(goal − x) − 2ωx'.
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        tmp.subVectors(goal, x).multiplyScalar(HAND_OMEGA * HAND_OMEGA);
        tmp.addScaledVector(v, -2 * HAND_OMEGA);
        v.addScaledVector(tmp, h);
        x.addScaledVector(v, h);
      }
      out.hand[i]!.copy(x);
    }
    this.sprung = true;
    return out;
  }

  /** A world point in this wielder's frame; straight ahead if the point is not a number. */
  private local(x: number, y: number, z: number): THREE.Vector3 {
    const out = new THREE.Vector3(0, RIG.shoulderY, 6);
    return Number.isFinite(x + y + z) ? toLocal(this.place, x, y, z, out) : out;
  }

  /** 0 for the lead hand's index, 1 for the other (phases follow roles, so mirrors match). */
  private role(i: number): number {
    return i === (this.lead === 1 ? 0 : 1) ? 0 : 1;
  }
  private leadHand(p: WielderPose): THREE.Vector3 {
    return p.hand[this.lead === 1 ? 0 : 1];
  }
  private offHand(p: WielderPose): THREE.Vector3 {
    return p.hand[this.lead === 1 ? 1 : 0];
  }
  private leadPalm(p: WielderPose): THREE.Vector3 {
    return p.palm[this.lead === 1 ? 0 : 1];
  }
  private offPalm(p: WielderPose): THREE.Vector3 {
    return p.palm[this.lead === 1 ? 1 : 0];
  }
  private glowLead(p: WielderPose, g: number): void {
    p.glow[this.lead === 1 ? 0 : 1] = g;
  }
  private fistLead(p: WielderPose, f: number): void {
    p.fist[this.lead === 1 ? 0 : 1] = f;
  }

  /** One move at progress `u` (0..1) toward `target` (the cast point, in the wielder's frame). */
  private playMove(
    p: WielderPose,
    kind: WielderMove,
    u: number,
    target: THREE.Vector3,
    hot: boolean,
    t: number,
  ): void {
    const L = this.lead;
    const shoulder = tmp2.set(L * RIG.shoulderHalf, RIG.shoulderY, 0);
    dirT.copy(target).sub(shoulder);
    if (dirT.lengthSq() < 1e-6) dirT.set(0, 0, 1);
    dirT.normalize();
    const turn = THREE.MathUtils.clamp(Math.atan2(target.x, target.z), -0.7, 0.7);
    switch (kind) {
      case 'throw': {
        // A short cock back, the thrust at the cast point, a held follow-through.
        const cock = smooth(0, 0.06, u) * (1 - smooth(0.06, 0.18, u));
        const thrust = smooth(0.06, 0.18, u);
        const hand = this.leadHand(p);
        hand.copy(shoulder).addScaledVector(dirT, ARM_REACH * (0.35 + 0.63 * thrust));
        hand.add(tmp.set(L * 0.08, -0.04, -0.14).multiplyScalar(cock));
        this.leadPalm(p).copy(dirT);
        this.fistLead(p, 0.05);
        this.glowLead(p, 0.4 + 0.6 * thrust * (1 - smooth(0.3, 0.9, u)));
        this.offHand(p).set(-L * 0.32, 1.12, -0.1);
        this.offPalm(p).set(-L, -0.3, -0.4).normalize();
        p.yaw = turn * 0.45 * thrust;
        p.pitch = 0.18 * thrust;
        p.hips.set(L * 0.03 * thrust, -0.02 * thrust, 0.05 * thrust);
        p.crouch = 0.15 + 0.15 * thrust;
        return;
      }
      case 'sweep': {
        // Both arms carry an arc across the front of the body, lead side to the other.
        const a = smooth(0.05, 0.65, u);
        const phi = L * (1.2 - 2.4 * a);
        for (let i = 0; i < 2; i++) {
          const k = L * (this.role(i) === 0 ? 0.1 : -0.1);
          p.hand[i]!.set(Math.sin(phi + k) * 0.55, 1.18, Math.cos(phi + k) * 0.45 + 0.05);
          p.palm[i]!.set(-L * Math.cos(phi), 0, L * Math.sin(phi)).normalize();
          p.fist[i] = 0.1;
          p.glow[i] = 0.8;
        }
        p.yaw = phi * 0.45;
        p.pitch = 0.08;
        p.crouch = 0.2;
        return;
      }
      case 'guard': {
        // Wrists cross before the chest, then drive down and apart: the wall rises.
        const cross = smooth(0, 0.28, u);
        const drive = smooth(0.28, 0.48, u);
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? 1 : -1;
          tmp.set(-side * 0.06, 1.32 - this.role(i) * 0.04, 0.24); // crossed, lead wrist on top
          p.hand[i]!.lerp(tmp, cross).lerp(tmp.set(side * 0.32, 0.92, 0.42), drive);
          p.palm[i]!.set(0, -drive, 1 - drive).normalize();
          p.fist[i] = 0.3 * (1 - drive);
          p.glow[i] = 0.4 + 0.5 * drive;
        }
        p.pitch = 0.2 * drive;
        p.crouch = 0.1 + 0.3 * drive;
        return;
      }
      case 'infuse': {
        // The lead palm out toward the cast, the other hand gripping that forearm.
        const k = smooth(0, 0.2, u);
        const hand = this.leadHand(p);
        hand.lerp(tmp.copy(shoulder).addScaledVector(dirT, ARM_REACH * 0.8), k);
        this.leadPalm(p).copy(dirT);
        tmp.copy(shoulder).addScaledVector(dirT, ARM_REACH * 0.45);
        this.offHand(p).lerp(tmp.add(offset.set(-L * 0.05, -0.04, 0)), k);
        this.offPalm(p).set(L, 0, 0);
        this.glowLead(p, (hot ? 0.95 : 0.85) * k);
        p.yaw = turn * 0.4 * k;
        p.pitch = 0.1 * k;
        return;
      }
      case 'freeze': {
        // Both palms press forward and down over the floor.
        const k = smooth(0, 0.22, u);
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? 1 : -1;
          p.hand[i]!.lerp(tmp.set(side * 0.22, 1.02, 0.5), k);
          p.palm[i]!.set(0, -0.6, 0.8).normalize();
          p.fist[i] = 0;
          p.glow[i] = 0.85 * k;
        }
        p.yaw = turn * 0.3 * k;
        p.pitch = 0.18 * k;
        p.crouch = 0.1 + 0.25 * k;
        return;
      }
      case 'charge': {
        // The lead hand raised high, then snapped down at the cast: a lightning call.
        const raise = smooth(0, 0.3, u) * (1 - smooth(0.3, 0.42, u));
        const snap = smooth(0.3, 0.42, u);
        const hand = this.leadHand(p);
        hand
          .set(L * 0.12, 2.04, 0.12)
          .lerp(tmp.copy(shoulder).addScaledVector(dirT, ARM_REACH), snap);
        hand.lerp(tmp.set(L * 0.12, 2.04, 0.12), raise * (1 - snap));
        this.leadPalm(p)
          .set(0, 1 - snap, snap)
          .normalize();
        this.offHand(p).set(-L * 0.24, 1.0, 0.1);
        this.glowLead(p, 0.6 + 0.4 * snap + 0.2 * Math.sin(t * 60) * raise);
        p.pitch = -0.1 * raise + 0.15 * snap;
        p.yaw = turn * 0.4 * snap;
        return;
      }
      case 'magnetize': {
        // Hands spread wide, then drawn toward each other: the field bends the metal.
        const spread = smooth(0, 0.25, u);
        const close = smooth(0.35, 0.65, u);
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? 1 : -1;
          p.hand[i]!.set(side * (0.55 - 0.28 * close), 1.38 - 0.06 * close, 0.2 + 0.15 * close);
          p.hand[i]!.lerp(this.base.hand[i]!, 1 - spread);
          p.palm[i]!.set(-side, 0, 0);
          p.fist[i] = 0.4 * close;
          p.glow[i] = 0.8 * spread;
        }
        p.pitch = 0.05;
        return;
      }
      case 'gravity': {
        // Clutching fists pulled down and in toward the body: the well.
        const reach = smooth(0, 0.22, u);
        const pull = smooth(0.25, 0.6, u);
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? 1 : -1;
          p.hand[i]!.set(side * (0.15 - 0.03 * pull), 1.25 - 0.23 * pull, 0.45 - 0.15 * pull);
          p.hand[i]!.lerp(this.base.hand[i]!, 1 - reach);
          p.palm[i]!.set(0, -0.5, 0.85).normalize();
          p.fist[i] = 0.3 + 0.6 * pull;
          p.glow[i] = 0.85 * reach;
        }
        p.pitch = 0.12 * pull;
        p.crouch = 0.1 + 0.2 * pull;
        return;
      }
      case 'focus': {
        // Hands together before the chest, head bowed.
        const k = smooth(0, 0.25, u);
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? 1 : -1;
          p.hand[i]!.lerp(tmp.set(side * 0.03, 1.3, 0.22), k);
          p.palm[i]!.set(-side, 0, 0);
          p.fist[i] = 0;
          p.glow[i] = 0.9 * k;
        }
        p.look.lerp(tmp.set(0, 0.8, 1.5), k);
        p.pitch = 0.08 * k;
        return;
      }
    }
  }
}

/** Arms up in a V, a bounce, the head up: a goal scored. */
function celebrate(p: WielderPose, u: number, t: number, role: (i: number) => number): void {
  const up = smooth(0, 0.15, u);
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    p.hand[i]!.lerp(tmp.set(side * 0.36, 2.1 + 0.03 * Math.sin(t * 7 + role(i)), 0.08), up);
    p.palm[i]!.set(0, 0.6, 0.8).normalize();
    p.pole[i]!.set(side * 0.9, 1.4, -0.2);
    p.fist[i] = 0.85;
    p.glow[i] = 1;
  }
  p.hips.y = 0.05 * Math.max(0, Math.sin(Math.min(1, u * 3) * Math.PI));
  p.pitch = -0.1 * up;
  p.look.set(0, 3.2, 4);
  p.crouch = 0;
}

/** Knocked back, arms thrown out: a goal conceded. */
function stagger(p: WielderPose, u: number): void {
  const hit = smooth(0, 0.15, u) * (1 - smooth(0.5, 1, u));
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? 1 : -1;
    p.hand[i]!.lerp(tmp.set(side * 0.38, 1.22, 0.05), hit);
    p.palm[i]!.set(side * 0.3, 0, 1).normalize();
    p.fist[i] = 0.1;
  }
  p.pitch = -0.22 * hit;
  p.hips.z = -0.06 * hit;
  p.crouch = 0.15 * hit;
}

/**
 * How much the core threatens this wielder's goal, 0..1: near it and coming at it. The wielder
 * braces (D10: "subtly brace against forces"); nothing else depends on it.
 */
export function threat(s: WielderState): number {
  if (!s.core || !s.coreV || s.phase !== 'playing') return 0;
  const toward = Math.sign(s.ownGoalX) * finite(s.coreV[0]);
  const dist = Math.abs(s.ownGoalX - finite(s.core[0]));
  return smooth(14, 4, dist) * smooth(1, 8, toward);
}
