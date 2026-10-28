/**
 * D04 scenario fixtures and a tick-steppable runner, shared by the regression tests and the
 * development Physics Lab (`/lab`). A fixture stages a seeded world (bodies, initial water
 * patches), scripts per-tick intents and placements, and states the expected outcome of a
 * control/reaction pair that differ only in the reaction's cause.
 *
 * Staging uses the world's debug hooks (placement, pools); every scripted action is an ordinary
 * ActionIntent through applyCommand, so costs, cooldowns and validation apply exactly as in play.
 */
import type { AbilityId, ArenaLayout } from '@ff/game-data';
import type {
  ActionIntent,
  HandState,
  IntentAction,
  IntentPhase,
  PlayerSlot,
  WorldSnapshot,
} from '@ff/protocol';
import { GameWorld, type StepResult, type WorldCheckpoint, type WorldOptions } from './game.js';

export type ScenarioVec3 = readonly [number, number, number];

/** Teleports an entity (`core`, or `kind:index` in ascending id order) — staging only. */
export interface ScenarioPlacement {
  readonly t: number;
  readonly place: string;
  readonly p: ScenarioVec3;
  readonly v?: ScenarioVec3;
}

/** Moves the seat's force point to `at` and sends one intent from there. */
export interface ScenarioAction {
  readonly t: number;
  readonly slot: PlayerSlot;
  readonly act: IntentAction;
  readonly phase?: IntentPhase;
  readonly at: readonly [number, number];
  readonly modifier?: number;
  readonly dir?: readonly [number, number];
}

export type ScenarioStep = ScenarioPlacement | ScenarioAction;

export interface ScenarioExpectation {
  /** Exact first scorer (null = no goal within the run). */
  readonly goal?: PlayerSlot | null;
  /** This slot must NOT score. */
  readonly notGoal?: PlayerSlot;
  /** Exact counts of reaction kinds over the run. */
  readonly reactions?: Readonly<Record<string, number>>;
  readonly maxCoreHeight?: { readonly atLeast?: number; readonly atMost?: number };
  readonly coreVeiled?: boolean;
}

export interface ScenarioPool {
  readonly owner: PlayerSlot;
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly depth: number;
  readonly temp?: number;
}

export interface ScenarioVariant {
  readonly pools?: readonly ScenarioPool[];
  readonly script?: readonly ScenarioStep[];
  readonly expect: ScenarioExpectation;
}

export type VariantName = 'control' | 'reaction';

export interface ScenarioFixture {
  readonly id: string;
  readonly title: string;
  readonly seed: number;
  readonly ticks: number;
  readonly loadouts?: readonly [readonly AbilityId[], readonly AbilityId[]];
  readonly script: readonly ScenarioStep[];
  readonly variants: Readonly<Record<VariantName, ScenarioVariant>>;
}

export interface ScenarioOutcome {
  goal: PlayerSlot | null;
  goalTick: number | null;
  reactions: Record<string, number>;
  maxCoreHeight: number;
  coreVeiled: boolean;
}

/** Restorable point in a run (Lab rewind). */
export interface ScenarioMark {
  readonly t: number;
  readonly world: WorldCheckpoint;
  readonly outcome: ScenarioOutcome;
}

export interface ScenarioTick {
  readonly result: StepResult;
  readonly snapshot: WorldSnapshot;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isVec(v: unknown, n: number): boolean {
  return Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x));
}

function checkStep(s: unknown, where: string): ScenarioStep {
  if (!isObject(s) || !Number.isInteger(s.t) || (s.t as number) < 0)
    throw new Error(`${where}: step needs a tick t`);
  if ('place' in s) {
    if (typeof s.place !== 'string' || !isVec(s.p, 3) || (s.v !== undefined && !isVec(s.v, 3)))
      throw new Error(`${where}: bad placement`);
  } else if (
    (s.slot !== 0 && s.slot !== 1) ||
    typeof s.act !== 'string' ||
    !isVec(s.at, 2) ||
    (s.dir !== undefined && !isVec(s.dir, 2))
  ) {
    throw new Error(`${where}: bad action`);
  }
  return s as unknown as ScenarioStep;
}

/**
 * Structural validation of an untrusted fixture document (JSON files are data; a malformed one
 * fails loudly instead of producing a misleading run).
 */
export function parseScenarioFixture(raw: unknown): ScenarioFixture {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string')
    throw new Error('fixture needs id and title');
  const id = raw.id;
  if (!Number.isInteger(raw.seed) || !Number.isInteger(raw.ticks) || (raw.ticks as number) <= 0)
    throw new Error(`${id}: seed and ticks must be integers`);
  if (!Array.isArray(raw.script)) throw new Error(`${id}: script must be an array`);
  raw.script.forEach((s, i) => checkStep(s, `${id} script[${i}]`));
  if (!isObject(raw.variants)) throw new Error(`${id}: variants missing`);
  for (const name of ['control', 'reaction'] as const) {
    const v = raw.variants[name];
    if (!isObject(v) || !isObject(v.expect)) throw new Error(`${id}: ${name} needs expect`);
    if (v.script !== undefined) {
      if (!Array.isArray(v.script)) throw new Error(`${id}: ${name}.script must be an array`);
      v.script.forEach((s, i) => checkStep(s, `${id} ${name}.script[${i}]`));
    }
    if (v.pools !== undefined && !Array.isArray(v.pools))
      throw new Error(`${id}: ${name}.pools must be an array`);
  }
  return raw as unknown as ScenarioFixture;
}

function toAim(arena: ArenaLayout, x: number, z: number): [number, number] {
  return [
    Math.max(-1, Math.min(1, x / arena.halfLength)),
    Math.max(-1, Math.min(1, z / arena.halfWidth)),
  ];
}

function emptyOutcome(): ScenarioOutcome {
  return { goal: null, goalTick: null, reactions: {}, maxCoreHeight: 0, coreVeiled: false };
}

function copyOutcome(o: ScenarioOutcome): ScenarioOutcome {
  return { ...o, reactions: { ...o.reactions } };
}

/** One variant of a fixture, advanced a tick at a time. */
export class ScenarioRun {
  /** Scenario tick (0 = first scripted tick after the kickoff countdown). */
  t = 0;
  outcome: ScenarioOutcome = emptyOutcome();
  private readonly steps: readonly ScenarioStep[];
  private seq: [number, number] = [0, 0];
  /** A hand each seat holds on every tick from now (Physics Lab captures), or none. */
  private hands: [HandState | null, HandState | null] = [null, null];

  private constructor(
    readonly fixture: ScenarioFixture,
    readonly variant: VariantName,
    private current: GameWorld,
    private readonly options: WorldOptions,
  ) {
    const v = fixture.variants[variant];
    this.steps = [...fixture.script, ...(v.script ?? [])].sort((a, b) => a.t - b.t);
  }

  static async create(fixture: ScenarioFixture, variant: VariantName): Promise<ScenarioRun> {
    const options: WorldOptions = {
      seed: fixture.seed,
      autoStart: true,
      ...(fixture.loadouts ? { loadouts: fixture.loadouts } : {}),
    };
    const w = await GameWorld.create(options);
    // Play through the kickoff countdown, then lift the post-kickoff shield.
    for (let i = 0; i < 400 && w.phase !== 'playing'; i++) w.stepFixed();
    w.debugClearKickoffShield();
    for (const p of fixture.variants[variant].pools ?? [])
      w.debugAddPool(p.owner, p.x, p.z, p.r, p.depth, p.temp);
    return new ScenarioRun(fixture, variant, w, options);
  }

  get world(): GameWorld {
    return this.current;
  }

  get done(): boolean {
    return this.t >= this.fixture.ticks || this.outcome.goal !== null;
  }

  /** Steps scheduled for the current tick (Lab timeline). */
  stepsAt(t: number): readonly ScenarioStep[] {
    return this.steps.filter((s) => s.t === t);
  }

  get allSteps(): readonly ScenarioStep[] {
    return this.steps;
  }

  private entityFor(ref: string): number {
    const w = this.current;
    if (ref === 'core') return w.coreEntityId;
    const [kind, index] = ref.split(':');
    const id = w.debugEntities(kind!)[Number(index ?? 0)];
    if (id === undefined) throw new Error(`fixture ${this.fixture.id}: no ${ref}`);
    return id;
  }

  /**
   * Physics Lab: from the next tick on, seat `slot` describes `hand` (as a camera would, with its
   * current aim), or nothing again. Outside the fixture's script: a what-if, like a material
   * change.
   */
  setHand(slot: PlayerSlot, hand: HandState | null): void {
    this.hands[slot] = hand;
  }

  /** Applies this tick's script, advances the world one fixed step and records the outcome. */
  step(): ScenarioTick {
    const w = this.current;
    // Sequence numbers continue from what the world has accepted (stays valid across rewinds).
    this.seq = [w.lastSeq(0) + 1, w.lastSeq(1) + 1];
    // A held hand first, toward the seat's own aim, so this tick's script still moves its aim.
    for (const slot of [0, 1] as const) {
      const hand = this.hands[slot];
      if (!hand) continue;
      const [x, z] = w.debugAimTarget(slot);
      const seq = this.seq[slot]++;
      w.applyCommand(slot, {
        seq,
        clientTime: seq * 33,
        action: 'aim',
        phase: 'hold',
        aim: toAim(w.arena, x, z),
        intensity: 1,
        hand,
        source: 'camera',
      });
    }
    for (const st of this.stepsAt(this.t)) {
      if ('place' in st) {
        const v = st.v ?? [0, 0, 0];
        w.debugPlaceBody(this.entityFor(st.place), st.p[0], st.p[1], st.p[2], v[0], v[1], v[2]);
      } else {
        w.debugPlaceManipulator(st.slot, st.at[0], st.at[1]);
        const seq = this.seq[st.slot]++;
        const intent: ActionIntent = {
          seq,
          clientTime: seq * 33,
          action: st.act,
          phase: st.phase ?? 'tap',
          aim: toAim(w.arena, st.at[0], st.at[1]),
          ...(st.dir ? { dir: [st.dir[0], st.dir[1]] as const } : {}),
          intensity: 1,
          ...(st.modifier !== undefined ? { modifier: st.modifier } : {}),
          source: 'keyboard',
        };
        w.applyCommand(st.slot, intent);
      }
    }
    const result = w.stepFixed();
    const o = this.outcome;
    for (const e of result.events) {
      if (e.type === 'reaction') o.reactions[e.kind] = (o.reactions[e.kind] ?? 0) + 1;
      if (e.type === 'goal' && o.goal === null) {
        o.goal = e.scorer;
        o.goalTick = this.t;
      }
    }
    const snapshot = w.snapshot();
    const core = snapshot.entities.find((e) => e.kind === 'core');
    if (core) {
      o.maxCoreHeight = Math.max(o.maxCoreHeight, core.p[1]);
      if (core.veil) o.coreVeiled = true;
    }
    this.t++;
    return { result, snapshot };
  }

  /** Runs to the end (goal or tick budget) and returns the outcome plus the final state hash. */
  runToEnd(): ScenarioOutcome & { readonly hash: string } {
    while (!this.done) this.step();
    return { ...copyOutcome(this.outcome), hash: this.current.stateHash() };
  }

  mark(): ScenarioMark {
    return { t: this.t, world: this.current.checkpoint(), outcome: copyOutcome(this.outcome) };
  }

  /** Restores a mark taken from this run (deterministic: re-stepping reproduces the same ticks). */
  async rewind(mark: ScenarioMark): Promise<void> {
    const restored = await GameWorld.restore(this.options, mark.world);
    this.current.dispose();
    this.current = restored;
    this.t = mark.t;
    this.outcome = copyOutcome(mark.outcome);
  }

  dispose(): void {
    this.current.dispose();
  }
}
