/**
 * Hands Lab task judging (06M-M3): each task completes only on what the authority reports the
 * bodies did — a core set down still inside the ring, a goal right after a release, a goal whose
 * free flight bent, a boulder swept out of its lane without being gripped.
 */
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, GameEvent, WorldSnapshot } from '@ff/protocol';
import { HANDS_TASKS, TaskJudge, type HandsTaskId } from './hands-tasks';

const CORE = 1;
const BOULDER = 2;
const task = (id: HandsTaskId) => HANDS_TASKS.find((t) => t.id === id)!;

function body(
  id: number,
  kind: EntitySnapshot['kind'],
  p: [number, number, number],
  v: [number, number, number] = [0, 0, 0],
): EntitySnapshot {
  return { id, kind, owner: -1, p, q: [0, 0, 0, 1], v, ttl: -1 };
}

function snap(entities: EntitySnapshot[], grasp = -1): WorldSnapshot {
  const player = (slot: 0 | 1) => ({
    slot,
    m: [0, 0] as const,
    energy: 100,
    cd: {},
    hold: null,
    holdTarget: -1,
    grasp: slot === 0 ? grasp : -1,
    connected: true,
  });
  return {
    tick: 0,
    entities,
    players: [player(0), player(1)],
    effects: [],
    match: {
      phase: 'playing',
      round: 1,
      score: [0, 0],
      roundWins: [0, 0],
      clockTicks: 1000,
      golden: false,
      paused: false,
      kickoffShield: 0,
    },
    ack: [0, 0],
    eventCursor: 0,
  } as unknown as WorldSnapshot;
}

let nextEvent = 1;
const grip = (phase: 'start' | 'end', entity: number, v: [number, number, number] = [0, 0, 0]) =>
  ({
    type: 'grip',
    id: nextEvent++,
    tick: 0,
    slot: 0,
    phase,
    entity,
    p: [0, 0, 0],
    v,
  }) as GameEvent;
const goal = () =>
  ({ type: 'goal', id: nextEvent++, tick: 0, scorer: 0, p: [21, 1, 0], speed: 12 }) as GameEvent;

describe('Hands Lab tasks', () => {
  it('place: done when the core rests, ungripped, inside the ring for half a second', () => {
    const t = task('place');
    const j = new TaskJudge(t, 0);
    const r = t.ring!;
    j.update(snap([body(CORE, 'core', [-12, 1.15, -4])]), [grip('start', CORE)], 100);
    // Carried into the ring, still gripped: not yet.
    expect(j.update(snap([body(CORE, 'core', [r.x, 2.2, r.z])], CORE), [], 1000)).toBe(false);
    expect(j.update(snap([body(CORE, 'core', [r.x, 2.2, r.z])], CORE), [], 1800)).toBe(false);
    // Let go; it settles inside.
    j.update(snap([body(CORE, 'core', [r.x, 1.2, r.z])]), [grip('end', CORE)], 2000);
    expect(j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z])]), [], 2300)).toBe(false);
    expect(j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z])]), [], 2600)).toBe(true);
    expect(j.result()).toMatchObject({ id: 'place', attempts: 1, seconds: 2.6 });
  });

  it('place: rolling through the ring, or resting outside it, is not a placement', () => {
    const t = task('place');
    const j = new TaskJudge(t, 0);
    const r = t.ring!;
    for (let i = 0; i < 20; i++)
      j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z], [3, 0, 0])]), [], i * 100);
    for (let i = 0; i < 20; i++)
      j.update(snap([body(CORE, 'core', [r.x + r.r + 0.5, 1.15, r.z])]), [], 3000 + i * 100);
    expect(j.done).toBe(false);
  });

  it('throw: a goal within 3 s of letting go counts; a goal from a push alone does not', () => {
    const j = new TaskJudge(task('throw'), 0);
    const s = snap([body(CORE, 'core', [10, 1.2, 0], [12, 0, 0])]);
    expect(j.update(s, [goal()], 500)).toBe(false); // never released: pushed in
    j.update(s, [grip('start', CORE)], 1000);
    j.update(s, [grip('end', CORE, [12, 0, 0])], 2000);
    expect(j.update(s, [goal()], 4500)).toBe(true);
    expect(j.result()).toMatchObject({ attempts: 1, seconds: 4.5 });
  });

  it('curve: the goal counts only if the free flight bent; a bounce resets the measure', () => {
    const fly = (turnDeg: number, bounce: boolean) => {
      const j = new TaskJudge(task('curve'), 0);
      j.update(snap([body(CORE, 'core', [-8, 2, 3])]), [grip('start', CORE)], 0);
      j.update(
        snap([body(CORE, 'core', [-2, 2, 3], [12, 0, 0])]),
        [grip('end', CORE, [12, 0, 0])],
        500,
      );
      for (let i = 1; i <= 10; i++) {
        const a = ((turnDeg * Math.PI) / 180) * (i / 10);
        const v: [number, number, number] = [12 * Math.cos(a), 0, 12 * Math.sin(a)];
        const ev: GameEvent[] =
          bounce && i === 9
            ? [{ type: 'impact', id: 0, tick: 0, a: CORE, b: -1, p: [0, 0, 0], impulse: 40 }]
            : [];
        j.update(snap([body(CORE, 'core', [i, 1.2, 3], v)]), ev, 500 + i * 100);
      }
      return j.update(snap([body(CORE, 'core', [21, 1.2, 0])]), [goal()], 1700);
    };
    expect(fly(20, false)).toBe(true);
    expect(fly(5, false)).toBe(false);
    expect(fly(20, true)).toBe(true); // bent before the bounce
    expect(fly(0, true)).toBe(false);
  });

  it('clear: the boulder must leave the lane and come to rest — never by being gripped', () => {
    const t = task('clear');
    const lane = t.lane!;
    const at = (x: number, z: number, vz = 0) =>
      snap([
        body(CORE, 'core', [-15, 1.15, 9]),
        body(BOULDER, 'boulder', [x, 0.75, z], [0, 0, vz]),
      ]);
    const j = new TaskJudge(t, 0);
    j.update(at(lane.boulder[0], lane.boulder[1]), [], 0);
    j.update(at(lane.boulder[0], 1.5, 4), [], 400); // swept: moving
    expect(j.update(at(lane.boulder[0], lane.halfWidth + 1.5, 3), [], 800)).toBe(false);
    expect(j.update(at(lane.boulder[0], lane.halfWidth + 2), [], 1500)).toBe(true);
    expect(j.result().attempts).toBe(1);

    const g = new TaskJudge(t, 0);
    g.update(at(lane.boulder[0], lane.boulder[1]), [grip('start', BOULDER)], 0);
    g.update(at(lane.boulder[0], lane.halfWidth + 2), [grip('end', BOULDER)], 1000);
    expect(g.update(at(lane.boulder[0], lane.halfWidth + 2), [], 2000)).toBe(false);
  });

  it('every task starts its bodies on the player’s own side', async () => {
    const { insideOwnHalf } = await import('./hands-tasks');
    for (const t of HANDS_TASKS) {
      expect(insideOwnHalf(...t.core), t.id).toBe(true);
      if (t.ring) expect(insideOwnHalf(t.ring.x, t.ring.z), t.id).toBe(true);
      if (t.lane) expect(insideOwnHalf(...t.lane.boulder), t.id).toBe(true);
    }
  });
});
