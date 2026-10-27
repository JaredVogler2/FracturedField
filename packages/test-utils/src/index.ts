import { MERIDIAN_ARENA, type ArenaLayout } from '@ff/game-data';
import type {
  ActionIntent,
  HandState,
  InputSource,
  IntentAction,
  IntentPhase,
  PlayerSlot,
  Vec2,
} from '@ff/protocol';
import type { GameWorld, StepResult } from '@ff/sim';

export * from './network-sim.js';

/** World (x, z) metres -> normalized aim in [-1, 1]². */
export function worldToAim(x: number, z: number, arena: ArenaLayout = MERIDIAN_ARENA): Vec2 {
  const ax = Math.max(-1, Math.min(1, x / arena.halfLength));
  const az = Math.max(-1, Math.min(1, z / arena.halfWidth));
  return [ax, az];
}

export interface IntentOptions {
  readonly aim?: Vec2;
  readonly at?: readonly [number, number];
  readonly dir?: Vec2;
  readonly intensity?: number;
  readonly modifier?: number;
  readonly source?: InputSource;
  /** The continuous hand channel (ADR-0009). */
  readonly hand?: HandState;
}

/** Builds a canonical intent. `at` is a world (x, z) target converted to normalized aim. */
export function makeIntent(
  seq: number,
  action: IntentAction,
  phase: IntentPhase,
  opts: IntentOptions = {},
): ActionIntent {
  const aim = opts.aim ?? (opts.at ? worldToAim(opts.at[0], opts.at[1]) : ([0, 0] as const));
  return {
    seq,
    clientTime: seq * 33,
    action,
    phase,
    aim,
    ...(opts.dir ? { dir: opts.dir } : {}),
    intensity: opts.intensity ?? 1,
    ...(opts.modifier !== undefined ? { modifier: opts.modifier } : {}),
    source: opts.source ?? 'keyboard',
    ...(opts.hand ? { hand: opts.hand } : {}),
  };
}

/** Sequence counters per slot for terse test scripts. */
export class IntentScript {
  private seq: [number, number] = [0, 0];
  constructor(private readonly world: GameWorld) {}

  send(
    slot: PlayerSlot,
    action: IntentAction,
    phase: IntentPhase,
    opts: IntentOptions = {},
  ): ActionIntent {
    const intent = makeIntent(this.seq[slot]++, action, phase, opts);
    this.world.applyCommand(slot, intent);
    return intent;
  }
}

export function stepN(world: GameWorld, n: number): StepResult[] {
  const out: StepResult[] = [];
  for (let i = 0; i < n; i++) out.push(world.stepFixed());
  return out;
}

/** Steps until the predicate holds or `max` ticks elapse; returns all step results. */
export function stepUntil(
  world: GameWorld,
  pred: (r: StepResult) => boolean,
  max: number,
): StepResult[] {
  const out: StepResult[] = [];
  for (let i = 0; i < max; i++) {
    const r = world.stepFixed();
    out.push(r);
    if (pred(r)) break;
  }
  return out;
}

/** Fast-forwards a freshly started world through the kickoff countdown. */
export function skipCountdown(world: GameWorld): void {
  stepUntil(world, () => world.phase === 'playing', 400);
}
