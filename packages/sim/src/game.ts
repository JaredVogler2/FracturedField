import {
  DEFAULT_ABILITIES,
  DEFAULT_RULES,
  MERIDIAN_ARENA,
  secondsToTicks,
  type AbilityId,
  type AbilityTable,
  type ArenaLayout,
  type GameRules,
} from '@ff/game-data';
import type {
  ActionIntent,
  ActionResult,
  EffectSnapshot,
  EntityId,
  EntitySnapshot,
  GameEvent,
  MatchPhase,
  MatchSnapshot,
  PlayerSlot,
  PlayerSnapshot,
  RejectReason,
  WorldSnapshot,
} from '@ff/protocol';
import { q3, q4 } from '@ff/protocol';
import { initPhysics, RAPIER } from './rapier.js';
import { PhysicsWorld, restoreRapierWorld, GROUP, type EntityRecord } from './physics.js';
import { Rng, type RngState } from './rng.js';
import { clamp, length2, linearFalloff, quatFromYaw } from './math.js';
import { detectGoalCrossing } from './goal.js';
import { StateHasher } from './hash.js';

/* ------------------------------------------------------------------------------------------ */
/* State                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const IMPLEMENTED: readonly AbilityId[] = ['pulse', 'lift', 'sweep', 'guard'];

interface HoldState {
  ability: 'lift';
  target: EntityId;
  ticks: number;
}

interface PlayerState {
  slot: PlayerSlot;
  mx: number;
  mz: number;
  tx: number;
  tz: number;
  energy: number;
  regenDelay: number;
  cooldowns: Partial<Record<AbilityId, number>>;
  lockout: number;
  hold: HoldState | null;
  lastSeq: number;
  connected: boolean;
  guards: EntityId[];
}

interface EffectState {
  id: number;
  kind: 'sweep';
  owner: PlayerSlot;
  x: number;
  z: number;
  radius: number;
  ttl: number;
  maxTtl: number;
  sign: number;
}

interface MatchState {
  phase: MatchPhase;
  round: number;
  score: [number, number];
  roundWins: [number, number];
  totalGoals: [number, number];
  clockTicks: number;
  phaseTicks: number;
  golden: boolean;
  paused: boolean;
  winner: PlayerSlot | -1 | null;
  kickoffShield: number;
  roundsPlayed: number;
  /** Set when the current round has been decided; consumed when the goal pause ends. */
  roundDecided: boolean;
}

interface BoulderSpawn {
  id: EntityId;
  x: number;
  z: number;
  radius: number;
}

export interface TickInput {
  readonly slot: PlayerSlot;
  readonly intent: ActionIntent;
}

/** An intent outcome routed back to the seat that sent it. */
export interface SeatResult {
  readonly slot: PlayerSlot;
  readonly result: ActionResult;
}

export interface StepResult {
  readonly tick: number;
  readonly events: readonly GameEvent[];
  readonly results: readonly SeatResult[];
}

export interface WorldOptions {
  readonly seed: number;
  readonly rules?: GameRules;
  readonly abilities?: AbilityTable;
  readonly arena?: ArenaLayout;
  /** Start directly in a running match (tests, practice). Default: lobby. */
  readonly autoStart?: boolean;
}

interface SerializedState {
  readonly tick: number;
  readonly seed: number;
  readonly rng: RngState;
  readonly players: readonly PlayerState[];
  readonly effects: readonly EffectState[];
  readonly match: MatchState;
  readonly entities: readonly EntityRecord[];
  readonly nextEntityId: number;
  readonly nextEffectId: number;
  readonly nextEventId: number;
  readonly coreId: EntityId;
  readonly boulders: readonly BoulderSpawn[];
  readonly prevCore: { x: number; y: number; z: number };
}

export interface WorldCheckpoint {
  readonly version: 1;
  readonly rapier: Uint8Array;
  readonly state: string;
}

const MAX_INTENTS_PER_TICK = 8;

/* ------------------------------------------------------------------------------------------ */
/* GameWorld                                                                                   */
/* ------------------------------------------------------------------------------------------ */

/**
 * The authoritative RIFTBALL simulation. Identical code runs in the Cloudflare Durable Object, the
 * Node fallback server and the browser's local/practice driver.
 *
 * Fixed tick order (documented in docs/decisions/ADR-0004-tick-order.md):
 *   1. drain queued intents (slot order alternates by tick parity) -> validate -> apply
 *   2. move manipulators toward their targets at the capped speed
 *   3. accumulate sustained fields (hover, lift, sweep) -> clamp -> apply as impulses
 *   4. Rapier fixed step (dt = 1 / tickRate)
 *   5. impacts -> events, guard damage / breakage
 *   6. goal crossing test (playing phase only)
 *   7. timers: effects, guards, cooldowns, energy, match clock and phase transitions
 */
export class GameWorld {
  readonly rules: GameRules;
  readonly abilities: AbilityTable;
  readonly arena: ArenaLayout;
  readonly seed: number;
  private physics: PhysicsWorld;
  private rng: Rng;
  private tickNo = 0;
  private players: [PlayerState, PlayerState];
  private effects: EffectState[] = [];
  private match: MatchState;
  private coreId: EntityId;
  private boulders: BoulderSpawn[] = [];
  private nextEffectId = 1;
  private nextEventId = 1;
  private prevCore = { x: 0, y: 0, z: 0 };
  private readonly queues: [TickInput[], TickInput[]] = [[], []];
  private events: GameEvent[] = [];
  private results: SeatResult[] = [];
  private readonly fieldAcc = new Map<EntityId, { x: number; y: number; z: number }>();
  private disposed = false;

  private constructor(
    opts: WorldOptions,
    restored?: { physics: PhysicsWorld; state: SerializedState },
  ) {
    this.rules = opts.rules ?? DEFAULT_RULES;
    this.abilities = opts.abilities ?? DEFAULT_ABILITIES;
    this.arena = opts.arena ?? MERIDIAN_ARENA;
    this.seed = opts.seed >>> 0;
    if (restored) {
      const s = restored.state;
      this.physics = restored.physics;
      this.rng = Rng.fromState(s.rng);
      this.tickNo = s.tick;
      this.players = [clonePlayer(s.players[0]!), clonePlayer(s.players[1]!)];
      this.effects = s.effects.map((e) => ({ ...e }));
      this.match = cloneMatch(s.match);
      this.coreId = s.coreId;
      this.boulders = s.boulders.map((b) => ({ ...b }));
      this.nextEffectId = s.nextEffectId;
      this.nextEventId = s.nextEventId;
      this.prevCore = { ...s.prevCore };
      return;
    }
    this.physics = new PhysicsWorld(this.rules, this.arena);
    this.rng = new Rng(this.seed);
    const core = this.rules.core;
    this.coreId = this.physics.createCore(core, 0, core.hoverHeight, 0);
    this.prevCore = { x: 0, y: core.hoverHeight, z: 0 };
    for (const o of this.arena.obstacles) {
      if (o.kind !== 'boulder') continue;
      const id = this.physics.createBoulder(o.x, o.z, o.radius, o.mass, o.material);
      this.boulders.push({ id, x: o.x, z: o.z, radius: o.radius });
    }
    this.players = [this.freshPlayer(0), this.freshPlayer(1)];
    this.match = {
      phase: 'lobby',
      round: 1,
      score: [0, 0],
      roundWins: [0, 0],
      totalGoals: [0, 0],
      clockTicks: this.ticks(this.rules.match.roundSeconds),
      phaseTicks: 0,
      golden: false,
      paused: false,
      winner: null,
      kickoffShield: 0,
      roundsPlayed: 0,
      roundDecided: false,
    };
    if (opts.autoStart) this.startMatch();
  }

  /** Creates a seeded world. Initialises the physics WASM on first use in this runtime. */
  static async create(opts: WorldOptions): Promise<GameWorld> {
    await initPhysics();
    return new GameWorld(opts);
  }

  /** Rebuilds a world from a checkpoint (Durable Object rehydration, resync tests). */
  static async restore(opts: WorldOptions, cp: WorldCheckpoint): Promise<GameWorld> {
    await initPhysics();
    const state = JSON.parse(cp.state) as SerializedState;
    const rules = opts.rules ?? DEFAULT_RULES;
    const arena = opts.arena ?? MERIDIAN_ARENA;
    const physics = new PhysicsWorld(rules, arena, {
      world: restoreRapierWorld(cp.rapier),
      entities: state.entities,
      nextId: state.nextEntityId,
    });
    return new GameWorld({ ...opts, seed: state.seed }, { physics, state });
  }

  get tick(): number {
    return this.tickNo;
  }

  get phase(): MatchPhase {
    return this.match.phase;
  }

  get coreEntityId(): EntityId {
    return this.coreId;
  }

  get staticShapes() {
    return this.physics.staticShapes;
  }

  private ticks(seconds: number): number {
    return secondsToTicks(seconds, this.rules.match.tickRate);
  }

  private freshPlayer(slot: PlayerSlot): PlayerState {
    const x = slot === 0 ? -this.arena.spawnX : this.arena.spawnX;
    return {
      slot,
      mx: x,
      mz: 0,
      tx: x,
      tz: 0,
      energy: this.rules.energy.startValue,
      regenDelay: 0,
      cooldowns: {},
      lockout: 0,
      hold: null,
      lastSeq: -1,
      connected: true,
      guards: [],
    };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Session-facing API                                                                        */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * Queues an intent for the next tick. Returns false when the per-tick bound is exceeded (the
   * intent is then rejected as rate limited in the next step's results).
   */
  applyCommand(slot: PlayerSlot, intent: ActionIntent): boolean {
    const q = this.queues[slot];
    if (q.length >= MAX_INTENTS_PER_TICK) {
      if (intent.action !== 'aim')
        this.results.push({ slot, result: reject(intent.seq, 'rate_limited', this.tickNo) });
      return false;
    }
    q.push({ slot, intent });
    return true;
  }

  /** Lobby -> countdown. Ignored unless in the lobby. */
  startMatch(): void {
    if (this.match.phase !== 'lobby') return;
    this.beginCountdown();
  }

  /** Full reset to round 1 after a finished match (both players asked for a rematch). */
  rematch(): void {
    if (this.match.phase !== 'matchEnd') return;
    this.match.round = 1;
    this.match.score = [0, 0];
    this.match.roundWins = [0, 0];
    this.match.totalGoals = [0, 0];
    this.match.roundsPlayed = 0;
    this.match.winner = null;
    this.match.golden = false;
    this.match.roundDecided = false;
    this.match.clockTicks = this.ticks(this.rules.match.roundSeconds);
    this.beginCountdown();
  }

  /** Pauses / resumes simulation (disconnect grace). The tick counter keeps advancing. */
  setPaused(paused: boolean): void {
    this.match.paused = paused;
    if (paused) {
      for (const p of this.players) this.releaseHold(p, false);
    }
  }

  get paused(): boolean {
    return this.match.paused;
  }

  /** Marks a seat connected/disconnected; a disconnect cancels held abilities immediately. */
  setConnected(slot: PlayerSlot, connected: boolean): void {
    const p = this.players[slot];
    p.connected = connected;
    if (!connected) {
      this.releaseHold(p, true);
      p.tx = p.mx;
      p.tz = p.mz;
    }
  }

  /** Ends the match immediately in favour of `winner` (forfeit after disconnect grace). */
  forfeit(loser: PlayerSlot): void {
    if (this.match.phase === 'matchEnd') return;
    const winner: PlayerSlot = loser === 0 ? 1 : 0;
    this.match.winner = winner;
    this.setPhase('matchEnd', 0);
    this.emit({ type: 'matchEnd', winner });
  }

  /** Last accepted sequence number for a slot (for resume ACK). */
  lastSeq(slot: PlayerSlot): number {
    return this.players[slot].lastSeq;
  }

  /**
   * Resets the anti-replay sequence for a seat whose connection was replaced (resume after drop):
   * WebSocket order is per connection, so a new connection starts a new sequence space.
   */
  resetSequence(slot: PlayerSlot): void {
    this.players[slot].lastSeq = -1;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Fixed step                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  stepFixed(): StepResult {
    if (this.disposed) throw new Error('GameWorld disposed');
    const tick = this.tickNo;
    this.events = [];
    const results = this.results;
    this.results = [];

    if (this.match.paused) {
      for (const q of this.queues) {
        for (const { slot, intent } of q) {
          if (intent.action !== 'aim')
            results.push({ slot, result: reject(intent.seq, 'paused', tick) });
        }
        q.length = 0;
      }
      this.tickNo++;
      return { tick, events: this.events, results };
    }

    // 1. intents — alternate which seat is processed first for fairness.
    const order: PlayerSlot[] = tick % 2 === 0 ? [0, 1] : [1, 0];
    for (const slot of order) {
      const q = this.queues[slot];
      for (const input of q) this.processIntent(input, results);
      q.length = 0;
    }

    // 2. manipulators
    this.moveManipulators();

    // 3. fields
    this.applyFields();

    // 4. physics
    const { impacts, invalid } = this.physics.step();
    for (const id of invalid) this.recoverInvalidBody(id);

    // 5. impacts and guard damage
    for (const imp of impacts) {
      this.emit({
        type: 'impact',
        a: imp.a,
        b: imp.b,
        p: [q3(imp.x), q3(imp.y), q3(imp.z)],
        impulse: q3(imp.impulse),
      });
      this.damageIfGuard(imp.a, imp.impulse);
      if (imp.b >= 0) this.damageIfGuard(imp.b, imp.impulse);
    }

    // 6. goals
    const core = this.physics.body(this.coreId);
    if (core) {
      const t = core.translation();
      if (this.match.phase === 'playing') {
        const scorer = detectGoalCrossing(this.prevCore, t, this.arena, this.rules.core);
        if (scorer !== null) this.onGoal(scorer, t);
      }
      this.prevCore = { x: t.x, y: t.y, z: t.z };
    }

    // 7. timers
    this.tickTimers();

    this.tickNo++;
    return { tick, events: this.events, results };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Intents and abilities                                                                     */
  /* ---------------------------------------------------------------------------------------- */

  private processIntent({ slot, intent }: TickInput, results: SeatResult[]): void {
    const p = this.players[slot];
    const tick = this.tickNo;
    // Anti-replay: strictly increasing sequence per connection.
    if (!Number.isInteger(intent.seq) || intent.seq <= p.lastSeq) {
      if (intent.action !== 'aim')
        results.push({ slot, result: reject(intent.seq, 'stale', tick) });
      return;
    }
    p.lastSeq = intent.seq;
    if (!p.connected) return;

    // Every intent carries the desired aim; update the manipulator target (clamped to legal area).
    const ax = finite(intent.aim[0]);
    const az = finite(intent.aim[1]);
    const target = this.clampToSide(
      slot,
      clamp(ax, -1, 1) * this.arena.halfLength,
      clamp(az, -1, 1) * this.arena.halfWidth,
    );
    p.tx = target.x;
    p.tz = target.z;

    if (intent.action === 'aim') return;

    const ability = intent.action;
    const def = this.abilities[ability];
    const accept = (): void => {
      results.push({ slot, result: { seq: intent.seq, accepted: true, tick } });
    };
    const deny = (reason: RejectReason): void => {
      results.push({ slot, result: reject(intent.seq, reason, tick) });
    };

    // Releasing a hold is always allowed (never trap a player in a held ability).
    if (intent.phase === 'end') {
      if (p.hold && p.hold.ability === ability) {
        this.releaseHold(p, true);
        accept();
      } else deny('invalid');
      return;
    }
    if (intent.phase === 'hold') {
      // Keep-alive for an active hold; aim already applied above.
      if (p.hold && p.hold.ability === ability) accept();
      else deny('invalid');
      return;
    }

    if (!def.available || !IMPLEMENTED.includes(ability)) return deny('not_available');
    if (this.match.phase !== 'playing') return deny('not_playing');
    if ((def.kind === 'tap') !== (intent.phase === 'tap')) return deny('invalid');
    if ((p.cooldowns[ability] ?? 0) > 0) return deny('cooldown');
    if (p.lockout > 0) return deny('lockout');
    if (p.energy < def.cost) return deny('energy');

    const intensity = 0.75 + 0.25 * clamp(finite(intent.intensity), 0, 1);
    let outcome: RejectReason | null;
    switch (ability) {
      case 'pulse':
        outcome = this.castPulse(p, intensity);
        break;
      case 'sweep':
        outcome = this.castSweep(p, intent.modifier);
        break;
      case 'guard':
        outcome = this.castGuard(p, intent.dir);
        break;
      case 'lift':
        outcome = this.startLift(p);
        break;
      default:
        outcome = 'not_available';
    }
    if (outcome) return deny(outcome);

    this.spend(p, def.cost);
    p.cooldowns[ability] = this.ticks(def.cooldownSeconds);
    p.lockout = this.ticks(def.lockoutSeconds);
    accept();
  }

  private spend(p: PlayerState, amount: number): void {
    p.energy = Math.max(0, p.energy - amount);
    p.regenDelay = this.ticks(this.rules.energy.regenDelaySeconds);
  }

  private castPulse(p: PlayerState, intensity: number): RejectReason | null {
    const def = this.abilities.pulse;
    const oy = this.rules.manipulator.height;
    let coreMag = 0;
    for (const e of this.physics.entities.values()) {
      if (e.kind !== 'core' && e.kind !== 'boulder') continue;
      if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
      const body = this.physics.body(e.id);
      if (!body) continue;
      const t = body.translation();
      const dx = t.x - p.mx;
      const dz = t.z - p.mz;
      const d = length2(dx, dz);
      const strength = linearFalloff(d, def.fullStrengthRadius, def.radius) * intensity;
      if (strength <= 0) continue;
      // Horizontal push away from the manipulator; at zero distance push toward the enemy goal.
      let nx: number;
      let nz: number;
      if (d > 1e-4) {
        nx = dx / d;
        nz = dz / d;
      } else {
        nx = p.slot === 0 ? 1 : -1;
        nz = 0;
      }
      const ny = def.lift;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const j = def.impulse * strength;
      body.applyImpulse({ x: nx * inv * j, y: ny * inv * j, z: nz * inv * j }, true);
      if (e.kind === 'core') coreMag = strength;
    }
    this.emit({
      type: 'cast',
      slot: p.slot,
      ability: 'pulse',
      phase: 'tap',
      p: [q3(p.mx), q3(oy), q3(p.mz)],
      mag: q3(coreMag),
    });
    return null;
  }

  private castSweep(p: PlayerState, modifier: number | undefined): RejectReason | null {
    const def = this.abilities.sweep;
    if (this.effects.length >= this.rules.limits.maxActiveEffects) return 'limit';
    const sign = modifier !== undefined && modifier < 0 ? -1 : 1;
    const ttl = this.ticks(def.durationSeconds);
    this.effects.push({
      id: this.nextEffectId++,
      kind: 'sweep',
      owner: p.slot,
      x: p.mx,
      z: p.mz,
      radius: def.radius,
      ttl,
      maxTtl: ttl,
      sign,
    });
    this.emit({
      type: 'cast',
      slot: p.slot,
      ability: 'sweep',
      phase: 'tap',
      p: [q3(p.mx), q3(this.rules.manipulator.height), q3(p.mz)],
      mag: sign,
    });
    return null;
  }

  private castGuard(
    p: PlayerState,
    dir: readonly [number, number] | undefined,
  ): RejectReason | null {
    const def = this.abilities.guard;
    const x = p.mx;
    const z = p.mz;
    if (Math.abs(x) > this.arena.halfLength - def.goalLineClearance) return 'illegal_target';

    // Face the core (blocks its current line) unless the input supplies an explicit facing.
    let fx = 0;
    let fz = 0;
    if (
      dir &&
      Number.isFinite(dir[0]) &&
      Number.isFinite(dir[1]) &&
      length2(dir[0], dir[1]) > 0.2
    ) {
      fx = dir[0];
      fz = dir[1];
    } else {
      const core = this.physics.body(this.coreId);
      if (core) {
        const t = core.translation();
        fx = t.x - x;
        fz = t.z - z;
      }
      if (length2(fx, fz) < 0.5) {
        fx = p.slot === 0 ? 1 : -1;
        fz = 0;
      }
    }
    const yaw = Math.atan2(fx, fz);
    const half: [number, number, number] = [def.halfWidth, def.halfHeight, def.halfDepth];

    // Placement must not overlap any body or wall (floor excluded by lifting the probe box).
    const probeY = def.halfHeight + 0.08;
    const shape = new RAPIER.Cuboid(half[0], half[1] - 0.05, half[2]);
    let blocked = false;
    this.physics.world.intersectionsWithShape({ x, y: probeY, z }, quatFromYaw(yaw), shape, () => {
      blocked = true;
      return false;
    });
    if (blocked) return 'illegal_target';
    for (const e of this.physics.entities.values()) {
      if (e.kind !== 'guard') continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      if (length2(t.x - x, t.z - z) < def.halfWidth * 1.2) return 'illegal_target';
    }
    if (this.physics.entityCount >= this.rules.limits.maxDynamicBodies) return 'limit';

    // Oldest guard is retired when the per-player limit is reached.
    while (p.guards.length >= this.rules.limits.maxGuardsPerPlayer) {
      const old = p.guards.shift();
      if (old !== undefined) this.despawn(old, 'expired');
    }
    const id = this.physics.createGuard(
      p.slot,
      x,
      z,
      yaw,
      half,
      def.restitution,
      this.ticks(def.lifetimeSeconds),
    );
    p.guards.push(id);
    this.emit({ type: 'spawn', entity: id, kind: 'guard', p: [q3(x), q3(def.halfHeight), q3(z)] });
    this.emit({
      type: 'cast',
      slot: p.slot,
      ability: 'guard',
      phase: 'tap',
      p: [q3(x), q3(this.rules.manipulator.height), q3(z)],
      mag: 1,
    });
    return null;
  }

  private startLift(p: PlayerState): RejectReason | null {
    if (p.hold) return 'invalid';
    const def = this.abilities.lift;
    let best: EntityId = -1;
    let bestD = Infinity;
    for (const e of this.physics.entities.values()) {
      if (e.kind !== 'core' && e.kind !== 'boulder') continue;
      if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      // Prefer the core: it is treated as slightly closer than it is.
      const d = length2(t.x - p.mx, t.z - p.mz) - (e.kind === 'core' ? 0.75 : 0);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    if (best < 0 || bestD > def.range) return 'out_of_range';
    p.hold = { ability: 'lift', target: best, ticks: 0 };
    this.emit({
      type: 'cast',
      slot: p.slot,
      ability: 'lift',
      phase: 'start',
      p: [q3(p.mx), q3(this.rules.manipulator.height), q3(p.mz)],
      mag: best,
    });
    return null;
  }

  private releaseHold(p: PlayerState, announce: boolean): void {
    if (!p.hold) return;
    const ability = p.hold.ability;
    p.hold = null;
    if (announce) {
      this.emit({
        type: 'cast',
        slot: p.slot,
        ability,
        phase: 'end',
        p: [q3(p.mx), q3(this.rules.manipulator.height), q3(p.mz)],
        mag: 0,
      });
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Manipulators and fields                                                                   */
  /* ---------------------------------------------------------------------------------------- */

  /** Clamps a world point to the legal manipulator region of a seat (own half + reach). */
  clampToSide(slot: PlayerSlot, x: number, z: number): { x: number; z: number } {
    const m = this.rules.manipulator;
    const L = this.arena.halfLength - m.wallMargin;
    const W = this.arena.halfWidth - m.wallMargin;
    const minX = slot === 0 ? -L : -m.midlineReach;
    const maxX = slot === 0 ? m.midlineReach : L;
    return { x: clamp(x, minX, maxX), z: clamp(z, -W, W) };
  }

  private moveManipulators(): void {
    const maxStep = this.rules.manipulator.maxSpeed / this.rules.match.tickRate;
    for (const p of this.players) {
      const dx = p.tx - p.mx;
      const dz = p.tz - p.mz;
      const d = length2(dx, dz);
      if (d <= maxStep) {
        p.mx = p.tx;
        p.mz = p.tz;
      } else {
        p.mx += (dx / d) * maxStep;
        p.mz += (dz / d) * maxStep;
      }
    }
  }

  private accumulate(id: EntityId, ax: number, ay: number, az: number): void {
    const acc = this.fieldAcc.get(id);
    if (acc) {
      acc.x += ax;
      acc.y += ay;
      acc.z += az;
    } else this.fieldAcc.set(id, { x: ax, y: ay, z: az });
  }

  private applyFields(): void {
    const dt = this.physics.dt;
    const g = this.rules.gravity;
    this.fieldAcc.clear();
    let coreLifted = false;

    // Lift holds (energy drain, range checks, auto-release).
    for (const p of this.players) {
      const h = p.hold;
      if (!h) continue;
      const def = this.abilities.lift;
      const drain = def.costPerSecond * dt;
      const body = this.physics.body(h.target);
      h.ticks++;
      if (
        !body ||
        p.energy < drain ||
        h.ticks > this.ticks(def.maxHoldSeconds) ||
        this.match.phase !== 'playing'
      ) {
        this.releaseHold(p, true);
        continue;
      }
      const t = body.translation();
      const v = body.linvel();
      const dh = length2(t.x - p.mx, t.z - p.mz);
      if (dh > def.range * 1.3) {
        this.releaseHold(p, true);
        continue;
      }
      this.spend(p, drain);
      const ay = g + def.stiffness * (def.height - t.y) - def.damping * v.y;
      const ax = def.carryStiffness * (p.mx - t.x) - 0.8 * v.x;
      const az = def.carryStiffness * (p.mz - t.z) - 0.8 * v.z;
      this.accumulate(h.target, ax, ay, az);
      if (h.target === this.coreId) coreLifted = true;
    }

    // Sweeps (vortex fields).
    if (this.effects.length > 0) {
      const def = this.abilities.sweep;
      for (const e of this.physics.entities.values()) {
        if (e.kind !== 'core' && e.kind !== 'boulder') continue;
        if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
        const body = this.physics.body(e.id);
        if (!body) continue;
        const t = body.translation();
        for (const fx of this.effects) {
          const dx = t.x - fx.x;
          const dz = t.z - fx.z;
          const r = length2(dx, dz);
          if (r >= fx.radius || r < 1e-3) continue;
          // Ring profile peaks mid-radius; fades in/out over the effect lifetime.
          const life = Math.min(1, fx.ttl / 6, (fx.maxTtl - fx.ttl + 1) / 4);
          const profile = Math.sin((Math.PI * r) / fx.radius) * life;
          const tx = (-dz / r) * fx.sign;
          const tz = (dx / r) * fx.sign;
          const at = def.tangentialAcceleration * profile;
          const ai = def.inwardAcceleration * profile;
          this.accumulate(e.id, tx * at - (dx / r) * ai, 0, tz * at - (dz / r) * ai);
        }
      }
    }

    // Apply clamped field accelerations as impulses (J = m · a · dt).
    const maxA = this.rules.limits.maxFieldAcceleration;
    for (const [id, a] of this.fieldAcc) {
      const body = this.physics.body(id);
      if (!body) continue;
      let ax = finite(a.x);
      let ay = finite(a.y);
      let az = finite(a.z);
      const mag = Math.sqrt(ax * ax + ay * ay + az * az);
      if (mag > maxA) {
        const s = maxA / mag;
        ax *= s;
        ay *= s;
        az *= s;
      }
      const m = body.mass();
      body.applyImpulse({ x: ax * m * dt, y: ay * m * dt, z: az * m * dt }, true);
    }

    // Core levitation field (its own, not a player force).
    const core = this.physics.body(this.coreId);
    if (core && !coreLifted) {
      const c = this.rules.core;
      const t = core.translation();
      if (t.y < c.hoverHeight + c.hoverBand) {
        const v = core.linvel();
        const ay = clamp(
          g + c.hoverStiffness * (c.hoverHeight - t.y) - c.hoverDamping * v.y,
          0,
          2.5 * g,
        );
        core.applyImpulse({ x: 0, y: ay * core.mass() * dt, z: 0 }, true);
      }
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Entities                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  private damageIfGuard(id: EntityId, impulse: number): void {
    const e = this.physics.entities.get(id);
    if (!e || e.kind !== 'guard') return;
    e.damage += impulse;
    if (e.damage >= this.abilities.guard.breakImpulse) this.despawn(id, 'broken');
  }

  private despawn(id: EntityId, reason: 'expired' | 'broken' | 'reset'): void {
    const e = this.physics.entities.get(id);
    if (!e) return;
    const body = this.physics.body(id);
    const t = body ? body.translation() : { x: 0, y: 0, z: 0 };
    if (e.owner !== -1) {
      const owner = this.players[e.owner];
      owner.guards = owner.guards.filter((g) => g !== id);
    }
    this.physics.remove(id);
    this.emit({ type: 'despawn', entity: id, reason, p: [q3(t.x), q3(t.y), q3(t.z)] });
  }

  private recoverInvalidBody(id: EntityId): void {
    // Defensive: a non-finite body is returned to its spawn point at rest (should never happen).
    const body = this.physics.body(id);
    if (!body) return;
    const b = this.boulders.find((s) => s.id === id);
    const pos =
      id === this.coreId
        ? { x: 0, y: this.rules.core.hoverHeight, z: 0 }
        : b
          ? { x: b.x, y: b.radius, z: b.z }
          : { x: 0, y: 2, z: 0 };
    body.setTranslation(pos, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (id === this.coreId) this.prevCore = { ...pos };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Match lifecycle                                                                           */
  /* ---------------------------------------------------------------------------------------- */

  private setPhase(phase: MatchPhase, ticks: number): void {
    this.match.phase = phase;
    this.match.phaseTicks = ticks;
    this.emit({ type: 'phase', phase, round: this.match.round });
  }

  /** Rule-level reset of bodies and players before each kickoff (not an ability effect). */
  private resetField(): void {
    for (const e of [...this.physics.entities.values()]) {
      if (e.kind === 'guard') this.despawn(e.id, 'reset');
    }
    this.effects = [];
    const c = this.rules.core;
    const core = this.physics.body(this.coreId);
    if (core) {
      core.setTranslation({ x: 0, y: c.hoverHeight, z: 0 }, true);
      core.setLinvel({ x: 0, y: 0, z: 0 }, true);
      core.setAngvel({ x: 0, y: 0, z: 0 }, true);
      core.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    this.prevCore = { x: 0, y: c.hoverHeight, z: 0 };
    for (const b of this.boulders) {
      const body = this.physics.body(b.id);
      if (!body) continue;
      body.setTranslation({ x: b.x, y: b.radius, z: b.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    for (const p of this.players) {
      this.releaseHold(p, false);
      const fresh = this.freshPlayer(p.slot);
      p.mx = fresh.mx;
      p.mz = fresh.mz;
      p.tx = fresh.tx;
      p.tz = fresh.tz;
      p.energy = this.rules.energy.max;
      p.regenDelay = 0;
      p.cooldowns = {};
      p.lockout = 0;
      p.guards = [];
    }
  }

  private beginCountdown(): void {
    this.resetField();
    this.match.roundDecided = false;
    this.setPhase('countdown', this.ticks(this.rules.match.countdownSeconds));
  }

  private kickoff(): void {
    const core = this.physics.body(this.coreId);
    // Seeded nudge, mostly sideways so neither side is favoured.
    const side = this.rng.next() < 0.5 ? -1 : 1;
    const angle = side * (Math.PI / 2) + this.rng.range(-0.55, 0.55);
    const s = this.rules.match.kickoffSpeed;
    const vx = Math.sin(angle) * s;
    const vz = Math.cos(angle) * s;
    if (core) core.applyImpulse({ x: vx * core.mass(), y: 0, z: vz * core.mass() }, true);
    this.match.kickoffShield = this.ticks(this.rules.match.kickoffShieldSeconds);
    this.setPhase('playing', 0);
    this.emit({
      type: 'kickoff',
      p: [0, q3(this.rules.core.hoverHeight), 0],
      v: [q3(vx), 0, q3(vz)],
    });
  }

  private onGoal(scorer: PlayerSlot, at: { x: number; y: number; z: number }): void {
    const m = this.match;
    m.score[scorer]++;
    m.totalGoals[scorer]++;
    const core = this.physics.body(this.coreId);
    const v = core ? core.linvel() : { x: 0, y: 0, z: 0 };
    this.emit({
      type: 'goal',
      scorer,
      p: [q3(at.x), q3(at.y), q3(at.z)],
      speed: q3(Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)),
    });
    for (const p of this.players) this.releaseHold(p, true);
    if (m.golden || m.score[scorer] >= this.rules.match.goalsToWinRound) {
      this.decideRound(scorer, m.golden ? 'golden' : 'goals');
    }
    this.setPhase('goal', this.ticks(this.rules.match.goalPauseSeconds));
  }

  private decideRound(
    winner: PlayerSlot | -1,
    reason: 'goals' | 'clock' | 'golden' | 'territory' | 'draw',
  ): void {
    const m = this.match;
    if (m.roundDecided) return;
    m.roundDecided = true;
    m.roundsPlayed++;
    if (winner !== -1) m.roundWins[winner]++;
    this.emit({ type: 'roundEnd', round: m.round, winner, reason });
  }

  private matchWinner(): PlayerSlot | -1 | null {
    const m = this.match;
    const need = this.rules.match.roundsToWinMatch;
    if (m.roundWins[0] >= need) return 0;
    if (m.roundWins[1] >= need) return 1;
    if (m.roundsPlayed >= this.rules.match.maxRounds) {
      // Finite resolution: round wins, then total goals, then a draw.
      if (m.roundWins[0] !== m.roundWins[1]) return m.roundWins[0] > m.roundWins[1] ? 0 : 1;
      if (m.totalGoals[0] !== m.totalGoals[1]) return m.totalGoals[0] > m.totalGoals[1] ? 0 : 1;
      return -1;
    }
    return null;
  }

  private onClockExpired(): void {
    const m = this.match;
    if (m.score[0] !== m.score[1]) {
      this.decideRound(m.score[0] > m.score[1] ? 0 : 1, 'clock');
      this.setPhase('roundEnd', this.ticks(this.rules.match.roundEndPauseSeconds));
      return;
    }
    if (!m.golden) {
      // Golden Rift sudden death: next goal wins the round.
      m.golden = true;
      m.clockTicks = this.ticks(this.rules.match.goldenRiftSeconds);
      this.emit({ type: 'phase', phase: 'playing', round: m.round });
      return;
    }
    // Golden Rift expired level: the round goes to whoever holds territory (core in the
    // opponent's half). Exactly central -> drawn round.
    const core = this.physics.body(this.coreId);
    const x = core ? core.translation().x : 0;
    const winner: PlayerSlot | -1 = x > 0.01 ? 0 : x < -0.01 ? 1 : -1;
    this.decideRound(winner, winner === -1 ? 'draw' : 'territory');
    this.setPhase('roundEnd', this.ticks(this.rules.match.roundEndPauseSeconds));
  }

  private tickTimers(): void {
    // Effects
    if (this.effects.length > 0) {
      for (const e of this.effects) e.ttl--;
      this.effects = this.effects.filter((e) => e.ttl > 0);
    }
    // Guards
    for (const e of [...this.physics.entities.values()]) {
      if (e.ttl > 0) {
        e.ttl--;
        if (e.ttl === 0) this.despawn(e.id, 'expired');
      }
    }
    // Players
    const regen = this.rules.energy.regenPerSecond / this.rules.match.tickRate;
    for (const p of this.players) {
      for (const k of Object.keys(p.cooldowns) as AbilityId[]) {
        const left = (p.cooldowns[k] ?? 0) - 1;
        if (left <= 0) delete p.cooldowns[k];
        else p.cooldowns[k] = left;
      }
      if (p.lockout > 0) p.lockout--;
      if (p.regenDelay > 0) p.regenDelay--;
      else if (!p.hold) p.energy = Math.min(this.rules.energy.max, p.energy + regen);
    }

    const m = this.match;
    if (m.kickoffShield > 0) m.kickoffShield--;
    switch (m.phase) {
      case 'countdown':
        if (--m.phaseTicks <= 0) this.kickoff();
        break;
      case 'playing':
        if (--m.clockTicks <= 0) {
          m.clockTicks = 0;
          this.onClockExpired();
        }
        break;
      case 'goal':
        if (--m.phaseTicks <= 0) {
          if (m.roundDecided)
            this.setPhase('roundEnd', this.ticks(this.rules.match.roundEndPauseSeconds));
          else this.beginCountdown();
        }
        break;
      case 'roundEnd':
        if (--m.phaseTicks <= 0) {
          const winner = this.matchWinner();
          if (winner !== null) {
            m.winner = winner;
            this.setPhase('matchEnd', 0);
            this.emit({ type: 'matchEnd', winner });
          } else {
            m.round++;
            m.score = [0, 0];
            m.golden = false;
            m.clockTicks = this.ticks(this.rules.match.roundSeconds);
            this.beginCountdown();
          }
        }
        break;
      case 'lobby':
      case 'matchEnd':
        break;
    }
  }

  private emit(e: DistributiveOmit<GameEvent, 'id' | 'tick'>): void {
    this.events.push({ ...e, id: this.nextEventId++, tick: this.tickNo });
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Snapshots, hashing, checkpoints                                                           */
  /* ---------------------------------------------------------------------------------------- */

  snapshot(): WorldSnapshot {
    const entities: EntitySnapshot[] = [];
    for (const e of this.physics.entities.values()) {
      const b = this.physics.world.getRigidBody(e.bodyHandle);
      const t = b.translation();
      const r = b.rotation();
      const v = b.linvel();
      entities.push({
        id: e.id,
        kind: e.kind,
        owner: e.owner,
        p: [q3(t.x), q3(t.y), q3(t.z)],
        q: [q4(r.x), q4(r.y), q4(r.z), q4(r.w)],
        v: [q3(v.x), q3(v.y), q3(v.z)],
        ttl: e.ttl,
      });
    }
    const effects: EffectSnapshot[] = this.effects.map((f) => ({
      id: f.id,
      kind: f.kind,
      owner: f.owner,
      p: [q3(f.x), 0, q3(f.z)],
      r: f.radius,
      ttl: f.ttl,
      maxTtl: f.maxTtl,
      s: f.sign,
    }));
    const m = this.match;
    const match: MatchSnapshot = {
      phase: m.phase,
      round: m.round,
      score: [m.score[0], m.score[1]],
      roundWins: [m.roundWins[0], m.roundWins[1]],
      clockTicks: m.clockTicks,
      phaseTicks: m.phaseTicks,
      golden: m.golden,
      paused: m.paused,
      winner: m.winner,
    };
    return {
      tick: this.tickNo,
      entities,
      players: [this.playerSnapshot(this.players[0]), this.playerSnapshot(this.players[1])],
      effects,
      match,
      ack: [this.players[0].lastSeq, this.players[1].lastSeq],
      eventCursor: this.nextEventId - 1,
    };
  }

  private playerSnapshot(p: PlayerState): PlayerSnapshot {
    const cd: Partial<Record<AbilityId, number>> = {};
    for (const [k, val] of Object.entries(p.cooldowns))
      if (val && val > 0) cd[k as AbilityId] = val;
    return {
      slot: p.slot,
      m: [q3(p.mx), q3(p.mz)],
      energy: Math.round(p.energy * 10) / 10,
      cd,
      hold: p.hold ? p.hold.ability : null,
      holdTarget: p.hold ? p.hold.target : -1,
      connected: p.connected,
    };
  }

  /** Hash of all authoritative state that affects future outcomes. */
  stateHash(): string {
    const h = new StateHasher();
    h.int(this.tickNo);
    for (const e of this.physics.entities.values()) {
      const b = this.physics.world.getRigidBody(e.bodyHandle);
      const t = b.translation();
      const v = b.linvel();
      const w = b.angvel();
      const r = b.rotation();
      h.int(e.id).num(t.x).num(t.y).num(t.z).num(v.x).num(v.y).num(v.z);
      h.num(w.x).num(w.y).num(w.z).num(r.x, 1e4).num(r.y, 1e4).num(r.z, 1e4).num(r.w, 1e4);
      h.int(e.ttl).num(e.damage);
    }
    for (const p of this.players) {
      h.num(p.mx)
        .num(p.mz)
        .num(p.energy)
        .int(p.lockout)
        .int(p.hold ? p.hold.target : -1);
    }
    for (const f of this.effects) h.int(f.id).num(f.x).num(f.z).int(f.ttl).int(f.sign);
    const m = this.match;
    h.str(m.phase)
      .int(m.round)
      .int(m.score[0])
      .int(m.score[1])
      .int(m.roundWins[0])
      .int(m.roundWins[1]);
    h.int(m.clockTicks)
      .int(m.phaseTicks)
      .int(m.golden ? 1 : 0);
    return h.digest();
  }

  /** Digest for MATCH_END comparison across clients: outcome + final tick + core position. */
  outcomeDigest(): string {
    const h = new StateHasher();
    const m = this.match;
    h.int(this.seed).int(this.tickNo).int(m.roundWins[0]).int(m.roundWins[1]);
    h.int(m.totalGoals[0])
      .int(m.totalGoals[1])
      .int(m.winner ?? -2);
    return h.digest();
  }

  get matchSummary(): {
    winner: PlayerSlot | -1 | null;
    score: [number, number];
    roundWins: [number, number];
    totalGoals: [number, number];
  } {
    const m = this.match;
    return {
      winner: m.winner,
      score: [m.score[0], m.score[1]],
      roundWins: [m.roundWins[0], m.roundWins[1]],
      totalGoals: [m.totalGoals[0], m.totalGoals[1]],
    };
  }

  checkpoint(): WorldCheckpoint {
    const state: SerializedState = {
      tick: this.tickNo,
      seed: this.seed,
      rng: this.rng.state(),
      players: this.players.map(clonePlayer),
      effects: this.effects.map((e) => ({ ...e })),
      match: cloneMatch(this.match),
      entities: this.physics.entityRecords(),
      nextEntityId: this.physics.nextEntityId,
      nextEffectId: this.nextEffectId,
      nextEventId: this.nextEventId,
      coreId: this.coreId,
      boulders: this.boulders.map((b) => ({ ...b })),
      prevCore: { ...this.prevCore },
    };
    return { version: 1, rapier: this.physics.takeSnapshot(), state: JSON.stringify(state) };
  }

  /** Debug/test-only direct impulse. Not reachable from any network message. */
  debugApplyImpulse(id: EntityId, x: number, y: number, z: number): void {
    this.physics.body(id)?.applyImpulse({ x, y, z }, true);
  }

  /** Debug/test-only teleport for fixture setup (never used by abilities). */
  debugPlaceBody(id: EntityId, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0): void {
    const b = this.physics.body(id);
    if (!b) return;
    b.setTranslation({ x, y, z }, true);
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    if (id === this.coreId) this.prevCore = { x, y, z };
  }

  /** Debug/test-only manipulator placement for fixtures. */
  debugPlaceManipulator(slot: PlayerSlot, x: number, z: number): void {
    const p = this.players[slot];
    const c = this.clampToSide(slot, x, z);
    p.mx = p.tx = c.x;
    p.mz = p.tz = c.z;
  }

  debugSetEnergy(slot: PlayerSlot, energy: number): void {
    this.players[slot].energy = energy;
  }

  /** Physics budget counters for HUD/diagnostics. */
  get counters(): { entities: number; effects: number; guards: number } {
    let guards = 0;
    for (const e of this.physics.entities.values()) if (e.kind === 'guard') guards++;
    return { entities: this.physics.entityCount, effects: this.effects.length, guards };
  }

  get collisionGroups(): typeof GROUP {
    return GROUP;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.physics.dispose();
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function reject(seq: number, reason: RejectReason, tick: number): ActionResult {
  return { seq, accepted: false, reason, tick };
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    cooldowns: { ...p.cooldowns },
    hold: p.hold ? { ...p.hold } : null,
    guards: [...p.guards],
  };
}

function cloneMatch(m: MatchState): MatchState {
  return {
    ...m,
    score: [m.score[0], m.score[1]],
    roundWins: [m.roundWins[0], m.roundWins[1]],
    totalGoals: [m.totalGoals[0], m.totalGoals[1]],
  };
}

/** D01 API: `await createWorld(seed, rules)`. */
export function createWorld(
  seed: number,
  rules?: GameRules,
  extra?: Omit<WorldOptions, 'seed' | 'rules'>,
): Promise<GameWorld> {
  return GameWorld.create({ seed, ...(rules ? { rules } : {}), ...extra });
}
