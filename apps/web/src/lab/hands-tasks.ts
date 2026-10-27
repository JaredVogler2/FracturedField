/**
 * Hands Lab tasks (ADR-0009, milestone 06M-M3): four small physical challenges that show whether a
 * first-time player can manipulate objects with their hands. Each is judged only from the
 * authority's snapshots and events — what actually happened to the bodies — never from the
 * player's own input, so a camera, a mouse and a touch screen are measured the same way.
 *
 * - **place** — set the core down inside a ring (grip, carry, a gentle release);
 * - **throw** — throw the core into the rival gate (swing and let go: it scores still flying from
 *   the release);
 * - **curve** — throw it so its path bends in flight (twist while holding);
 * - **clear** — sweep a boulder out of a lane with an open hand (no grip on it).
 *
 * Pure: frames are passed in, and time is the authority's own (snapshot ticks), so a slow or
 * stalling page measures the same as a fast one.
 */
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import type { EntityId, EntitySnapshot, GameEvent, WorldSnapshot } from '@ff/protocol';

export type HandsTaskId = 'place' | 'throw' | 'curve' | 'clear';

export interface HandsTask {
  readonly id: HandsTaskId;
  readonly title: string;
  /** The goal as shown to the player (what, never how). */
  readonly goal: string;
  /** Where the core starts (world x, z). */
  readonly core: readonly [number, number];
  /** The ring to set the core down in (place). */
  readonly ring?: { readonly x: number; readonly z: number; readonly r: number };
  /** The boulder to clear and the lane it must leave (|z| ≤ halfWidth around z = 0, x range). */
  readonly lane?: {
    readonly boulder: readonly [number, number];
    readonly x0: number;
    readonly x1: number;
    readonly halfWidth: number;
  };
  /** Time limit (s) for the study protocol (PHASE-06M); the lab itself never stops a try. */
  readonly limitSeconds: number;
}

const HOVER = DEFAULT_RULES.core.hoverHeight;

export const HANDS_TASKS: readonly HandsTask[] = [
  {
    id: 'place',
    title: 'Place',
    goal: 'Set the core down inside the ring.',
    core: [-12, -4],
    ring: { x: -6, z: 4, r: 1.6 },
    limitSeconds: 120,
  },
  {
    id: 'throw',
    title: 'Throw',
    goal: 'Throw the core into the far gate.',
    core: [-8, 0],
    limitSeconds: 120,
  },
  {
    id: 'curve',
    title: 'Curve',
    goal: 'Throw the core so its path bends on the way.',
    core: [-8, 3],
    limitSeconds: 120,
  },
  {
    id: 'clear',
    title: 'Clear',
    goal: 'Sweep the boulder out of the lane with an open hand.',
    core: [-15, 9],
    lane: { boulder: [-6, 0], x0: -10, x1: -2, halfWidth: 2.2 },
    limitSeconds: 120,
  },
];

export interface TaskResult {
  readonly id: HandsTaskId;
  /** Tries: grips of the core (place, throw, curve) or pushes of the boulder (clear). */
  readonly attempts: number;
  /** Seconds from the start to the first success; null while not done. */
  readonly seconds: number | null;
  /** Seconds the camera lost the hand during the task (tracking quality, reported separately). */
  readonly lostSeconds: number;
}

/** Heading change (degrees) in free flight that counts as a bent path. */
export const CURVE_DEGREES = 12;
/** Letting go of the core at this speed (m/s) or more throws it; slower is setting it down. */
export const THROW_SPEED = 3;
/** A thrown core that slows below this (m/s) has stopped flying: a later goal is not the throw. */
const REST_SPEED = 1;

/** How close (m) a task's body must be to its start for the try to begin. */
const IN_PLACE = 0.6;

/**
 * Judges one task from authoritative frames. `update` returns true on the first frame the task is
 * complete; later frames change nothing. A try begins — and its clock starts — on the first frame
 * that shows the task's bodies where it starts (frames from before the setup are ignored).
 */
export class TaskJudge {
  private attempts = 0;
  private startedAt: number | null = null;
  private doneAt: number | null = null;
  private placedSince: number | null = null;
  /** The core is flying from a throw: let go fast, not gripped or come to rest since. */
  private flying = false;
  /** Free-flight heading after the last release (radians), and the largest turn since. */
  private flightHeading: number | null = null;
  private flightTurn = 0;
  private boulderId: EntityId = -1;
  private boulderMoving = false;
  /** The boulder was gripped at some point: this try is not an open-hand sweep. */
  private assisted = false;
  private gripped: EntityId = -1;
  private lostMs = 0;

  constructor(
    readonly task: HandsTask,
    private readonly slot: 0 | 1 = 0,
    private readonly tickRate: number = DEFAULT_RULES.match.tickRate,
  ) {}

  get done(): boolean {
    return this.doneAt !== null;
  }

  result(): TaskResult {
    return {
      id: this.task.id,
      attempts: this.attempts,
      seconds:
        this.doneAt === null || this.startedAt === null
          ? null
          : (this.doneAt - this.startedAt) / 1000,
      lostSeconds: this.lostMs / 1000,
    };
  }

  /** Time (ms) the camera reported the hand lost since the last call. */
  addLost(ms: number): void {
    if (!this.done && this.startedAt !== null) this.lostMs += Math.max(0, ms);
  }

  update(s: WorldSnapshot, events: readonly GameEvent[]): boolean {
    if (this.done) return false;
    const now = (s.tick * 1000) / this.tickRate;
    const core = s.entities.find((e) => e.kind === 'core');
    if (!core) return false;
    if (this.startedAt === null) {
      if (this.inPlace(s, core)) this.startedAt = now;
      return false;
    }
    for (const e of events) {
      if (e.type === 'grip' && e.slot === this.slot) {
        if (e.phase === 'start') {
          this.gripped = e.entity;
          if (e.entity === core.id) {
            this.attempts += this.task.id === 'clear' ? 0 : 1;
            this.flying = false;
          }
        } else {
          if (e.entity === core.id) {
            const speed = Math.hypot(e.v[0], e.v[1], e.v[2]);
            this.flying = speed >= THROW_SPEED;
            this.flightHeading = Math.hypot(e.v[0], e.v[2]) > 2 ? Math.atan2(e.v[2], e.v[0]) : null;
            this.flightTurn = 0;
          }
          this.gripped = -1;
        }
      }
      if (e.type === 'impact' && (e.a === core.id || e.b === core.id)) this.flightHeading = null;
      if (e.type === 'goal' && e.scorer === this.slot && this.flying) {
        if (this.task.id === 'throw') return this.finish(now);
        if (this.task.id === 'curve' && this.flightTurn >= (CURVE_DEGREES * Math.PI) / 180)
          return this.finish(now);
      }
    }
    if (this.flying && Math.hypot(core.v[0], core.v[1], core.v[2]) < REST_SPEED)
      this.flying = false;
    switch (this.task.id) {
      case 'place':
        return this.judgePlace(core, s, now);
      case 'throw':
      case 'curve':
        this.trackFlight(core);
        return false;
      case 'clear':
        return this.judgeClear(s, now);
    }
  }

  private trackFlight(core: WorldSnapshot['entities'][number]): void {
    if (this.flightHeading === null) return;
    const speed = Math.hypot(core.v[0], core.v[2]);
    if (speed < 2) {
      this.flightHeading = null;
      return;
    }
    const h = Math.atan2(core.v[2], core.v[0]);
    let d = h - this.flightHeading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.flightTurn = Math.max(this.flightTurn, Math.abs(d));
  }

  private judgePlace(
    core: WorldSnapshot['entities'][number],
    s: WorldSnapshot,
    now: number,
  ): boolean {
    const ring = this.task.ring!;
    const inside = Math.hypot(core.p[0] - ring.x, core.p[2] - ring.z) <= ring.r;
    const still = Math.hypot(core.v[0], core.v[1], core.v[2]) < 0.6;
    const down = core.p[1] <= HOVER + 0.35;
    const free = s.players[this.slot].grasp !== core.id;
    if (inside && still && down && free) {
      this.placedSince ??= now;
      if (now - this.placedSince >= 500) return this.finish(now);
    } else this.placedSince = null;
    return false;
  }

  /** The task's bodies are where it starts (the clear task's boulder is identified here). */
  private inPlace(s: WorldSnapshot, core: EntitySnapshot): boolean {
    const near = (e: EntitySnapshot, [x, z]: readonly [number, number]) =>
      Math.hypot(e.p[0] - x, e.p[2] - z) < IN_PLACE;
    if (!near(core, this.task.core)) return false;
    const lane = this.task.lane;
    if (!lane) return true;
    const b = s.entities.find((e) => e.kind === 'boulder' && near(e, lane.boulder));
    if (!b) return false;
    this.boulderId = b.id;
    return true;
  }

  private judgeClear(s: WorldSnapshot, now: number): boolean {
    const lane = this.task.lane!;
    const b = s.entities.find((e) => e.id === this.boulderId);
    if (!b) return false;
    const moving = Math.hypot(b.v[0], b.v[2]) > 1;
    if (moving && !this.boulderMoving) this.attempts++;
    this.boulderMoving = moving;
    // Gripping the boulder is not sweeping it (restart the task for a clean try).
    if (this.gripped === b.id) this.assisted = true;
    if (this.assisted) return false;
    const out =
      Math.abs(b.p[2]) > lane.halfWidth + 0.8 || b.p[0] < lane.x0 - 0.8 || b.p[0] > lane.x1 + 0.8;
    return out && !moving ? this.finish(now) : false;
  }

  private finish(now: number): boolean {
    this.doneAt = now;
    return true;
  }
}

/** Every lab body position must be on the player's own side and clear of the arena walls. */
export function insideOwnHalf(x: number, z: number): boolean {
  const m = DEFAULT_RULES.manipulator;
  return (
    x <= m.midlineReach &&
    x >= -MERIDIAN_ARENA.halfLength + m.wallMargin &&
    Math.abs(z) <= MERIDIAN_ARENA.halfWidth - m.wallMargin
  );
}
