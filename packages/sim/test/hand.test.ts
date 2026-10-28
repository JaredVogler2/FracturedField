/**
 * Continuous manipulation (ADR-0009, milestone 06M-M1): the authority turns a described hand —
 * grip, push, twist, and the force point's own capped motion — into bounded forces. Throwing is
 * letting go of a swinging body; a twist curves the core; an open hand drags bodies along its
 * motion in proportion to its speed; push and pull press and draw; a lost hand lets go. Every
 * test drives the world only through intents, as any input method would.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@ff/game-data';
import type { GameEvent, HandState, PlayerSlot } from '@ff/protocol';
import { IntentScript, skipCountdown, stepN } from '@ff/test-utils';
import { GameWorld } from '../src/index.js';

const H = DEFAULT_RULES.hand;
const HOVER = DEFAULT_RULES.core.hoverHeight;
const OPEN: HandState = { grip: 0, push: 0, twist: 0 };
const FIST: HandState = { grip: 1, push: 0, twist: 0 };

/** A playing world with the core resting at (x, z) and seat 0's force point on it. */
async function bench(x = -6, z = 0, seed = 3) {
  const w = await GameWorld.create({ seed, autoStart: true });
  skipCountdown(w);
  w.debugClearKickoffShield();
  const core = w.coreEntityId;
  w.debugPlaceBody(core, x, HOVER, z);
  w.debugPlaceManipulator(0, x, z);
  const s = new IntentScript(w);
  const events: GameEvent[] = [];
  /** One tick: seat `slot`'s hand at world (x, z) in the given state. */
  const tick = (at: readonly [number, number], hand: HandState, slot: PlayerSlot = 0) => {
    s.send(slot, 'aim', 'hold', { at, hand, source: 'camera' });
    events.push(...w.stepFixed().events);
  };
  /** One tick of an input that describes no hand (keys, touch, the bot): aim alone. */
  const aimOnly = (at: readonly [number, number], slot: PlayerSlot = 0) => {
    s.send(slot, 'aim', 'hold', { at, source: 'keyboard' });
    events.push(...w.stepFixed().events);
  };
  const body = () => w.snapshot().entities.find((e) => e.id === core)!;
  return { w, core, tick, aimOnly, body, events };
}

/** Holds the core with a fist, swings the hand from x0 to x1 along z = 0, and lets go. */
async function swingAndRelease(x0: number, x1: number, hand: HandState = FIST) {
  const b = await bench(x0, 0);
  for (let i = 0; i < 6; i++) b.tick([x0, 0], hand);
  const steps = 14;
  for (let i = 1; i <= steps; i++) b.tick([x0 + ((x1 - x0) * i) / steps, 0], hand);
  b.tick([x1, 0], { ...hand, grip: 0 });
  return b;
}

describe('grip and throw', () => {
  it('a closing hand grips the core within reach and carries it up to the hold height', async () => {
    const b = await bench();
    b.tick([-6, 0], { grip: 0.5, push: 0, twist: 0 }); // half-closed: below the engage grip
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(b.core);
    expect(b.w.snapshot().players[0].grasp).toBe(b.core);
    const start = b.events.find((e) => e.type === 'grip' && e.phase === 'start');
    expect(start).toMatchObject({ slot: 0, entity: b.core });
    for (let i = 0; i < 45; i++) b.tick([-6, 0], FIST);
    const e = b.body();
    expect(e.p[1]).toBeGreaterThan(H.holdHeight - 0.25);
    expect(e.p[1]).toBeLessThan(H.holdHeight + 0.25);
    expect(Math.hypot(e.p[0] + 6, e.p[2])).toBeLessThan(0.3);
    b.w.dispose();
  });

  it('letting go of a swinging core throws it along the swing, no faster than the hand moved', async () => {
    const b = await swingAndRelease(-8, -2);
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    const end = b.events.find((e) => e.type === 'grip' && e.phase === 'end');
    expect(end?.type === 'grip' && end.v[0]).toBeGreaterThan(5);
    stepN(b.w, 3);
    const v = b.body().v;
    expect(v[0]).toBeGreaterThan(5);
    expect(Math.abs(v[2])).toBeLessThan(1);
    expect(Math.hypot(v[0], v[2])).toBeLessThanOrEqual(DEFAULT_RULES.manipulator.maxSpeed * 1.35);
    b.w.dispose();
  });

  it('a light grip follows a moving hand more loosely than a firm one', async () => {
    // The hand sways ±1 m at 0.5 Hz (well under every cap): a firm hold tracks it closely, a
    // light one (still above the release grip) trails and swings.
    const error = async (grip: number) => {
      const b = await bench(-8, 0);
      for (let i = 0; i < 20; i++) b.tick([-8, 0], FIST);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < 90; i++) {
        b.tick([-8 + Math.sin((Math.PI * i) / 30), 0], { grip, push: 0, twist: 0 });
        if (i < 30) continue;
        const p = b.body().p;
        const m = b.w.snapshot().players[0].m;
        sum += (p[0] - m[0]) ** 2 + (p[2] - m[1]) ** 2;
        n++;
      }
      expect(b.w.debugPlayer(0).grasp).toBe(b.core);
      b.w.dispose();
      return Math.sqrt(sum / n);
    };
    const firm = await error(1);
    const light = await error(0.5);
    expect(firm).toBeLessThan(0.45);
    expect(light).toBeGreaterThan(firm * 1.8);
  });

  it('holds between the release and engage grips (hysteresis), and lets go below', async () => {
    const b = await bench();
    b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(b.core);
    for (let i = 0; i < 5; i++) b.tick([-6, 0], { grip: 0.45, push: 0, twist: 0 });
    expect(b.w.debugPlayer(0).grasp).toBe(b.core);
    b.tick([-6, 0], { grip: H.releaseGrip - 0.05, push: 0, twist: 0 });
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    // Closing again at once does not re-grip (the short regrip delay), shortly after it does.
    b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    for (let i = 0; i < 8; i++) b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(b.core);
    b.w.dispose();
  });

  it('grips nothing out of reach, and not the core under the kickoff shield', async () => {
    const b = await bench(-6, 0);
    const far = -6 + H.reach + H.coreBias + 1.5;
    b.w.debugPlaceManipulator(0, far, 0);
    for (let i = 0; i < 5; i++) b.tick([far, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    b.w.dispose();
    // Right after kickoff the core ignores player forces: a fist on it grips only once the
    // shield is over.
    const k = await GameWorld.create({ seed: 4, autoStart: true });
    skipCountdown(k);
    k.debugPlaceManipulator(0, 0, 0);
    const s = new IntentScript(k);
    s.send(0, 'aim', 'hold', { at: [0, 0], hand: FIST });
    k.stepFixed();
    expect(k.debugPlayer(0).grasp).not.toBe(k.coreEntityId);
    for (let i = 0; i < 20; i++) {
      s.send(0, 'aim', 'hold', { at: [0, 0], hand: FIST });
      k.stepFixed();
    }
    expect(k.debugPlayer(0).grasp).toBe(k.coreEntityId);
    k.dispose();
  });

  it('a hand that arrives late — a stalled frame, a burst of network jitter — keeps its grip', async () => {
    const b = await bench();
    b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(b.core);
    // Updates 0.45 s apart for about 3 s: a page drawing ~2 frames a second, or a jittery link.
    const gap = Math.round(0.45 * DEFAULT_RULES.match.tickRate) - 1;
    for (let i = 0; i < 7; i++) {
      stepN(b.w, gap);
      b.tick([-6, 0], FIST);
      expect(b.w.debugPlayer(0).grasp, `update ${i + 1}`).toBe(b.core);
    }
    b.w.dispose();
  });

  it('a lost hand (no update for the stale time) lets go; so does a disconnect', async () => {
    const b = await bench();
    b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(b.core);
    stepN(b.w, Math.ceil(H.staleSeconds * DEFAULT_RULES.match.tickRate) + 2);
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    const c = await bench();
    c.tick([-6, 0], FIST);
    c.w.setConnected(0, false);
    expect(c.w.debugPlayer(0).grasp).toBe(-1);
    b.w.dispose();
    c.w.dispose();
  });
});

describe('twist and curve', () => {
  it('a twisting grip spins the core; thrown, it curves to the side its spin says, and the curve fades', async () => {
    const lateral = async (twist: number) => {
      const b = await bench(-12, 0);
      for (let i = 0; i < 6; i++) b.tick([-12, 0], { grip: 1, push: 0, twist });
      for (let i = 1; i <= 14; i++) b.tick([-12 + (10 * i) / 14, 0], { grip: 1, push: 0, twist });
      const spin = b.w.debugCoreSpin();
      expect(b.body().s ?? 0).toBeCloseTo(spin, 2);
      b.tick([-2, 0], OPEN);
      stepN(b.w, 20);
      const out = { z: b.body().p[2], spin, later: b.w.debugCoreSpin() };
      b.w.dispose();
      return out;
    };
    const plain = await lateral(0);
    const right = await lateral(1); // clockwise wrist: clockwise spin seen from above
    const left = await lateral(-1);
    expect(plain.spin).toBe(0);
    // Clients see the spin (curve previews, effects) only while there is one.
    expect(right.spin).toBeLessThan(-H.maxSpin * 0.5);
    expect(left.spin).toBeGreaterThan(H.maxSpin * 0.5);
    // Moving +x (y up), the right-hand side is +z: a clockwise spin bends the core that way.
    expect(right.z).toBeGreaterThan(plain.z + 0.3);
    expect(left.z).toBeLessThan(plain.z - 0.3);
    // Symmetric, bounded (a ≤ the cap over ~0.7 s of flight), and fading.
    expect(Math.abs(left.z - plain.z)).toBeCloseTo(Math.abs(right.z - plain.z), 0);
    expect(Math.abs(left.z - plain.z)).toBeLessThan(0.5 * H.maxMagnusAcceleration * 0.8 ** 2 + 0.2);
    expect(Math.abs(left.later)).toBeLessThan(Math.abs(left.spin));
  });
});

describe('open hand and push', () => {
  it('an open hand sweeping past drags the core along its motion, more the faster it moves', async () => {
    // Inside the anti-stall dead zone (|x| < 4), so only the hand moves the core.
    const sweep = async (speed: number) => {
      const b = await bench(-3, 0);
      const z0 = -4;
      b.w.debugPlaceManipulator(0, -3.6, z0);
      const steps = Math.ceil((8 / speed) * DEFAULT_RULES.match.tickRate);
      for (let i = 1; i <= steps; i++) b.tick([-3.6, z0 + (8 * i) / steps], OPEN);
      const v = b.body().v;
      b.w.dispose();
      return v;
    };
    const still = await bench(-3, 0);
    still.w.debugPlaceManipulator(0, -3.6, 0);
    for (let i = 0; i < 20; i++) still.tick([-3.6, 0], OPEN);
    expect(Math.hypot(still.body().v[0], still.body().v[2])).toBeLessThan(0.05);
    still.w.dispose();
    const slow = await sweep(3);
    const fast = await sweep(12);
    expect(slow[2]).toBeGreaterThan(0.2);
    expect(fast[2]).toBeGreaterThan(slow[2] * 1.3);
    // The drag never makes the core outrun the hand that dragged it.
    expect(fast[2]).toBeLessThanOrEqual(12.5);
  });

  it('without a hand channel — keys, touch, the bot — a force point rushing past drags nothing', async () => {
    const b = await bench(-3, 0);
    b.w.debugPlaceManipulator(0, -3.6, -4);
    for (let i = 1; i <= 20; i++) b.aimOnly([-3.6, -4 + (8 * i) / 20]); // 12 m/s, 0.6 m away
    expect(Math.hypot(b.body().v[0], b.body().v[2])).toBeLessThan(0.05);
    b.w.dispose();
  });

  it('an open hand held still — jittering like a tracked camera hand — leaves a resting core alone', async () => {
    const b = await bench(-3, 0);
    b.w.debugPlaceManipulator(0, -3.6, 0);
    // ±6 cm of tracking jitter, a new aim every other tick (a 15 fps camera), for 5 s.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let aim: [number, number] = [-3.6, 0];
    for (let i = 0; i < 150; i++) {
      if (i % 2 === 0) aim = [-3.6 + rnd() * 0.06, rnd() * 0.06];
      b.tick(aim, OPEN);
    }
    const c = b.body();
    expect(Math.hypot(c.p[0] + 3, c.p[2])).toBeLessThan(0.1);
    expect(Math.hypot(c.v[0], c.v[2])).toBeLessThan(0.05);
    b.w.dispose();
  });

  it('push presses the core away from the hand, pull draws it in; both cost energy', async () => {
    const b = await bench(-4, 0);
    b.w.debugPlaceManipulator(0, -6.5, 0);
    const e0 = b.w.debugPlayer(0).energy;
    for (let i = 0; i < 8; i++) b.tick([-6.5, 0], { grip: 0, push: 1, twist: 0 });
    expect(b.body().v[0]).toBeGreaterThan(3);
    const spent = e0 - b.w.debugPlayer(0).energy;
    expect(spent).toBeGreaterThan(1);
    b.w.dispose();
    const c = await bench(-4, 0);
    c.w.debugPlaceManipulator(0, -6.5, 0);
    for (let i = 0; i < 8; i++) c.tick([-6.5, 0], { grip: 0, push: -1, twist: 0 });
    expect(c.body().v[0]).toBeLessThan(-1);
    c.w.dispose();
    // Inside the dead zone nothing happens.
    const d = await bench(-4, 0);
    d.w.debugPlaceManipulator(0, -6.5, 0);
    for (let i = 0; i < 8; i++)
      d.tick([-6.5, 0], { grip: 0, push: H.pushDeadZone * 0.8, twist: 0 });
    expect(Math.abs(d.body().v[0])).toBeLessThan(0.05);
    d.w.dispose();
  });
});

describe('energy, limits and authority', () => {
  it('holding still costs about LIFT’s rate; a full swing-and-throw costs about a PULSE', async () => {
    const b = await bench();
    for (let i = 0; i < 30; i++) b.tick([-6, 0], FIST); // settle at the hold height
    const e0 = b.w.debugPlayer(0).energy;
    for (let i = 0; i < 30; i++) b.tick([-6, 0], FIST);
    const perSecond = e0 - b.w.debugPlayer(0).energy;
    expect(perSecond).toBeGreaterThan(H.holdCostPerSecond * 0.9);
    expect(perSecond).toBeLessThan(8);
    b.w.dispose();
    const t = await bench(-8, 0);
    for (let i = 0; i < 6; i++) t.tick([-8, 0], FIST);
    const s0 = t.w.debugPlayer(0).energy;
    for (let i = 1; i <= 14; i++) t.tick([-8 + (6 * i) / 14, 0], FIST);
    t.tick([-2, 0], OPEN);
    const throwCost = s0 - t.w.debugPlayer(0).energy;
    expect(throwCost).toBeGreaterThan(3);
    expect(throwCost).toBeLessThan(25);
    t.w.dispose();
  });

  it('runs out of energy → lets go; hostile hand values are clamped and never break the state', async () => {
    const b = await bench();
    b.tick([-6, 0], FIST);
    b.w.debugSetEnergy(0, 0.05);
    for (let i = 0; i < 3; i++) b.tick([-6, 0], FIST);
    expect(b.w.debugPlayer(0).grasp).toBe(-1);
    const c = await bench();
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, -1e308, 1e308];
    for (let i = 0; i < 40; i++)
      c.tick([-6, 0], { grip: bad[i % 4]!, push: bad[(i + 1) % 4]!, twist: bad[(i + 2) % 4]! });
    for (const e of c.w.snapshot().entities)
      for (const n of [...e.p, ...e.v, ...e.q]) expect(Number.isFinite(n)).toBe(true);
    expect(Number.isFinite(c.w.debugCoreSpin())).toBe(true);
    expect(c.w.debugPlayer(0).energy).toBeGreaterThanOrEqual(0);
    b.w.dispose();
    c.w.dispose();
  });

  it('the Physics Lab can set the core spinning (debug only): clamped, shown in the snapshot', async () => {
    const b = await bench();
    b.w.debugSetCoreSpin(9);
    expect(b.w.debugCoreSpin()).toBe(9);
    const core = b.w.snapshot().entities.find((e) => e.kind === 'core')!;
    expect(core.s).toBe(9);
    b.w.debugSetCoreSpin(1e9);
    expect(b.w.debugCoreSpin()).toBe(H.maxSpin);
    b.w.debugSetCoreSpin(-1e9);
    expect(b.w.debugCoreSpin()).toBe(-H.maxSpin);
    b.w.debugSetCoreSpin(Number.NaN);
    expect(b.w.debugCoreSpin()).toBe(0);
    b.w.dispose();
  });

  it('is deterministic, and a checkpoint taken mid-grip continues identically', async () => {
    const run = async () => {
      const b = await bench(-9, 2);
      for (let i = 0; i < 90; i++) {
        const t = i / 30;
        b.tick([-9 + 4 * Math.sin(t * 2), 2 * Math.cos(t * 3)], {
          grip: i % 40 < 28 ? 1 : 0,
          push: Math.sin(t * 5) * 0.6,
          twist: Math.cos(t * 4),
        });
      }
      return b;
    };
    const a = await run();
    const b = await run();
    expect(a.w.stateHash()).toBe(b.w.stateHash());
    const cp = a.w.checkpoint();
    const r = await GameWorld.restore({ seed: 3 }, cp);
    expect(r.stateHash()).toBe(a.w.stateHash());
    for (let i = 0; i < 40; i++) {
      a.w.stepFixed();
      r.stepFixed();
    }
    expect(r.stateHash()).toBe(a.w.stateHash());
    a.w.dispose();
    b.w.dispose();
    r.dispose();
  });
});
