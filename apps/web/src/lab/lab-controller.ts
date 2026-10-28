import type { EntityId, GameEvent, HandState, PlayerSlot, WorldSnapshot } from '@ff/protocol';
import {
  REACTION_FIXTURES,
  ScenarioRun,
  type ScenarioExpectation,
  type ScenarioFixture,
  type ScenarioMark,
  type ScenarioOutcome,
  type VariantName,
} from '@ff/sim/scenario';
import type { GameClient } from '../game/client';

/** Ticks between rewind marks (each mark is a full world checkpoint). */
const MARK_EVERY = 15;
const LOG_LIMIT = 160;
const TICK_MS = 1000 / 30;

export interface LabLogEntry {
  readonly t: number;
  readonly id: number;
  readonly text: string;
  readonly kind: GameEvent['type'];
}

export interface ExpectationCheck {
  readonly label: string;
  /** null = not decided yet (run still in progress). */
  readonly pass: boolean | null;
}

export interface LabState {
  readonly fixture: ScenarioFixture;
  readonly variant: VariantName;
  readonly t: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly loading: boolean;
  readonly done: boolean;
  /** Tick of the first manual material change on this timeline (null = pristine fixture). */
  readonly modifiedAt: number | null;
  readonly outcome: ScenarioOutcome;
  readonly log: readonly LabLogEntry[];
  readonly checks: readonly ExpectationCheck[];
  /** The authoritative state currently shown. */
  readonly snapshot: WorldSnapshot | null;
  readonly energy: readonly [number, number];
}

export const LAB_FIXTURES = REACTION_FIXTURES;

function describeEvent(e: GameEvent): string | null {
  switch (e.type) {
    case 'reaction':
      return `${e.kind.toUpperCase()} · mag ${e.mag.toFixed(2)}${e.entity >= 0 ? ` · body ${e.entity}` : ''}`;
    case 'cast':
      return `P${e.slot + 1} cast ${e.ability}${e.phase !== 'tap' ? ` (${e.phase})` : ''}`;
    case 'charge':
      return `P${e.slot + 1} discharge · ${e.nodes.length} node${e.nodes.length === 1 ? '' : 's'}`;
    case 'impact':
      return e.impulse >= 40 ? `impact ${e.impulse.toFixed(0)} N·s` : null;
    case 'goal':
      return `GOAL · P${e.scorer + 1}`;
    case 'spawn':
      return `spawn ${e.kind} ${e.entity}`;
    case 'despawn':
      return `despawn ${e.entity} (${e.reason})`;
    default:
      return null;
  }
}

/** Compares a (possibly unfinished) outcome with the fixture's expectation. */
export function checkExpectation(
  e: ScenarioExpectation,
  o: ScenarioOutcome,
  done: boolean,
): ExpectationCheck[] {
  const out: ExpectationCheck[] = [];
  const decided = (ok: boolean): boolean | null => (ok ? true : done ? false : null);
  if (e.goal !== undefined) {
    const label = e.goal === null ? 'no goal' : `P${e.goal + 1} scores`;
    if (e.goal === null) out.push({ label, pass: o.goal !== null ? false : done ? true : null });
    else
      out.push({
        label,
        pass: o.goal === e.goal ? true : o.goal !== null ? false : decided(false),
      });
  }
  if (e.notGoal !== undefined)
    out.push({
      label: `P${e.notGoal + 1} must not score`,
      pass: o.goal === e.notGoal ? false : done ? true : null,
    });
  for (const [kind, n] of Object.entries(e.reactions ?? {})) {
    const got = o.reactions[kind] ?? 0;
    out.push({
      label: `${kind} ×${n}`,
      pass: got > n ? false : got === n ? (done ? true : n === 0 ? null : true) : decided(false),
    });
  }
  const h = e.maxCoreHeight;
  if (h?.atLeast !== undefined)
    out.push({ label: `core peak ≥ ${h.atLeast} m`, pass: decided(o.maxCoreHeight >= h.atLeast) });
  if (h?.atMost !== undefined)
    out.push({
      label: `core peak ≤ ${h.atMost} m`,
      pass: o.maxCoreHeight > h.atMost ? false : done ? true : null,
    });
  if (e.coreVeiled !== undefined)
    out.push({
      label: e.coreVeiled ? 'core veiled by steam' : 'core never veiled',
      pass: e.coreVeiled ? decided(o.coreVeiled) : o.coreVeiled ? false : done ? true : null,
    });
  return out;
}

/**
 * Drives one fixture variant for the Physics Lab: play / pause / single-step / rewind and seek
 * (checkpoint marks + deterministic replay) and manual material toggles. The world runs on this
 * thread (development tool); every published tick is shown exactly as simulated (no
 * interpolation), so what you see at tick t is the authoritative state at tick t.
 */
export class LabController {
  private run: ScenarioRun | null = null;
  private marks: ScenarioMark[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private acc = 0;
  private last = 0;
  private gen = 0;
  private busy = false;
  private readonly listeners = new Set<() => void>();
  private log: LabLogEntry[] = [];
  private shown: WorldSnapshot | null = null;
  state: LabState;

  constructor(private readonly client: GameClient) {
    const fixture = LAB_FIXTURES[0]!;
    this.state = {
      fixture,
      variant: 'reaction',
      t: 0,
      playing: false,
      speed: 1,
      loading: true,
      done: false,
      modifiedAt: null,
      outcome: { goal: null, goalTick: null, reactions: {}, maxCoreHeight: 0, coreVeiled: false },
      log: [],
      checks: [],
      snapshot: null,
      energy: [0, 0],
    };
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): LabState => this.state;

  private set(patch: Partial<LabState>): void {
    const next = { ...this.state, ...patch };
    const run = this.run;
    if (run) {
      next.t = run.t;
      next.done = run.done;
      next.outcome = { ...run.outcome, reactions: { ...run.outcome.reactions } };
      next.checks = checkExpectation(
        next.fixture.variants[next.variant].expect,
        next.outcome,
        next.done,
      );
      next.energy = [run.world.debugPlayer(0).energy, run.world.debugPlayer(1).energy];
    }
    next.snapshot = this.shown;
    next.log = this.log;
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  get world() {
    return this.run?.world ?? null;
  }

  async load(fixture: ScenarioFixture, variant: VariantName): Promise<void> {
    const gen = ++this.gen;
    this.stopTimer();
    this.set({ fixture, variant, loading: true, playing: false, modifiedAt: null });
    const run = await ScenarioRun.create(fixture, variant);
    if (gen !== this.gen) {
      run.dispose();
      return;
    }
    this.run?.dispose();
    this.run = run;
    this.marks = [run.mark()];
    this.log = [];
    this.publish(run.world.snapshot(), [], true);
    this.set({ loading: false });
  }

  private publish(snapshot: WorldSnapshot, events: readonly GameEvent[], reset: boolean): void {
    const now = performance.now();
    this.shown = snapshot;
    // Exact-tick display: every published state replaces the interpolation history.
    this.client.onResync(snapshot, reset ? 'join' : 'rematch', now);
    if (events.length > 0) this.client.onEvents(events);
  }

  private forward(silent: boolean): void {
    const run = this.run;
    if (!run || run.done) return;
    const t = run.t;
    const { result, snapshot } = run.step();
    if (run.t % MARK_EVERY === 0 && !this.marks.some((m) => m.t === run.t))
      this.marks.push(run.mark());
    if (silent) return;
    for (const e of result.events) {
      const text = describeEvent(e);
      if (text) this.log.push({ t, id: e.id, text, kind: e.type });
    }
    if (this.log.length > LOG_LIMIT) this.log = this.log.slice(-LOG_LIMIT);
    this.publish(snapshot, result.events, false);
  }

  stepOnce(): void {
    if (this.busy) return;
    this.pause();
    this.forward(false);
    this.set({});
  }

  play(): void {
    if (!this.run || this.state.playing) return;
    if (this.run.done) return;
    this.last = performance.now();
    this.acc = 0;
    this.timer = setInterval(() => this.pump(), 4);
    this.set({ playing: true });
  }

  pause(): void {
    if (!this.state.playing) return;
    this.stopTimer();
    this.set({ playing: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.set({ speed });
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    const run = this.run;
    if (!run || this.busy) return;
    const now = performance.now();
    this.acc += Math.min(250, now - this.last) * this.state.speed;
    this.last = now;
    let stepped = false;
    while (this.acc >= TICK_MS && !run.done) {
      this.acc -= TICK_MS;
      this.forward(false);
      stepped = true;
    }
    if (run.done) {
      this.stopTimer();
      this.set({ playing: false });
    } else if (stepped) this.set({});
  }

  /** Jumps to tick `t`: restore the nearest earlier mark, then replay deterministically. */
  async seek(t: number): Promise<void> {
    const run = this.run;
    if (!run || this.busy) return;
    const target = Math.max(0, Math.min(t, run.fixture.ticks));
    this.busy = true;
    try {
      if (target < run.t || target - run.t > MARK_EVERY * 2) {
        const mark = [...this.marks].reverse().find((m) => m.t <= target);
        if (mark && (target < run.t || mark.t > run.t)) await run.rewind(mark);
      }
      while (run.t < target && !run.done) this.forward(true);
      this.log = this.log.filter((l) => l.t < run.t);
      const modifiedAt = this.state.modifiedAt;
      this.publish(run.world.snapshot(), [], true);
      this.set({ modifiedAt: modifiedAt !== null && run.t < modifiedAt ? null : modifiedAt });
    } finally {
      this.busy = false;
    }
  }

  async restart(): Promise<void> {
    this.pause();
    await this.seek(0);
  }

  /** Manual material change at the current tick (Lab only; invalidates later marks). */
  setMaterial(
    id: EntityId,
    patch: { readonly wet?: number; readonly temp?: number; readonly shocked?: boolean },
  ): void {
    const run = this.run;
    if (!run || this.busy) return;
    if (!run.world.debugSetBodyElement(id, patch)) return;
    this.marks = this.marks.filter((m) => m.t < run.t);
    this.marks.push(run.mark());
    this.publish(run.world.snapshot(), [], true);
    this.set({ modifiedAt: this.state.modifiedAt ?? run.t });
  }

  /** The core's deliberate spin at the current tick (Lab captures; invalidates later marks). */
  setCoreSpin(spin: number): void {
    const run = this.run;
    if (!run || this.busy) return;
    run.world.debugSetCoreSpin(spin);
    this.marks = this.marks.filter((m) => m.t < run.t);
    this.marks.push(run.mark());
    this.publish(run.world.snapshot(), [], true);
    this.set({ modifiedAt: this.state.modifiedAt ?? run.t });
  }

  /**
   * A hand seat `slot` describes from the next tick on, as a camera would, or none (Lab captures
   * of the spectral hands; invalidates later marks).
   */
  setHand(slot: PlayerSlot, hand: HandState | null): void {
    const run = this.run;
    if (!run || this.busy) return;
    run.setHand(slot, hand);
    this.marks = this.marks.filter((m) => m.t <= run.t);
    this.set({ modifiedAt: this.state.modifiedAt ?? run.t });
  }

  dispose(): void {
    this.gen++;
    this.stopTimer();
    this.run?.dispose();
    this.run = null;
    this.listeners.clear();
  }
}
