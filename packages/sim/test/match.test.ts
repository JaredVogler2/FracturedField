import { describe, expect, it } from 'vitest';
import { DEFAULT_ABILITIES, DEFAULT_RULES, MERIDIAN_ARENA, secondsToTicks } from '@ff/game-data';
import type { GameEvent } from '@ff/protocol';
import { GameWorld, scoringPlaneX, type StepResult } from '../src/index.js';
import { IntentScript, skipCountdown, stepN, stepUntil } from '@ff/test-utils';

const R = DEFAULT_RULES;
const A = DEFAULT_ABILITIES;
const hover = R.core.hoverHeight;
const plane = scoringPlaneX(MERIDIAN_ARENA, R.core);
const tick = (s: number) => secondsToTicks(s, R.match.tickRate);

async function live(seed = 11): Promise<{ w: GameWorld; s: IntentScript }> {
  const w = await GameWorld.create({ seed, autoStart: true });
  skipCountdown(w);
  w.debugClearKickoffShield();
  return { w, s: new IntentScript(w) };
}

const events = (rs: readonly StepResult[]): GameEvent[] => rs.flatMap((r) => [...r.events]);
const ofType = <T extends GameEvent['type']>(rs: readonly StepResult[], t: T) =>
  events(rs).filter((e): e is Extract<GameEvent, { type: T }> => e.type === t);

/** Fires the core into the +X goal (scored by slot 0) and returns the step results. */
function shootIntoPlusX(w: GameWorld, ticks = 120): StepResult[] {
  w.debugPlaceBody(w.coreEntityId, plane - 1.2, hover, 0, 14, 0, 0);
  return stepN(w, ticks);
}

describe('kickoff', () => {
  it('countdown lasts 3 s, then the core receives a seeded nudge and play begins', async () => {
    const w = await GameWorld.create({ seed: 4, autoStart: true });
    expect(w.phase).toBe('countdown');
    const rs = stepUntil(w, () => w.phase === 'playing', 200);
    expect(rs.length).toBe(tick(R.match.countdownSeconds));
    const kick = ofType(rs, 'kickoff')[0];
    expect(kick).toBeDefined();
    const speed = Math.hypot(kick!.v[0], kick!.v[2]);
    expect(speed).toBeCloseTo(R.match.kickoffSpeed, 1);
    w.dispose();
  });

  it('the kickoff shield makes the core ignore abilities briefly', async () => {
    const w = await GameWorld.create({ seed: 4, autoStart: true });
    skipCountdown(w);
    const core = () => w.snapshot().entities.find((e) => e.kind === 'core')!;
    const before = core().v;
    w.debugPlaceManipulator(0, core().p[0] - 1, core().p[2]);
    new IntentScript(w).send(0, 'pulse', 'tap', { at: [core().p[0] - 1, core().p[2]] });
    stepN(w, 1);
    const after = core().v;
    expect(Math.abs(after[0] - before[0])).toBeLessThan(0.5);
    w.dispose();
  });
});

describe('scoring (G03 / S09 / S15)', () => {
  it('a goal is awarded exactly once to the correct player, then the field resets', async () => {
    const { w } = await live();
    const rs = shootIntoPlusX(w, tick(R.match.goalPauseSeconds) + 20);
    const goals = ofType(rs, 'goal');
    expect(goals).toHaveLength(1);
    expect(goals[0]!.scorer).toBe(0);
    expect(w.snapshot().match.score).toEqual([1, 0]);
    expect(w.phase).toBe('countdown');
    const core = w.snapshot().entities.find((e) => e.kind === 'core')!;
    expect(core.p[0]).toBeCloseTo(0, 3);
    expect(core.p[2]).toBeCloseTo(0, 3);
    w.dispose();
  });

  it('slot 1 scores into the -X goal', async () => {
    const { w } = await live();
    w.debugPlaceBody(w.coreEntityId, -plane + 1.2, hover, 1, -14, 0, 0);
    const goals = ofType(stepN(w, 30), 'goal');
    expect(goals.map((g) => g.scorer)).toEqual([1]);
    w.dispose();
  });

  it('a core leaving the cavity (wrong direction) or grazing the line never scores', async () => {
    const { w } = await live();
    w.debugPlaceBody(w.coreEntityId, plane + 1.0, hover, 0, -6, 0, 0);
    expect(ofType(stepN(w, 30), 'goal')).toHaveLength(0);
    w.debugPlaceBody(w.coreEntityId, MERIDIAN_ARENA.halfLength - 0.4, hover, 0, 0.4, 0, 0);
    expect(ofType(stepN(w, 10), 'goal')).toHaveLength(0);
    w.dispose();
  });

  it('three goals win the round; the next round starts level', async () => {
    const { w } = await live();
    for (let g = 0; g < 3; g++) {
      shootIntoPlusX(w, 5);
      stepUntil(w, () => w.phase === 'playing', 400);
      w.debugClearKickoffShield();
    }
    const snap = w.snapshot().match;
    expect(snap.round).toBe(2);
    expect(snap.roundWins).toEqual([1, 0]);
    expect(snap.score).toEqual([0, 0]);
    w.dispose();
  });

  it('two round wins end the match; a rematch resets everything to round 1', async () => {
    const { w } = await live();
    let end: GameEvent | undefined;
    for (let g = 0; g < 6 && !end; g++) {
      const rs = shootIntoPlusX(w, 5);
      const more = stepUntil(w, () => w.phase === 'playing' || w.phase === 'matchEnd', 600);
      end = [...ofType(rs, 'matchEnd'), ...ofType(more, 'matchEnd')][0];
      w.debugClearKickoffShield();
    }
    expect(end).toMatchObject({ type: 'matchEnd', winner: 0 });
    expect(w.phase).toBe('matchEnd');
    expect(w.matchSummary.roundWins).toEqual([2, 0]);
    w.rematch();
    expect(w.phase).toBe('countdown');
    expect(w.snapshot().match).toMatchObject({
      round: 1,
      score: [0, 0],
      roundWins: [0, 0],
      winner: null,
    });
    w.dispose();
  });

  it('a level clock enters Golden Rift; the next goal wins the round', async () => {
    const { w } = await live();
    w.debugSetClock(2);
    stepN(w, 3);
    expect(w.snapshot().match.golden).toBe(true);
    expect(w.phase).toBe('playing');
    const rs = shootIntoPlusX(w, 5);
    expect(ofType(rs, 'roundEnd')[0]).toMatchObject({ winner: 0, reason: 'golden' });
    w.dispose();
  });

  it('an expired Golden Rift is decided by territory (core in the opponent half)', async () => {
    const { w } = await live();
    w.debugSetClock(1);
    stepN(w, 2);
    expect(w.snapshot().match.golden).toBe(true);
    w.debugPlaceBody(w.coreEntityId, -6, hover, 0);
    w.debugSetClock(1);
    const rs = stepN(w, 2);
    expect(ofType(rs, 'roundEnd')[0]).toMatchObject({ winner: 1, reason: 'territory' });
    w.dispose();
  });

  it('a clock expiring with a lead awards the round on goals', async () => {
    const { w } = await live();
    shootIntoPlusX(w, 5);
    stepUntil(w, () => w.phase === 'playing', 400);
    w.debugSetClock(1);
    const rs = stepN(w, 2);
    expect(ofType(rs, 'roundEnd')[0]).toMatchObject({ winner: 0, reason: 'clock' });
    w.dispose();
  });

  it('S15: a goal on the same tick the clock expires is processed first and only once', async () => {
    const { w } = await live();
    w.debugPlaceBody(w.coreEntityId, plane - 0.2, hover, 0, 14, 0, 0);
    w.debugSetClock(1);
    const rs = stepN(w, 3);
    expect(ofType(rs, 'goal')).toHaveLength(1);
    expect(w.snapshot().match.golden).toBe(false);
    expect(w.snapshot().match.score).toEqual([1, 0]);
    w.dispose();
  });
});

describe('energy, cooldowns, lockouts', () => {
  it('pulse spends energy; spam is refused by cooldown, then by energy exhaustion', async () => {
    const { w, s } = await live();
    w.debugSetEnergy(0, 25);
    s.send(0, 'pulse', 'tap', { at: [-5, 0] });
    s.send(0, 'pulse', 'tap', { at: [-5, 0] });
    const r1 = stepN(w, 1)[0]!;
    expect(r1.results.map((r) => r.result.accepted)).toEqual([true, false]);
    expect(r1.results[1]!.result.reason).toBe('cooldown');
    expect(w.debugPlayer(0).energy).toBeCloseTo(15, 0);
    stepN(w, tick(A.pulse.cooldownSeconds) + 1);
    w.debugSetEnergy(0, 5);
    s.send(0, 'pulse', 'tap', { at: [-5, 0] });
    expect(stepN(w, 1)[0]!.results[0]!.result.reason).toBe('energy');
    w.dispose();
  });

  it('a global lockout prevents two abilities in the same instant', async () => {
    const { w, s } = await live();
    s.send(0, 'pulse', 'tap', { at: [-5, 0] });
    s.send(0, 'sweep', 'tap', { at: [-5, 0] });
    const r = stepN(w, 1)[0]!;
    expect(r.results.map((x) => x.result.reason ?? 'ok')).toEqual(['ok', 'lockout']);
    w.dispose();
  });

  it('energy regenerates at the configured rate, but only after the post-spend delay', async () => {
    const { w, s } = await live();
    s.send(0, 'pulse', 'tap', { at: [-5, 0] });
    stepN(w, 1); // spend -> regen delay armed (and already decremented once this tick)
    w.debugSetEnergy(0, 0);
    stepN(w, tick(R.energy.regenDelaySeconds) - 1);
    expect(w.debugPlayer(0).energy).toBe(0); // still inside the delay
    stepN(w, tick(1));
    expect(w.debugPlayer(0).energy).toBeCloseTo(R.energy.regenPerSecond, 0);
    w.dispose();
  });

  it('abilities are refused outside active play, and duplicate sequences are stale', async () => {
    const w = await GameWorld.create({ seed: 2 });
    const s = new IntentScript(w);
    s.send(0, 'pulse', 'tap');
    expect(stepN(w, 1)[0]!.results[0]!.result.reason).toBe('not_playing');
    const { w: w2 } = await live();
    const intent = new IntentScript(w2).send(1, 'pulse', 'tap', { at: [5, 0] });
    w2.applyCommand(1, intent);
    const res = stepN(w2, 1)[0]!.results;
    expect(res.map((r) => r.result.reason ?? 'ok')).toEqual(['ok', 'stale']);
    w.dispose();
    w2.dispose();
  });
});

describe('anti-stall drift', () => {
  it('a dead core deep in one half eases back within reach; a moving core is unaffected', async () => {
    const { w } = await live(31);
    w.debugPlaceBody(w.coreEntityId, 10, hover, -9);
    stepN(w, tick(5));
    const c = w.snapshot().entities.find((e) => e.kind === 'core')!;
    expect(c.p[0]).toBeLessThan(10 - 2.5);
    expect(Math.hypot(c.v[0], c.v[2])).toBeLessThan(R.core.idleDriftSpeed);
    // A shot at speed is not bent by the drift.
    w.debugPlaceBody(w.coreEntityId, 8, hover, 0, 9, 0, 0);
    stepN(w, 10);
    const moving = w.snapshot().entities.find((e) => e.kind === 'core')!;
    // Only linear damping acts on the fast core: v = 9 · e^(-c · t).
    const dampedOnly = 9 * Math.exp(-R.core.linearDamping * (10 / R.match.tickRate));
    expect(moving.v[0]).toBeCloseTo(dampedOnly, 1);
    w.dispose();
  });
});

describe('manipulators', () => {
  it('move at the capped speed and stay inside their own half', async () => {
    const { w, s } = await live();
    const start = w.snapshot().players[0].m;
    s.send(0, 'aim', 'hold', { aim: [1, 1] });
    stepN(w, 1);
    const after = w.snapshot().players[0].m;
    const moved = Math.hypot(after[0] - start[0], after[1] - start[1]);
    // Snapshot positions are quantised to 1 mm, hence the small tolerance.
    expect(moved).toBeLessThanOrEqual(R.manipulator.maxSpeed / R.match.tickRate + 0.002);
    stepN(w, 120);
    const end = w.snapshot().players[0].m;
    expect(end[0]).toBeLessThanOrEqual(R.manipulator.midlineReach + 1e-6);
    expect(end[1]).toBeLessThanOrEqual(MERIDIAN_ARENA.halfWidth - R.manipulator.wallMargin + 1e-6);
    w.dispose();
  });
});

describe('guard (barrier)', () => {
  it('spawns a real collider that blocks a shot and expires on time', async () => {
    const { w, s } = await live();
    w.debugPlaceManipulator(1, 12, 0);
    w.debugPlaceBody(w.coreEntityId, 4, hover, 0);
    s.send(1, 'guard', 'tap', { at: [12, 0] });
    const r = stepN(w, 1)[0]!;
    expect(r.results[0]!.result.accepted).toBe(true);
    expect(ofType([r], 'spawn')).toHaveLength(1);
    // Fire the core at the barrier.
    w.debugPlaceBody(w.coreEntityId, 6, hover, 0, 13, 0, 0);
    const rs = stepN(w, 40);
    const core = w.snapshot().entities.find((e) => e.kind === 'core')!;
    expect(core.v[0]).toBeLessThan(0); // ricocheted back
    expect(ofType(rs, 'goal')).toHaveLength(0);
    const life = tick(A.guard.lifetimeSeconds);
    const rest = stepN(w, life);
    const gone = ofType([...rs, ...rest], 'despawn');
    expect(gone.length).toBeGreaterThanOrEqual(1);
    w.dispose();
  });

  it('refuses placement on the goal line or overlapping the core; retires the oldest at the limit', async () => {
    const { w, s } = await live();
    w.debugPlaceManipulator(1, MERIDIAN_ARENA.halfLength - 1, 0);
    s.send(1, 'guard', 'tap', { at: [MERIDIAN_ARENA.halfLength - 1, 0] });
    expect(stepN(w, 1)[0]!.results[0]!.result.reason).toBe('illegal_target');
    w.debugPlaceBody(w.coreEntityId, 10, hover, 0);
    w.debugPlaceManipulator(1, 10, 0);
    s.send(1, 'guard', 'tap', { at: [10, 0] });
    expect(stepN(w, 1)[0]!.results[0]!.result.reason).toBe('illegal_target');
    // Place three guards in turn: the first is retired when the third appears.
    w.debugPlaceBody(w.coreEntityId, -8, hover, 0);
    const spots: [number, number][] = [
      [8, -8],
      [8, 0],
      [8, 8],
    ];
    for (const [x, z] of spots) {
      w.debugPlaceManipulator(1, x, z);
      w.debugSetEnergy(1, 100);
      s.send(1, 'guard', 'tap', { at: [x, z] });
      stepN(w, tick(A.guard.cooldownSeconds) + 1);
    }
    expect(w.debugPlayer(1).guards).toHaveLength(R.limits.maxGuardsPerPlayer);
    w.dispose();
  });
});

describe('lift', () => {
  it('raises the core above barrier height while draining energy; release lets it fall back', async () => {
    const { w, s } = await live();
    w.debugPlaceBody(w.coreEntityId, -4, hover, 0);
    w.debugPlaceManipulator(0, -5, 0);
    s.send(0, 'lift', 'start', { at: [-5, 0] });
    const first = stepN(w, 1)[0]!;
    expect(first.results[0]!.result.accepted).toBe(true);
    stepN(w, 30);
    const lifted = w.snapshot().entities.find((e) => e.kind === 'core')!;
    expect(lifted.p[1]).toBeGreaterThan(A.guard.halfHeight * 2 + R.core.radius * 0.6);
    expect(w.debugPlayer(0).energy).toBeLessThan(100 - A.lift.cost);
    s.send(0, 'lift', 'end', { at: [-5, 0] });
    stepN(w, 45);
    const settled = w.snapshot().entities.find((e) => e.kind === 'core')!;
    expect(settled.p[1]).toBeLessThan(hover + 0.6);
    w.dispose();
  });

  it('is refused when nothing is in range and cancelled when the player disconnects', async () => {
    const { w, s } = await live();
    w.debugPlaceBody(w.coreEntityId, 10, hover, 0);
    w.debugPlaceManipulator(0, -15, 0);
    s.send(0, 'lift', 'start', { at: [-15, 0] });
    expect(stepN(w, 1)[0]!.results[0]!.result.reason).toBe('out_of_range');
    w.debugPlaceBody(w.coreEntityId, -14, hover, 0);
    s.send(0, 'lift', 'start', { at: [-15, 0] });
    stepN(w, 2);
    expect(w.snapshot().players[0].hold).toBe('lift');
    w.setConnected(0, false);
    expect(w.snapshot().players[0].hold).toBeNull();
    w.dispose();
  });
});

describe('sweep (crosswind)', () => {
  it('curves a passing core relative to the same shot without the wind', async () => {
    const run = async (withSweep: boolean) => {
      const { w, s } = await live(21);
      w.debugPlaceManipulator(0, -6, 1);
      if (withSweep) {
        s.send(0, 'sweep', 'tap', { at: [-6, 1], modifier: 1 });
        stepN(w, 1);
      }
      w.debugPlaceBody(w.coreEntityId, -12, hover, 0, 12, 0, 0);
      stepN(w, 40);
      const core = w.snapshot().entities.find((e) => e.kind === 'core')!;
      w.dispose();
      return { z: core.p[2], vz: core.v[2] };
    };
    const straight = await run(false);
    const curved = await run(true);
    expect(Math.abs(curved.z - straight.z)).toBeGreaterThan(1.5);
    // Slot 0 with modifier +1 blows to its left (-Z); the bend persists after leaving the field.
    expect(curved.z).toBeLessThan(straight.z);
    expect(straight.vz - curved.vz).toBeGreaterThan(2);
  });

  it('a heavy boulder is pushed less than the light core (wind is a force)', async () => {
    const { w, s } = await live(23);
    w.debugPlaceManipulator(0, -8, 0);
    s.send(0, 'sweep', 'tap', { at: [-8, 0], modifier: 1 });
    stepN(w, 1);
    const boulder = w.snapshot().entities.find((e) => e.kind === 'boulder')!;
    // Same distance from the field centre (same falloff), 4 m apart so they cannot collide.
    w.debugPlaceBody(w.coreEntityId, -6, hover, 0);
    w.debugPlaceBody(boulder.id, -10, 0.75, 0);
    stepN(w, 12);
    const snap = w.snapshot();
    const vc = snap.entities.find((e) => e.kind === 'core')!.v;
    const vb = snap.entities.find((e) => e.id === boulder.id)!.v;
    expect(Math.abs(vc[2])).toBeGreaterThan(Math.abs(vb[2]) * 1.5);
    w.dispose();
  });

  it('opposite crosswinds at the same spot cancel (R9)', async () => {
    const { w, s } = await live(22);
    w.debugPlaceManipulator(0, 0, 0);
    w.debugPlaceManipulator(1, 0.5, 0);
    // Modifiers are relative to each caster's facing: both "left" winds oppose each other
    // (slot 0's left is -Z, slot 1's left is +Z).
    s.send(0, 'sweep', 'tap', { at: [0, 0], modifier: 1 });
    s.send(1, 'sweep', 'tap', { at: [0, 0], modifier: 1 });
    stepN(w, 1);
    w.debugPlaceBody(w.coreEntityId, 0, hover, 2.2, 0, 0, 0);
    stepN(w, 20);
    const v = w.snapshot().entities.find((e) => e.kind === 'core')!.v;
    expect(Math.hypot(v[0], v[2])).toBeLessThan(1.5);
    w.dispose();
  });
});

describe('opposed pulses superpose', () => {
  it('equal and opposite pulses on the same tick roughly cancel instead of picking a winner', async () => {
    const { w, s } = await live();
    w.debugPlaceBody(w.coreEntityId, 0, hover, 0);
    w.debugPlaceManipulator(0, -1.5, 0);
    w.debugPlaceManipulator(1, 1.5, 0);
    s.send(0, 'pulse', 'tap', { at: [-1.5, 0] });
    s.send(1, 'pulse', 'tap', { at: [1.5, 0] });
    const r = stepN(w, 1)[0]!;
    expect(r.results.every((x) => x.result.accepted)).toBe(true);
    const v = w.snapshot().entities.find((e) => e.kind === 'core')!.v;
    expect(Math.abs(v[0])).toBeLessThan(0.5);
    w.dispose();
  });
});
