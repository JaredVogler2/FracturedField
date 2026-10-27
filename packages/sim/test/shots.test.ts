/**
 * D02 acceptance exercise: six representative physics shots from fixed seeds, played through the
 * real ability path (intents -> validation -> impulses/fields -> Rapier). Only the initial body and
 * manipulator placement is staged. Each shot is paired with a control where it matters, and the
 * measured outcome table is printed for docs/progress/PHASE-02.md.
 */
import { afterAll, describe, expect, it } from 'vitest';

// The sim package compiles without DOM/Node globals; declare the console this report uses.
declare const console: { log(...args: unknown[]): void; table(data: unknown): void };
import { DEFAULT_RULES } from '@ff/game-data';
import type { GameEvent, PlayerSlot } from '@ff/protocol';
import { GameWorld } from '../src/index.js';
import { IntentScript, skipCountdown, stepN } from '@ff/test-utils';

const hover = DEFAULT_RULES.core.hoverHeight;

interface ShotOutcome {
  goal: { scorer: PlayerSlot; tick: number } | null;
  launchSpeed: number;
  maxHeight: number;
  zAtGoalApproach: number | null;
  impacts: { a: number; b: number; impulse: number; tick: number }[];
  minVx: number;
}

const table: Record<string, string>[] = [];

async function arena(seed = 5) {
  const w = await GameWorld.create({ seed, autoStart: true });
  skipCountdown(w);
  w.debugClearKickoffShield();
  return { w, s: new IntentScript(w) };
}

function core(w: GameWorld) {
  return w.snapshot().entities.find((e) => e.kind === 'core')!;
}

/** Steps until a goal (or `max` ticks) and records what happened to the core. */
function play(w: GameWorld, max: number, launchAfterTicks = 1): ShotOutcome {
  const out: ShotOutcome = {
    goal: null,
    launchSpeed: 0,
    maxHeight: 0,
    zAtGoalApproach: null,
    impacts: [],
    minVx: Infinity,
  };
  for (let i = 0; i < max; i++) {
    const r = w.stepFixed();
    const c = core(w);
    if (i === launchAfterTicks - 1) out.launchSpeed = Math.hypot(c.v[0], c.v[1], c.v[2]);
    out.maxHeight = Math.max(out.maxHeight, c.p[1]);
    out.minVx = Math.min(out.minVx, c.v[0]);
    if (out.zAtGoalApproach === null && Math.abs(c.p[0]) > 19) out.zAtGoalApproach = c.p[2];
    for (const e of r.events as GameEvent[]) {
      if (e.type === 'impact') out.impacts.push({ a: e.a, b: e.b, impulse: e.impulse, tick: i });
      if (e.type === 'goal' && !out.goal) out.goal = { scorer: e.scorer, tick: i };
    }
    if (out.goal) break;
  }
  return out;
}

function record(name: string, o: ShotOutcome, note: string) {
  table.push({
    shot: name,
    'launch speed (m/s)': o.launchSpeed.toFixed(2),
    'peak height (m)': o.maxHeight.toFixed(2),
    impacts: String(o.impacts.length),
    result: o.goal ? `GOAL slot ${o.goal.scorer} @ tick ${o.goal.tick}` : 'no goal',
    note,
  });
}

afterAll(() => {
  console.log('\nD02 representative shots (seed 5, 30 Hz):');
  console.table(table);
});

describe('D02 representative physics shots', () => {
  it('1. direct shot: full-strength pulse scores straight down the middle', async () => {
    const { w, s } = await arena();
    w.debugPlaceBody(w.coreEntityId, 3.5, hover, 0);
    w.debugPlaceManipulator(0, 1.5, 0);
    s.send(0, 'pulse', 'tap', { at: [1.5, 0] });
    const o = play(w, 120);
    record('direct', o, 'Δv = 118 N·s / 8 kg');
    expect(o.launchSpeed).toBeGreaterThan(13);
    expect(o.goal?.scorer).toBe(0);
    w.dispose();
  });

  it('2. bank shot: rebounds off the side wall into the goal', async () => {
    const { w, s } = await arena();
    w.debugPlaceBody(w.coreEntityId, 2.5, hover, 4);
    w.debugPlaceManipulator(0, 1.4, 2.9);
    s.send(0, 'pulse', 'tap', { at: [1.4, 2.9] });
    const o = play(w, 150);
    record('bank', o, 'side-wall rebound');
    expect(o.impacts.some((i) => i.b === -1 && i.impulse > 50)).toBe(true);
    expect(o.goal?.scorer).toBe(0);
    w.dispose();
  });

  it('3. sweep curve: a shot aimed wide is bent into the goal by a crosswind laid first', async () => {
    const shoot = async (withSweep: boolean) => {
      const { w, s } = await arena();
      const [cx, cz, tz] = [3.2, 0, 4.8];
      const dx = 21.8 - cx;
      const dz = tz - cz;
      const L = Math.hypot(dx, dz);
      const mx = cx - (dx / L) * 1.6;
      const mz = cz - (dz / L) * 1.6;
      w.debugPlaceBody(w.coreEntityId, cx, hover, cz);
      w.debugPlaceManipulator(0, mx, mz);
      if (withSweep) s.send(0, 'sweep', 'tap', { at: [mx, mz], modifier: 1 });
      stepN(w, 6); // global lockout after a cast
      s.send(0, 'pulse', 'tap', { at: [mx, mz] });
      const o = play(w, 150);
      w.dispose();
      return o;
    };
    const control = await shoot(false);
    const curved = await shoot(true);
    record(
      'curve (control, no wind)',
      control,
      `z at x=19: ${control.zAtGoalApproach?.toFixed(2)}`,
    );
    record('curve (crosswind)', curved, `z at x=19: ${curved.zAtGoalApproach?.toFixed(2)}`);
    expect(control.goal).toBeNull();
    expect(curved.goal?.scorer).toBe(0);
  });

  it('4. guard ricochet: an opponent barrier reflects a direct shot', async () => {
    const { w, s } = await arena();
    w.debugPlaceManipulator(1, 13, 0);
    s.send(1, 'guard', 'tap', { at: [13, 0] });
    stepN(w, 1);
    w.debugPlaceBody(w.coreEntityId, 3.5, hover, 0);
    w.debugPlaceManipulator(0, 1.5, 0);
    s.send(0, 'pulse', 'tap', { at: [1.5, 0] });
    const o = play(w, 45);
    record('guard ricochet', o, `min vx ${o.minVx.toFixed(2)} m/s after barrier`);
    expect(o.impacts.some((i) => i.impulse > 100)).toBe(true);
    expect(o.minVx).toBeLessThan(-5);
    expect(o.goal?.scorer).not.toBe(0);
    w.dispose();
  });

  it('5. high shot: lift then pulse lobs the core over a barrier that stops the flat shot', async () => {
    const shoot = async (lifted: boolean) => {
      const { w, s } = await arena();
      w.debugPlaceManipulator(1, 11, 0);
      s.send(1, 'guard', 'tap', { at: [11, 0] });
      stepN(w, 1);
      w.debugPlaceBody(w.coreEntityId, 1.2, hover, 0);
      w.debugPlaceManipulator(0, 0, 0);
      if (lifted) s.send(0, 'lift', 'start', { at: [0, 0] });
      stepN(w, 30);
      s.send(0, 'pulse', 'tap', { at: [0, 0] });
      const o = play(w, 200);
      w.dispose();
      return o;
    };
    const flat = await shoot(false);
    const lob = await shoot(true);
    record('lob (control, flat)', flat, 'stopped by barrier');
    record('lob (lift -> pulse)', lob, `apex ${lob.maxHeight.toFixed(2)} m`);
    expect(lob.maxHeight).toBeGreaterThan(4);
    expect(lob.goal?.scorer).toBe(0);
    expect(flat.goal?.scorer).not.toBe(0);
  });

  it('6. endgame save: the defender pulses a goal-bound core back out', async () => {
    const shot = async (save: boolean) => {
      const { w, s } = await arena();
      w.debugPlaceManipulator(0, -18.2, 0.4);
      w.debugPlaceBody(w.coreEntityId, -9, hover, 0, -13, 0, 0);
      let saved = false;
      const o: ShotOutcome = {
        goal: null,
        launchSpeed: 13,
        maxHeight: hover,
        zAtGoalApproach: null,
        impacts: [],
        minVx: -13,
      };
      for (let i = 0; i < 120 && !o.goal; i++) {
        const c = core(w);
        if (save && !saved && Math.hypot(c.p[0] + 18.2, c.p[2] - 0.4) < 2.6) {
          s.send(0, 'pulse', 'tap', { at: [-18.2, 0.4] });
          saved = true;
        }
        const r = w.stepFixed();
        for (const e of r.events as GameEvent[])
          if (e.type === 'goal') o.goal = { scorer: e.scorer, tick: i };
      }
      o.minVx = core(w).v[0];
      w.dispose();
      return o;
    };
    const noSave = await shot(false);
    const withSave = await shot(true);
    record('save (control, no defender)', noSave, 'goal-bound shot');
    record('save (defender pulse)', withSave, `core vx after save ${withSave.minVx.toFixed(2)}`);
    expect(noSave.goal?.scorer).toBe(1);
    expect(withSave.goal).toBeNull();
  });
});
