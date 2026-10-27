/**
 * Hands Lab task judging (06M-M3): each task completes only on what the authority reports the
 * bodies did — a core set down still inside the ring, a goal still flying from a release, a goal
 * whose free flight bent, a boulder swept out of its lane without being gripped — timed on the
 * authority's clock from the first frame that shows the task's bodies in place.
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

/** A frame `ms` of authoritative time into the try (30 Hz ticks). */
function snap(entities: EntitySnapshot[], grasp = -1, ms = 0): WorldSnapshot {
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
    tick: Math.round((ms * 30) / 1000),
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
    const j = new TaskJudge(t);
    const r = t.ring!;
    const at = (p: [number, number, number], ms: number, grasp = -1) =>
      snap([body(CORE, 'core', p)], grasp, ms);
    j.update(at([-12, 1.15, -4], 0), []); // the try begins: the core is at its start
    j.update(at([-12, 1.15, -4], 100), [grip('start', CORE)]);
    // Carried into the ring, still gripped: not yet.
    expect(j.update(at([r.x, 2.2, r.z], 1000, CORE), [])).toBe(false);
    expect(j.update(at([r.x, 2.2, r.z], 1800, CORE), [])).toBe(false);
    // Let go; it settles inside.
    j.update(at([r.x, 1.2, r.z], 2000), [grip('end', CORE)]);
    expect(j.update(at([r.x, 1.15, r.z], 2300), [])).toBe(false);
    expect(j.update(at([r.x, 1.15, r.z], 2600), [])).toBe(true);
    expect(j.result()).toMatchObject({ id: 'place', attempts: 1, seconds: 2.6 });
  });

  it('place: rolling through the ring, or resting outside it, is not a placement', () => {
    const t = task('place');
    const j = new TaskJudge(t);
    const r = t.ring!;
    j.update(snap([body(CORE, 'core', [-12, 1.15, -4])]), []);
    for (let i = 1; i <= 20; i++)
      j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z], [3, 0, 0])], -1, i * 100), []);
    for (let i = 0; i < 20; i++)
      j.update(snap([body(CORE, 'core', [r.x + r.r + 0.5, 1.15, r.z])], -1, 3000 + i * 100), []);
    expect(j.done).toBe(false);
  });

  it('frames from before the task was set up are not judged, and do not start its clock', () => {
    const t = task('place');
    const r = t.ring!;
    const j = new TaskJudge(t);
    // The core still rests in the ring from an earlier try: nothing counts until it is moved.
    for (let ms = 0; ms <= 2000; ms += 100)
      expect(j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z])], -1, ms), [])).toBe(false);
    j.update(snap([body(CORE, 'core', [-12, 1.15, -4])], -1, 2100), []);
    expect(j.result().seconds).toBeNull();
    j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z])], -1, 5000), []);
    expect(j.update(snap([body(CORE, 'core', [r.x, 1.15, r.z])], -1, 5600), [])).toBe(true);
    expect(j.result().seconds).toBeCloseTo(3.5, 6);
  });

  it('throw: a goal still flying from the release counts — however long the flight', () => {
    const start = (j: TaskJudge) => j.update(snap([body(CORE, 'core', [-8, 1.15, 0])]), []);
    const flying = (ms: number, vx = 9) =>
      snap([body(CORE, 'core', [10, 1.2, 0], [vx, 0, 0])], -1, ms);
    const j = new TaskJudge(task('throw'));
    start(j);
    expect(j.update(flying(500), [goal()])).toBe(false); // never let go of: pushed in
    j.update(flying(1000), [grip('start', CORE)]);
    j.update(flying(2000), [grip('end', CORE, [9, 0, 0])]);
    expect(j.update(flying(4000, 6), [])).toBe(false);
    expect(j.update(flying(6500, 3), [goal()])).toBe(true); // a long flight still counts
    expect(j.result()).toMatchObject({ attempts: 1, seconds: 6.5 });

    // Set down gently, then nudged in: not a throw.
    const k = new TaskJudge(task('throw'));
    start(k);
    k.update(flying(100), [grip('start', CORE)]);
    k.update(flying(500, 0.5), [grip('end', CORE, [0.5, 0, 0])]);
    expect(k.update(flying(3000), [goal()])).toBe(false);

    // Thrown, came to rest, then pushed in: not a throw either.
    const r = new TaskJudge(task('throw'));
    start(r);
    r.update(flying(100), [grip('start', CORE)]);
    r.update(flying(500), [grip('end', CORE, [8, 0, 0])]);
    r.update(flying(4000, 0.2), []);
    expect(r.update(flying(6000), [goal()])).toBe(false);
  });

  it('curve: the goal counts only if the free flight bent; a bounce resets the measure', () => {
    const fly = (turnDeg: number, bounce: boolean) => {
      const j = new TaskJudge(task('curve'));
      j.update(snap([body(CORE, 'core', [-8, 1.15, 3])]), []);
      j.update(snap([body(CORE, 'core', [-8, 2, 3])], -1, 100), [grip('start', CORE)]);
      j.update(snap([body(CORE, 'core', [-2, 2, 3], [12, 0, 0])], -1, 500), [
        grip('end', CORE, [12, 0, 0]),
      ]);
      for (let i = 1; i <= 10; i++) {
        const a = ((turnDeg * Math.PI) / 180) * (i / 10);
        const v: [number, number, number] = [12 * Math.cos(a), 0, 12 * Math.sin(a)];
        const ev: GameEvent[] =
          bounce && i === 9
            ? [{ type: 'impact', id: 0, tick: 0, a: CORE, b: -1, p: [0, 0, 0], impulse: 40 }]
            : [];
        j.update(snap([body(CORE, 'core', [i, 1.2, 3], v)], -1, 500 + i * 100), ev);
      }
      return j.update(snap([body(CORE, 'core', [21, 1.2, 0], [10, 0, 0])], -1, 1700), [goal()]);
    };
    expect(fly(20, false)).toBe(true);
    expect(fly(5, false)).toBe(false);
    expect(fly(20, true)).toBe(true); // bent before the bounce
    expect(fly(0, true)).toBe(false);
  });

  it('clear: the boulder must leave the lane and come to rest — never by being gripped', () => {
    const t = task('clear');
    const lane = t.lane!;
    const at = (x: number, z: number, ms: number, vz = 0) =>
      snap(
        [
          body(CORE, 'core', [-15, 1.15, 9]),
          body(BOULDER + 1, 'boulder', [0, 0.75, 8.2]), // the other boulder: never judged
          body(BOULDER, 'boulder', [x, 0.75, z], [0, 0, vz]),
        ],
        -1,
        ms,
      );
    const j = new TaskJudge(t);
    j.update(at(lane.boulder[0], lane.boulder[1], 0), []);
    j.update(at(lane.boulder[0], 1.5, 400, 4), []); // swept: moving
    expect(j.update(at(lane.boulder[0], lane.halfWidth + 1.5, 800, 3), [])).toBe(false);
    expect(j.update(at(lane.boulder[0], lane.halfWidth + 2, 1500), [])).toBe(true);
    expect(j.result().attempts).toBe(1);

    const g = new TaskJudge(t);
    g.update(at(lane.boulder[0], lane.boulder[1], 0), []);
    g.update(at(lane.boulder[0], lane.boulder[1], 100), [grip('start', BOULDER)]);
    g.update(at(lane.boulder[0], lane.halfWidth + 2, 1000), [grip('end', BOULDER)]);
    expect(g.update(at(lane.boulder[0], lane.halfWidth + 2, 2000), [])).toBe(false);
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
