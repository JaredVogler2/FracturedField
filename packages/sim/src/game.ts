import {
  DEFAULT_ABILITIES,
  DEFAULT_LOADOUT,
  DEFAULT_RULES,
  INFUSE_ELEMENTS,
  LOADOUT_SIZE,
  MATERIALS,
  MERIDIAN_ARENA,
  isAdvancedAbility,
  secondsToTicks,
  type AbilityId,
  type AbilityTable,
  type AdvancedAbilityId,
  type ArenaLayout,
  type GameRules,
  type MaterialId,
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
  ReactionKind,
  RejectReason,
  Vec3,
  WorldSnapshot,
} from '@ff/protocol';
import { EFFECT_FLAG, q3, q4 } from '@ff/protocol';
import { initPhysics, RAPIER } from './rapier.js';
import { PhysicsWorld, restoreRapierWorld, GROUP, type EntityRecord } from './physics.js';
import { Rng, type RngState } from './rng.js';
import { clamp, length2, linearFalloff, quatFromYaw } from './math.js';
import { detectGoalCrossing } from './goal.js';
import { StateHasher } from './hash.js';
import { discharge, discWeight, relaxToward, softenedPull, type Conductor } from './elements.js';

/* ------------------------------------------------------------------------------------------ */
/* State                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const IMPLEMENTED: readonly AbilityId[] = [
  'pulse',
  'lift',
  'sweep',
  'guard',
  'infuse',
  'freeze',
  'charge',
  'magnetize',
  'gravity',
];

/** Bodies that abilities and fields may move (fixed guards and ice plates never move). */
const MOVABLE = new Set<string>(['core', 'boulder', 'lodestone', 'shard']);
/** Bodies that carry element state (wetness, heat, charge). */
const ELEMENTAL = new Set<string>(['core', 'boulder', 'lodestone', 'shard', 'guard']);

interface HoldState {
  ability: 'lift' | 'magnetize';
  /** Lifted entity (LIFT) or -1 (MAGNETIZE acts on every lodestone in range). */
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
  /** Advanced moves picked for this match (base moves are always available). */
  loadout: AdvancedAbilityId[];
  /** Latest continuous hand state (ADR-0009) and the tick it arrived on (-1: never). */
  hand: HandReading;
  /** The body the hand's grip holds, and for how many ticks; null when it holds nothing. */
  grasp: { target: EntityId; ticks: number } | null;
  /** Ticks before the hand may grip again after letting go. */
  regrip: number;
  /**
   * The hand's velocity (m/s) as a stroke or a carry follows it: the force point's motion,
   * smoothed so tracking jitter averages out. Zero while no hand is described.
   */
  hv: { x: number; z: number };
}

interface HandReading {
  grip: number;
  push: number;
  twist: number;
  tick: number;
}

/** An open, still hand (also what a stale or disconnected hand counts as). */
const NEUTRAL_HAND: Readonly<HandReading> = { grip: 0, push: 0, twist: 0, tick: -1 };

interface EffectState {
  id: number;
  /** sweep = crosswind field; well = GRAVITY well (sign/dx/dz unused). */
  kind: 'sweep' | 'well';
  owner: PlayerSlot;
  x: number;
  z: number;
  radius: number;
  ttl: number;
  maxTtl: number;
  sign: number;
  /** Unit wind direction (x, z). */
  dx: number;
  dz: number;
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

/** Neutral movable obstacle spawn (boulder / lodestone); id is -1 while fractured. */
interface BoulderSpawn {
  id: EntityId;
  kind: 'boulder' | 'lodestone';
  x: number;
  z: number;
  radius: number;
  mass: number;
  material: MaterialId;
}

/** Water patch on the floor; `ice` is the plate entity while frozen (-1 when liquid). */
interface PoolState {
  id: number;
  owner: PlayerSlot;
  x: number;
  z: number;
  r: number;
  /** Liquid depth proxy 0..1. */
  depth: number;
  temp: number;
  ice: EntityId;
  /** Ticks of electrification left (shock zone). */
  electrified: number;
  charge: number;
  /** Ticks until a liquid pool soaks away (frozen plates melt by temperature instead). */
  ttl: number;
}

interface SteamState {
  id: number;
  owner: PlayerSlot;
  x: number;
  z: number;
  r: number;
  density: number;
  ttl: number;
  maxTtl: number;
}

interface FlameState {
  id: number;
  owner: PlayerSlot;
  x: number;
  z: number;
  r: number;
  ttl: number;
  maxTtl: number;
}

/** Element state of one body; absent = neutral (dry, ambient, uncharged). */
interface BodyElementState {
  wet: number;
  temp: number;
  charge: number;
  chargeTicks: number;
  /** Electromagnet ticks left (lodestones). */
  energized: number;
  /** Thermal shock ticks left (weakened stone). */
  shocked: number;
  veiled: boolean;
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
  /** Advanced-move picks per seat (defaults to DEFAULT_LOADOUT). */
  readonly loadouts?: readonly [readonly AbilityId[], readonly AbilityId[]];
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
  readonly pools: readonly PoolState[];
  readonly steams: readonly SteamState[];
  readonly flames: readonly FlameState[];
  readonly bodyEl: readonly (readonly [EntityId, BodyElementState])[];
  /** Deliberate spin of the core (rad/s about +y) that curves its path (ADR-0009). */
  readonly coreSpin?: number;
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
 * Fixed tick order (documented in docs/decisions/ADR-0004-tick-order.md, ADR-0006):
 *   1. drain queued intents (slot order alternates by tick parity) -> validate -> apply
 *   2. move manipulators toward their targets at the capped speed
 *   3. element stage: flames drift/heat, pools mix/relax/freeze/melt/boil, steam spreads,
 *      bodies wet/dry/cool (material conversions that change colliders happen here)
 *   4. accumulate sustained fields (hover + steam lift, lift, sweep, magnet, energized
 *      lodestones, gravity wells, pool drag, shock zones, steam updraft) -> clamp -> impulses
 *   5. Rapier fixed step (dt = 1 / tickRate)
 *   6. impacts -> events, guard damage, ice shatter, stone fracture (with shards)
 *   7. goal crossing test (playing phase only)
 *   8. timers: effects, entities, cooldowns, energy, match clock and phase transitions
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
  private pools: PoolState[] = [];
  private steams: SteamState[] = [];
  private flames: FlameState[] = [];
  private readonly bodyEl = new Map<EntityId, BodyElementState>();
  private readonly pull = { x: 0, y: 0, z: 0 };
  /** Velocities of movable bodies just before the physics step (fracture pass-through). */
  private readonly preVel = new Map<EntityId, { x: number; y: number; z: number }>();
  /** Each manipulator's velocity this tick (m/s), from its capped motion: the hand's velocity. */
  private readonly handVel: [{ x: number; z: number }, { x: number; z: number }] = [
    { x: 0, z: 0 },
    { x: 0, z: 0 },
  ];
  /**
   * The core's deliberate spin (rad/s about +y): set by a twisting grip, decaying, scrubbed by
   * hard contacts. Only this spin curves the core — collision spin does not, so rebounds stay
   * predictable and a curve is always a player's act.
   */
  private coreSpin = 0;
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
      this.pools = s.pools.map((x) => ({ ...x }));
      this.steams = s.steams.map((x) => ({ ...x }));
      this.flames = s.flames.map((x) => ({ ...x }));
      for (const [id, st] of s.bodyEl) this.bodyEl.set(id, { ...st });
      this.coreSpin = s.coreSpin ?? 0;
      return;
    }
    this.physics = new PhysicsWorld(this.rules, this.arena);
    this.rng = new Rng(this.seed);
    const core = this.rules.core;
    this.coreId = this.physics.createCore(core, 0, core.hoverHeight, 0);
    this.prevCore = { x: 0, y: core.hoverHeight, z: 0 };
    for (const o of this.arena.obstacles) {
      if (o.kind === 'pillar') continue;
      const spawn: BoulderSpawn = {
        id: -1,
        kind: o.kind,
        x: o.x,
        z: o.z,
        radius: o.radius,
        mass: o.mass,
        material: o.material,
      };
      this.spawnObstacle(spawn);
      this.boulders.push(spawn);
    }
    this.players = [this.freshPlayer(0), this.freshPlayer(1)];
    if (opts.loadouts) {
      // Validated like setLoadout (invalid picks keep the default).
      for (const slot of [0, 1] as const) this.applyLoadout(slot, opts.loadouts[slot]);
    }
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
      loadout: [...DEFAULT_LOADOUT],
      hand: { ...NEUTRAL_HAND },
      grasp: null,
      regrip: 0,
      hv: { x: 0, z: 0 },
    };
  }

  private spawnObstacle(s: BoulderSpawn): void {
    s.id =
      s.kind === 'lodestone'
        ? this.physics.createLodestone(s.x, s.z, s.radius, s.mass)
        : this.physics.createBoulder(s.x, s.z, s.radius, s.mass, s.material);
  }

  /**
   * Chooses a seat's advanced moves (LOADOUT_SIZE distinct, available advanced abilities). Invalid
   * picks are refused and the current loadout is kept. Only allowed outside live play.
   */
  setLoadout(slot: PlayerSlot, picks: readonly AbilityId[]): boolean {
    if (this.match.phase === 'playing' || this.match.phase === 'countdown') return false;
    return this.applyLoadout(slot, picks);
  }

  private applyLoadout(slot: PlayerSlot, picks: readonly AbilityId[]): boolean {
    const unique = [...new Set(picks)];
    if (unique.length !== LOADOUT_SIZE) return false;
    for (const id of unique) {
      if (!isAdvancedAbility(id) || !this.abilities[id].available || !IMPLEMENTED.includes(id))
        return false;
    }
    this.players[slot].loadout = unique as AdvancedAbilityId[];
    return true;
  }

  loadout(slot: PlayerSlot): readonly AdvancedAbilityId[] {
    return this.players[slot].loadout;
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
      for (const p of this.players) {
        this.releaseHold(p, false);
        this.releaseGrasp(p, false);
      }
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
      this.releaseGrasp(p, true);
      p.hand = { ...NEUTRAL_HAND };
      p.hv = { x: 0, z: 0 };
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

    // 3. element regions and body states
    this.stepElements();

    // 4. fields
    this.applyFields();

    // 5. physics
    this.preVel.clear();
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
      const b = this.physics.body(e.id);
      if (b) this.preVel.set(e.id, { ...b.linvel() });
    }
    const { impacts, invalid } = this.physics.step();
    for (const id of invalid) this.recoverInvalidBody(id);

    // 6. impacts: guard damage, ice shatter, stone fracture
    for (const imp of impacts) {
      this.emit({
        type: 'impact',
        a: imp.a,
        b: imp.b,
        p: [q3(imp.x), q3(imp.y), q3(imp.z)],
        impulse: q3(imp.impulse),
      });
      this.onImpact(imp.a, imp.impulse, imp.b);
      if (imp.b >= 0) this.onImpact(imp.b, imp.impulse, imp.a);
    }

    // 7. goals
    const core = this.physics.body(this.coreId);
    if (core) {
      const t = core.translation();
      if (this.match.phase === 'playing') {
        const scorer = detectGoalCrossing(this.prevCore, t, this.arena, this.rules.core);
        if (scorer !== null) this.onGoal(scorer, t);
      }
      this.prevCore = { x: t.x, y: t.y, z: t.z };
    }

    // 8. timers
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
    // The continuous hand channel (ADR-0009): a description of the hand, clamped; never a force.
    if (intent.hand) {
      p.hand = {
        grip: clamp(finite(intent.hand.grip), 0, 1),
        push: clamp(finite(intent.hand.push), -1, 1),
        twist: clamp(finite(intent.hand.twist), -1, 1),
        tick,
      };
    }

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
    if (isAdvancedAbility(ability) && !p.loadout.includes(ability)) return deny('not_available');
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
        outcome = this.castSweep(p, intent.modifier, intent.dir);
        break;
      case 'guard':
        outcome = this.castGuard(p, intent.dir);
        break;
      case 'lift':
        outcome = this.startLift(p);
        break;
      case 'infuse':
        outcome = this.castInfuse(p, intent.modifier);
        break;
      case 'freeze':
        outcome = this.castFreeze(p);
        break;
      case 'charge':
        outcome = this.castCharge(p);
        break;
      case 'gravity':
        outcome = this.castGravity(p);
        break;
      case 'magnetize':
        outcome = this.startMagnetize(p);
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
    // Release into the shot: a pulse ends the caster's own lift or grip so the body can fly.
    if (p.hold?.ability === 'lift') this.releaseHold(p, true);
    this.releaseGrasp(p, true);
    const loftHeight = this.rules.core.hoverHeight + def.loftThreshold;
    let coreMag = 0;
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
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
      // Elevated bodies (e.g. lifted) are lofted into a ballistic arc: the lob shot.
      const ny = t.y > loftHeight ? def.loft : def.lift;
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

  private castSweep(
    p: PlayerState,
    modifier: number | undefined,
    dir: readonly [number, number] | undefined,
  ): RejectReason | null {
    const def = this.abilities.sweep;
    if (this.effects.length >= this.rules.limits.maxActiveEffects) return 'limit';
    const sign = modifier !== undefined && modifier < 0 ? -1 : 1;
    // Default wind: to the caster's left (+1) or right (-1) relative to their attack direction.
    // Slot 0 attacks +X, so its left is -Z; slot 1 attacks -X, so its left is +Z.
    let dx = 0;
    let dz = (p.slot === 0 ? -1 : 1) * sign;
    if (dir && Number.isFinite(dir[0]) && Number.isFinite(dir[1])) {
      const len = length2(dir[0], dir[1]);
      if (len > 0.2) {
        dx = dir[0] / len;
        dz = dir[1] / len;
      }
    }
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
      dx,
      dz,
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
    // Moving bodies are tested against the barrier's oriented box using their true positions
    // (the broad-phase is only refreshed during a step); other guards must not stack.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const e of this.physics.entities.values()) {
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      if (e.kind === 'guard') {
        if (length2(t.x - x, t.z - z) < def.halfWidth * 1.2) return 'illegal_target';
        continue;
      }
      // Into the guard's local frame: local X = (cos, -sin), local Z = (sin, cos) for yaw θ.
      const rx = t.x - x;
      const rz = t.z - z;
      const lx = rx * cos - rz * sin;
      const lz = rx * sin + rz * cos;
      const cx = clamp(lx, -half[0], half[0]);
      const cz = clamp(lz, -half[2], half[2]);
      const cy = clamp(t.y, 0, half[1] * 2);
      const d = Math.sqrt((lx - cx) ** 2 + (lz - cz) ** 2 + (t.y - cy) ** 2);
      if (d < e.radius + 0.05) return 'illegal_target';
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
    this.releaseGrasp(p, true);
    const def = this.abilities.lift;
    let best: EntityId = -1;
    let bestD = Infinity;
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
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

  /* ---------------------------------------------------------------------------------------- */
  /* Element casts (Phase 04)                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  private castEvent(p: PlayerState, ability: AbilityId, phase: 'tap' | 'start', mag: number): void {
    this.emit({
      type: 'cast',
      slot: p.slot,
      ability,
      phase,
      p: [q3(p.mx), q3(this.rules.manipulator.height), q3(p.mz)],
      mag: q3(mag),
    });
  }

  private react(
    kind: ReactionKind,
    x: number,
    y: number,
    z: number,
    mag: number,
    entity: EntityId,
    effect: number,
  ): void {
    this.emit({
      type: 'reaction',
      kind,
      p: [q3(x), q3(y), q3(z)],
      mag: q3(mag),
      entity,
      effect,
    });
  }

  private bodyState(id: EntityId): BodyElementState {
    let st = this.bodyEl.get(id);
    if (!st) {
      st = {
        wet: 0,
        temp: this.rules.elements.ambientTemp,
        charge: 0,
        chargeTicks: 0,
        energized: 0,
        shocked: 0,
        veiled: false,
      };
      this.bodyEl.set(id, st);
    }
    return st;
  }

  /** Element-bearing bodies within `radius` (horizontal, plus body radius) of (x, z), by id. */
  private elementalNear(x: number, z: number, radius: number): EntityId[] {
    const out: EntityId[] = [];
    for (const e of this.physics.entities.values()) {
      if (!ELEMENTAL.has(e.kind)) continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      if (length2(t.x - x, t.z - z) <= radius + e.radius) out.push(e.id);
    }
    return out.sort((a, b) => a - b);
  }

  /** Hot stone that is suddenly wetted or chilled cracks internally (weaker until it recovers). */
  private quench(id: EntityId, st: BodyElementState): void {
    const e = this.physics.entities.get(id);
    if (!e || (e.material !== 'basaltFractured' && e.material !== 'basalt')) return;
    st.shocked = this.ticks(this.rules.elements.body.shockedSeconds);
    const b = this.physics.body(id);
    const t = b ? b.translation() : { x: 0, y: 0, z: 0 };
    this.react('quench', t.x, t.y, t.z, st.temp, id, -1);
  }

  private castInfuse(p: PlayerState, modifier: number | undefined): RejectReason | null {
    const element = INFUSE_ELEMENTS[modifier ?? 0];
    if (element === undefined) return 'invalid';
    const outcome = element === 'wet' ? this.infuseWet(p) : this.infuseHeat(p);
    if (!outcome) this.castEvent(p, 'infuse', 'tap', modifier ?? 0);
    return outcome;
  }

  /** WET: adds water at the force point (deepening a pool it lands in) and soaks bodies in reach. */
  private infuseWet(p: PlayerState): RejectReason | null {
    const el = this.rules.elements;
    const x = p.mx;
    const z = p.mz;
    let pool: PoolState | undefined;
    let best = Infinity;
    for (const q of this.pools) {
      if (q.ice >= 0) continue;
      const d = length2(q.x - x, q.z - z);
      if (d <= q.r + 0.6 && d < best) {
        best = d;
        pool = q;
      }
    }
    const add = el.pool.depthPerInfuse;
    if (pool) {
      pool.temp = (pool.temp * pool.depth + el.ambientTemp * add) / (pool.depth + add);
      pool.depth = Math.min(1, pool.depth + add);
      pool.r = Math.min(el.pool.maxRadius, pool.r + el.pool.growPerInfuse);
      pool.ttl = this.ticks(el.pool.lifetimeSeconds);
    } else {
      if (this.pools.length >= el.maxPools) return 'limit';
      pool = {
        id: this.nextEffectId++,
        owner: p.slot,
        x,
        z,
        r: el.pool.radius,
        depth: add,
        temp: el.ambientTemp,
        ice: -1,
        electrified: 0,
        charge: 0,
        ttl: this.ticks(el.pool.lifetimeSeconds),
      };
      this.pools.push(pool);
    }
    for (const id of this.elementalNear(x, z, el.infuse.radius)) {
      const st = this.bodyState(id);
      const gain = 1 - st.wet;
      st.wet = 1;
      if (gain >= 0.3 && st.temp >= el.infuse.quenchTemp) this.quench(id, st);
    }
    // Water on fire puts it out.
    this.flames = this.flames.filter((f) => {
      if (length2(f.x - x, f.z - z) > el.infuse.radius + f.r * 0.5) return true;
      this.react('douse', f.x, 0.3, f.z, 1, -1, f.id);
      return false;
    });
    this.react('soak', x, 0.05, z, pool.depth, -1, pool.id);
    return null;
  }

  /** HEAT: instant heat in reach plus a lingering flame (which the wind can carry). */
  private infuseHeat(p: PlayerState): RejectReason | null {
    const el = this.rules.elements;
    const x = p.mx;
    const z = p.mz;
    const R = el.infuse.radius;
    for (const q of this.pools) {
      if (length2(q.x - x, q.z - z) <= R + q.r * 0.5) q.temp += el.infuse.heatDelta;
    }
    for (const id of this.elementalNear(x, z, R)) this.bodyState(id).temp += el.infuse.heatDelta;
    if (this.flames.length >= el.maxFlames) this.flames.shift();
    const ttl = this.ticks(el.flame.lifetimeSeconds);
    const flame: FlameState = {
      id: this.nextEffectId++,
      owner: p.slot,
      x,
      z,
      r: el.flame.radius,
      ttl,
      maxTtl: ttl,
    };
    this.flames.push(flame);
    this.react('ignite', x, 0.4, z, el.infuse.heatDelta, -1, flame.id);
    return null;
  }

  /** FREEZE: a cold blast; pools below freezing become ice plates (next element step). */
  private castFreeze(p: PlayerState): RejectReason | null {
    const el = this.rules.elements;
    const x = p.mx;
    const z = p.mz;
    const R = el.freeze.radius;
    for (const q of this.pools) {
      if (length2(q.x - x, q.z - z) <= R + q.r * 0.5) q.temp += el.freeze.coolDelta;
    }
    for (const id of this.elementalNear(x, z, R)) {
      const st = this.bodyState(id);
      const before = st.temp;
      st.temp += el.freeze.coolDelta;
      if (before >= el.infuse.quenchTemp) this.quench(id, st);
    }
    this.flames = this.flames.filter((f) => {
      if (length2(f.x - x, f.z - z) > R + f.r * 0.5) return true;
      this.react('douse', f.x, 0.3, f.z, 1, -1, f.id);
      return false;
    });
    this.react('chill', x, 0.3, z, -el.freeze.coolDelta, -1, -1);
    this.castEvent(p, 'freeze', 'tap', 1);
    return null;
  }

  /**
   * CHARGE: one discharge from the force point over the contact graph of conductors (liquid
   * pools, metal, the core, and stone only while wet). Electrified pools become shock zones, a
   * wet guard reached with enough charge overloads, and a charged lodestone becomes an
   * electromagnet. Nothing conductive in reach = refused (no energy spent).
   */
  private castCharge(p: PlayerState): RejectReason | null {
    const el = this.rules.elements;
    const conductors: Conductor[] = [];
    const refs: ({ pool: PoolState } | { id: EntityId })[] = [];
    for (const q of this.pools) {
      if (q.ice >= 0) continue;
      conductors.push({ key: `p${pad(q.id)}`, x: q.x, y: 0, z: q.z, r: q.r, flat: true });
      refs.push({ pool: q });
    }
    const ids = [...this.physics.entities.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const e = this.physics.entities.get(id)!;
      if (!ELEMENTAL.has(e.kind)) continue;
      const wet = this.bodyEl.get(id)?.wet ?? 0;
      if (
        MATERIALS[e.material].conductivity < el.charge.dryConductivity &&
        wet < el.charge.wetConductive
      )
        continue;
      const b = this.physics.body(id);
      if (!b) continue;
      const t = b.translation();
      conductors.push({ key: `b${pad(id)}`, x: t.x, y: t.y, z: t.z, r: e.radius, flat: false });
      refs.push({ id });
    }
    const res = discharge(conductors, p.mx, p.mz, el.charge, el.pool.contactHeight);
    if (res.order.length === 0) return 'out_of_range';

    const nodes: Vec3[] = [];
    const q: number[] = [];
    const indexOf = new Map<number, number>();
    for (const i of res.order) {
      const c = conductors[i]!;
      indexOf.set(i, nodes.length);
      nodes.push([q3(c.x), q3(c.flat ? 0.05 : c.y), q3(c.z)]);
      q.push(q3(res.charge[i]!));
    }
    const links = res.links.map(
      ([from, to]) => [from < 0 ? -1 : indexOf.get(from)!, indexOf.get(to)!] as const,
    );
    this.emit({
      type: 'charge',
      slot: p.slot,
      nodes,
      q,
      links,
      p: [q3(p.mx), q3(this.rules.manipulator.height), q3(p.mz)],
    });

    for (const i of res.order) {
      const charge = res.charge[i]!;
      const ref = refs[i]!;
      if ('pool' in ref) {
        const pool = ref.pool;
        pool.charge = Math.max(pool.charge, charge);
        pool.electrified = this.ticks(el.charge.electrifiedSeconds);
        this.react('shock', pool.x, 0.05, pool.z, charge, -1, pool.id);
        continue;
      }
      const e = this.physics.entities.get(ref.id);
      if (!e) continue;
      const st = this.bodyState(ref.id);
      st.charge = Math.max(st.charge, charge);
      st.chargeTicks = this.ticks(el.charge.chargeSeconds);
      const b = this.physics.body(ref.id);
      const t = b ? b.translation() : { x: 0, y: 0, z: 0 };
      if (e.kind === 'guard' && charge >= el.charge.guardOverload) {
        this.react('overload', t.x, t.y, t.z, charge, ref.id, -1);
        this.despawn(ref.id, 'broken');
        this.bodyEl.delete(ref.id);
      } else if (e.kind === 'lodestone' && charge >= el.charge.energizeThreshold) {
        st.energized = this.ticks(el.charge.energizedSeconds);
        this.react('energize', t.x, t.y, t.z, charge, ref.id, -1);
      }
    }
    this.castEvent(p, 'charge', 'tap', res.order.length);
    return null;
  }

  /** GRAVITY: a short-lived softened well at the force point (own half + midline reach). */
  private castGravity(p: PlayerState): RejectReason | null {
    const def = this.abilities.gravity;
    if (this.effects.length >= this.rules.limits.maxActiveEffects) return 'limit';
    const ttl = this.ticks(def.durationSeconds);
    const well: EffectState = {
      id: this.nextEffectId++,
      kind: 'well',
      owner: p.slot,
      x: p.mx,
      z: p.mz,
      radius: this.rules.elements.gravity.radius,
      ttl,
      maxTtl: ttl,
      sign: 1,
      dx: 0,
      dz: 0,
    };
    this.effects.push(well);
    this.react('well', p.mx, this.rules.elements.gravity.height, p.mz, 1, -1, well.id);
    this.castEvent(p, 'gravity', 'tap', 1);
    return null;
  }

  /** MAGNETIZE (hold): needs a lodestone in range; the pull is applied in the field stage. */
  private startMagnetize(p: PlayerState): RejectReason | null {
    if (p.hold) return 'invalid';
    const range = this.rules.elements.magnet.range;
    let near = false;
    for (const e of this.physics.entities.values()) {
      if (e.kind !== 'lodestone') continue;
      const b = this.physics.body(e.id);
      if (b && length2(b.translation().x - p.mx, b.translation().z - p.mz) <= range) near = true;
    }
    if (!near) return 'out_of_range';
    p.hold = { ability: 'magnetize', target: -1, ticks: 0 };
    this.castEvent(p, 'magnetize', 'start', 1);
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
    const rate = this.rules.match.tickRate;
    const maxStep = this.rules.manipulator.maxSpeed / rate;
    for (const p of this.players) {
      const x0 = p.mx;
      const z0 = p.mz;
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
      const v = this.handVel[p.slot];
      v.x = (p.mx - x0) * rate;
      v.z = (p.mz - z0) * rate;
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Continuous manipulation (ADR-0009)                                                        */
  /* ---------------------------------------------------------------------------------------- */

  /** The hand state in force this tick: an open, still hand once it has gone stale. */
  private handNow(p: PlayerState): Readonly<HandReading> {
    const stale = this.tickNo - p.hand.tick > this.ticks(this.rules.hand.staleSeconds);
    return stale || !p.connected ? NEUTRAL_HAND : p.hand;
  }

  /** Hand forces scale with mass like a force would, within limits (the core's mass is 1). */
  private handMassScale(mass: number): number {
    return clamp(this.rules.core.mass / mass, 0.25, 1.25);
  }

  /** Grips, carries, sweeps and pushes for both seats. Returns true while the core is gripped. */
  private applyHands(): boolean {
    if (this.match.phase !== 'playing') {
      for (const p of this.players) this.releaseGrasp(p, true);
      return false;
    }
    const H = this.rules.hand;
    let coreHeld = false;
    for (const p of this.players) {
      const hand = this.handNow(p);
      // Only a described hand acts: keys, touch and the bot move a force point, never a hand.
      const present = hand !== NEUTRAL_HAND;
      this.trackHand(p, present);
      if (!p.grasp && !p.hold && p.regrip === 0 && hand.grip >= H.engageGrip) this.startGrasp(p);
      if (p.grasp) {
        // A gripping hand neither sweeps nor pushes: everything goes into the hold.
        if (this.carry(p, hand) && p.grasp?.target === this.coreId) coreHeld = true;
        continue;
      }
      if (present) this.sweepAndPush(p, hand);
    }
    return coreHeld;
  }

  /**
   * Smooths the force point's motion into the hand's velocity: a jittering tracked hand held
   * still averages out to rest, while a stroke or a swing comes through (lagging ~0.1 s).
   */
  private trackHand(p: PlayerState, present: boolean): void {
    if (!present) {
      p.hv.x = p.hv.z = 0;
      return;
    }
    const raw = this.handVel[p.slot];
    const a = 1 - Math.exp(-this.physics.dt / this.rules.hand.velocitySmoothing);
    p.hv.x += (raw.x - p.hv.x) * a;
    p.hv.z += (raw.z - p.hv.z) * a;
  }

  /** Closes the hand on the nearest movable body within reach (the core favoured). */
  private startGrasp(p: PlayerState): void {
    const H = this.rules.hand;
    // Not without the energy for a moment of holding (no grip that lets go the next tick).
    if (p.energy < H.holdCostPerSecond * 0.25) return;
    let best: EntityId = -1;
    let bestD = Infinity;
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
      if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      const d = length2(t.x - p.mx, t.z - p.mz) - (e.kind === 'core' ? H.coreBias : 0);
      if (d < bestD) {
        bestD = d;
        best = e.id;
      }
    }
    if (best < 0 || bestD > H.reach) return;
    p.grasp = { target: best, ticks: 0 };
    this.emitGrip(p, 'start', best);
  }

  /**
   * One tick of a hold: a spring–damper from the body to the hand that also matches the hand's
   * velocity, stiffer the more the hand is closed, with gravity support. Twisting spins the body
   * (and gives the core a curving spin). Returns false when the hand let go.
   */
  private carry(p: PlayerState, hand: Readonly<HandReading>): boolean {
    const H = this.rules.hand;
    const grasp = p.grasp!;
    const body = this.physics.body(grasp.target);
    if (!body || hand.grip <= H.releaseGrip) {
      this.releaseGrasp(p, true);
      return false;
    }
    const t = body.translation();
    const v = body.linvel();
    if (length2(t.x - p.mx, t.z - p.mz) > H.breakDistance) {
      this.releaseGrasp(p, true);
      return false;
    }
    const dt = this.physics.dt;
    const mass = body.mass();
    const ms = this.handMassScale(mass);
    const firm = smoothstep01((hand.grip - H.releaseGrip) / (1 - H.releaseGrip));
    const k = (H.stiffness[0] + (H.stiffness[1] - H.stiffness[0]) * firm) * ms;
    const c = 2 * H.dampingRatio * Math.sqrt(k);
    const vm = p.hv;
    let ax = k * (p.mx - t.x) + c * (vm.x - v.x);
    let ay = k * (H.holdHeight - t.y) - c * v.y;
    let az = k * (p.mz - t.z) + c * (vm.z - v.z);
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    const cap = H.maxHoldAcceleration * ms;
    if (mag > cap) {
      const sc = cap / mag;
      ax *= sc;
      ay *= sc;
      az *= sc;
    }
    const work = Math.min(mag, cap) * (mass / this.rules.core.mass);
    const cost = (H.holdCostPerSecond + H.workCost * work) * dt;
    if (p.energy < cost) {
      this.releaseGrasp(p, true);
      return false;
    }
    this.spend(p, cost);
    this.accumulate(grasp.target, ax, ay + this.rules.gravity, az);
    // A clockwise wrist turn (positive twist, as the player sees it) spins the body clockwise
    // seen from above (−y), so a thrown core bends to the right of its motion.
    const twist = deadZone(hand.twist, H.twistDeadZone);
    if (twist !== 0) {
      const spin = -twist * H.maxSpin;
      const w = body.angvel();
      const dw = (spin - w.y) * Math.min(1, H.spinGain * dt);
      body.applyTorqueImpulse({ x: 0, y: body.principalInertia().y * dw, z: 0 }, true);
      if (grasp.target === this.coreId) {
        this.coreSpin += (spin - this.coreSpin) * Math.min(1, H.spinGain * dt);
      }
    }
    grasp.ticks++;
    return true;
  }

  /**
   * An open hand: moving, it drags nearby bodies along its motion (only where it moves faster
   * than they do — a still hand brakes nothing); pushing toward the screen presses bodies away
   * from it, drawing back pulls them in.
   */
  private sweepAndPush(p: PlayerState, hand: Readonly<HandReading>): void {
    const H = this.rules.hand;
    const vm = p.hv;
    const speed = length2(vm.x, vm.z);
    // A stroke fades in above the threshold speed (no kick at it); slower motion drags nothing.
    const stroke = smoothstep01((speed - H.minSweepSpeed) / H.minSweepSpeed);
    const sweeping = stroke > 0;
    const push = deadZone(hand.push, H.pushDeadZone);
    if (!sweeping && push === 0) return;
    const ux = sweeping ? vm.x / speed : 0;
    const uz = sweeping ? vm.z / speed : 0;
    const dt = this.physics.dt;
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
      if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
      const body = this.physics.body(e.id);
      if (!body) continue;
      const t = body.translation();
      const dx = t.x - p.mx;
      const dz = t.z - p.mz;
      const r = length2(dx, dz);
      const mass = body.mass();
      const ms = this.handMassScale(mass);
      let ax = 0;
      let az = 0;
      if (sweeping && r < H.sweepRadius) {
        const v = body.linvel();
        const along = (vm.x - v.x) * ux + (vm.z - v.z) * uz;
        if (along > 0) {
          const a =
            Math.min(H.maxSweepAcceleration, H.sweepGain * along) *
            smoothstep01(1 - r / H.sweepRadius) *
            stroke *
            ms;
          ax += ux * a;
          az += uz * a;
        }
      }
      if (push !== 0 && r < H.pushRadius) {
        // Away from the hand (toward it when pulling); at the hand itself, at the rival goal.
        const nx = r > 0.3 ? dx / r : p.slot === 0 ? 1 : -1;
        const nz = r > 0.3 ? dz / r : 0;
        const ease = push < 0 ? Math.min(1, r / 1.5) : 1;
        const a = H.pushAcceleration * push * smoothstep01(1 - r / H.pushRadius) * ms * ease;
        ax += nx * a;
        az += nz * a;
      }
      if (ax === 0 && az === 0) continue;
      const cost = H.workCost * length2(ax, az) * (mass / this.rules.core.mass) * dt;
      if (p.energy < cost) return;
      this.spend(p, cost);
      this.accumulate(e.id, ax, 0, az);
    }
  }

  /**
   * The core's curve: a Magnus-like side force from its deliberate spin, a = k · ω × v (ω about
   * +y), capped; the spin decays like the core's own angular damping. Not while it is held.
   */
  private applyCurve(coreHeld: boolean): void {
    if (this.coreSpin === 0) return;
    const H = this.rules.hand;
    const decay = Math.exp(-this.rules.core.angularDamping * this.physics.dt);
    if (!coreHeld) {
      const core = this.physics.body(this.coreId);
      if (core && this.match.phase === 'playing') {
        const v = core.linvel();
        let ax = H.magnus * this.coreSpin * v.z;
        let az = -H.magnus * this.coreSpin * v.x;
        const mag = length2(ax, az);
        if (mag > H.maxMagnusAcceleration) {
          ax *= H.maxMagnusAcceleration / mag;
          az *= H.maxMagnusAcceleration / mag;
        }
        this.accumulate(this.coreId, ax, 0, az);
      }
      this.coreSpin *= decay;
    }
    if (Math.abs(this.coreSpin) < 0.05) this.coreSpin = 0;
  }

  /** Opens the hand: the body keeps whatever velocity it has (letting go is how you throw). */
  private releaseGrasp(p: PlayerState, announce: boolean): void {
    if (!p.grasp) return;
    const target = p.grasp.target;
    p.grasp = null;
    p.regrip = this.ticks(this.rules.hand.regripSeconds);
    if (announce) this.emitGrip(p, 'end', target);
  }

  private emitGrip(p: PlayerState, phase: 'start' | 'end', entity: EntityId): void {
    const b = this.physics.body(entity);
    const t = b ? b.translation() : { x: p.mx, y: this.rules.manipulator.height, z: p.mz };
    const v = b ? b.linvel() : { x: 0, y: 0, z: 0 };
    this.emit({
      type: 'grip',
      slot: p.slot,
      phase,
      entity,
      p: [q3(t.x), q3(t.y), q3(t.z)],
      v: [q3(v.x), q3(v.y), q3(v.z)],
    });
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
      if (!h || h.ability !== 'lift') continue;
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

    // Continuous manipulation: grips, open-hand sweeps, push / pull; then the core's curve.
    if (this.applyHands()) coreLifted = true;
    this.applyCurve(coreLifted);

    // Sweeps (crosswind fields): smooth radial falloff, fade in/out, force-like mass scaling.
    if (this.effects.length > 0) {
      const def = this.abilities.sweep;
      for (const e of this.physics.entities.values()) {
        if (!MOVABLE.has(e.kind)) continue;
        if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
        const body = this.physics.body(e.id);
        if (!body) continue;
        const t = body.translation();
        const massScale = clamp(def.referenceMass / body.mass(), 0.2, 1.5);
        for (const fx of this.effects) {
          if (fx.kind !== 'sweep') continue;
          const r = length2(t.x - fx.x, t.z - fx.z);
          if (r >= fx.radius) continue;
          const life = Math.min(1, fx.ttl / 6, (fx.maxTtl - fx.ttl + 1) / 4);
          const k = 1 - r / fx.radius;
          const a = def.windAcceleration * (k * k * (3 - 2 * k)) * life * massScale;
          this.accumulate(e.id, fx.dx * a, 0, fx.dz * a);
        }
      }
    }

    this.applyElementFields();

    // Anti-stall drift: a slow core far from the centre line eases back toward it.
    const driftCore = this.physics.body(this.coreId);
    if (driftCore && !coreLifted && this.match.phase === 'playing') {
      const c = this.rules.core;
      const t = driftCore.translation();
      const v = driftCore.linvel();
      const speed = Math.hypot(v.x, v.z);
      if (speed < c.idleDriftSpeed && Math.abs(t.x) > c.idleDriftDeadZone) {
        const fade = Math.min(1, (Math.abs(t.x) - c.idleDriftDeadZone) / 2);
        this.accumulate(
          this.coreId,
          -Math.sign(t.x) * c.idleDriftAcceleration * (1 - speed / c.idleDriftSpeed) * fade,
          0,
          0,
        );
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
      // Steam carries the core higher (it can float over a barrier while inside the cloud).
      const floatY = c.hoverHeight + this.steamLift(t.x, t.y, t.z);
      if (t.y < floatY + c.hoverBand) {
        const v = core.linvel();
        const ay = clamp(g + c.hoverStiffness * (floatY - t.y) - c.hoverDamping * v.y, 0, 2.5 * g);
        core.applyImpulse({ x: 0, y: ay * core.mass() * dt, z: 0 }, true);
      }
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Entities                                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  /** Contact consequences: guards wear down, ice plates shatter, boulders fracture. */
  private onImpact(id: EntityId, impulse: number, striker: EntityId): void {
    const e = this.physics.entities.get(id);
    if (!e) return;
    // A hard contact scrubs most of the core's deliberate spin (its curve).
    if (id === this.coreId && impulse >= this.rules.hand.spinScrubImpulse)
      this.coreSpin *= this.rules.hand.spinKeptOnImpact;
    if (e.kind === 'guard') {
      e.damage += impulse;
      if (e.damage >= this.abilities.guard.breakImpulse) this.despawn(id, 'broken');
    } else if (e.kind === 'ice') {
      if (impulse >= this.rules.elements.ice.fractureImpulse) {
        this.shatterIce(id, impulse);
        this.passThrough(striker);
      }
    } else if (e.kind === 'boulder') {
      const st = this.bodyEl.get(id);
      const scale = st && st.shocked > 0 ? this.rules.elements.body.shockedFractureScale : 1;
      if (impulse >= MATERIALS[e.material].fractureImpulse * scale) {
        this.fractureBoulder(id, impulse);
        this.passThrough(striker);
      }
    }
  }

  /** The striker of a shattered body keeps most of its pre-impact velocity (no full bounce). */
  private passThrough(striker: EntityId): void {
    if (striker < 0) return;
    const e = this.physics.entities.get(striker);
    const pre = this.preVel.get(striker);
    const b = this.physics.body(striker);
    if (!e || !pre || !b || !MOVABLE.has(e.kind)) return;
    const v = b.linvel();
    const k = this.rules.elements.fracture.passThrough;
    b.setLinvel(
      { x: v.x + (pre.x - v.x) * k, y: v.y + (pre.y - v.y) * k, z: v.z + (pre.z - v.z) * k },
      true,
    );
  }

  /** A hard hit shatters an ice plate back into (colder, shallower) water. */
  private shatterIce(id: EntityId, impulse: number): void {
    const el = this.rules.elements;
    const pool = this.pools.find((q) => q.ice === id);
    this.despawn(id, 'broken');
    if (!pool) return;
    pool.ice = -1;
    pool.depth *= el.ice.shatterDepthKeep;
    pool.temp = el.freezeTemp + 2;
    pool.ttl = this.ticks(el.pool.lifetimeSeconds);
    this.react('shatter', pool.x, el.ice.height, pool.z, impulse, id, pool.id);
  }

  /**
   * Stone breaks when an impact exceeds its fracture impulse (lower while thermally shocked).
   * Up to `maxShards` physical fragments spawn if the body budget allows; the boulder itself is
   * rebuilt at the next kickoff.
   */
  private fractureBoulder(id: EntityId, impulse: number): void {
    const fr = this.rules.elements.fracture;
    const e = this.physics.entities.get(id);
    const b = this.physics.body(id);
    if (!e || !b) return;
    const t = { ...b.translation() };
    const v = { ...b.linvel() };
    const spawn = this.boulders.find((s) => s.id === id);
    this.despawn(id, 'broken');
    if (spawn) spawn.id = -1;
    this.react('fracture', t.x, t.y, t.z, impulse, id, -1);
    const room = this.rules.limits.maxDynamicBodies - this.physics.entityCount;
    const n = Math.min(fr.maxShards, Math.max(0, room));
    const ttl = this.ticks(fr.shardLifetimeSeconds);
    const off = e.radius * 0.6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng.range(-0.4, 0.4);
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      const x = t.x + cx * off;
      const y = Math.max(fr.shardRadius, t.y);
      const z = t.z + cz * off;
      const sid = this.physics.createShard(
        x,
        y,
        z,
        fr.shardRadius,
        fr.shardMass,
        v.x + cx * fr.splitSpeed,
        v.y + 1.2,
        v.z + cz * fr.splitSpeed,
        ttl,
      );
      this.emit({ type: 'spawn', entity: sid, kind: 'shard', p: [q3(x), q3(y), q3(z)] });
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Element stage (Phase 04)                                                                  */
  /* ---------------------------------------------------------------------------------------- */

  /** Crosswind acceleration at a point (sum of active SWEEP fields, no mass scaling). */
  private windAt(x: number, z: number): { x: number; z: number } {
    let wx = 0;
    let wz = 0;
    const def = this.abilities.sweep;
    for (const fx of this.effects) {
      if (fx.kind !== 'sweep') continue;
      const r = length2(x - fx.x, z - fx.z);
      if (r >= fx.radius) continue;
      const life = Math.min(1, fx.ttl / 6, (fx.maxTtl - fx.ttl + 1) / 4);
      const k = 1 - r / fx.radius;
      const a = def.windAcceleration * (k * k * (3 - 2 * k)) * life;
      wx += fx.dx * a;
      wz += fx.dz * a;
    }
    return { x: wx, z: wz };
  }

  /**
   * Flames drift with the wind and heat what they overlap; pools exchange heat, relax toward
   * ambient and change phase with hysteresis (freeze at ≤ freezeTemp, melt at ≥ meltTemp, boil
   * at ≥ boilTemp); steam spreads and thins; bodies get wet, dry and return to ambient. Each
   * transition emits exactly one reaction event.
   */
  private stepElements(): void {
    if (
      this.pools.length === 0 &&
      this.steams.length === 0 &&
      this.flames.length === 0 &&
      this.bodyEl.size === 0
    )
      return;
    const el = this.rules.elements;
    const dt = this.physics.dt;
    const L = this.arena.halfLength;
    const W = this.arena.halfWidth;

    for (const f of this.flames) {
      const w = this.windAt(f.x, f.z);
      f.x = clamp(f.x + w.x * el.flame.windDrift * dt, -L, L);
      f.z = clamp(f.z + w.z * el.flame.windDrift * dt, -W, W);
      let burn = 1;
      for (const pool of this.pools) {
        const k = discWeight(length2(f.x - pool.x, f.z - pool.z), pool.r + f.r * 0.5);
        if (k <= 0) continue;
        pool.temp += el.flame.heatPerSecond * k * dt;
        if (pool.ice < 0) burn = el.flame.douseFactor;
      }
      for (const e of this.physics.entities.values()) {
        if (!ELEMENTAL.has(e.kind)) continue;
        const b = this.physics.body(e.id);
        if (!b) continue;
        const t = b.translation();
        if (t.y - e.radius > 1.5) continue;
        const k = discWeight(length2(t.x - f.x, t.z - f.z), f.r + e.radius);
        if (k > 0) this.bodyState(e.id).temp += el.flame.heatPerSecond * k * dt;
      }
      f.ttl -= burn;
      if (f.ttl <= 0 && burn > 1) this.react('douse', f.x, 0.3, f.z, 1, -1, f.id);
    }
    if (this.flames.length > 0) this.flames = this.flames.filter((f) => f.ttl > 0);

    const mix = 1 - Math.exp(-el.poolMixPerSecond * dt);
    for (let i = 0; i < this.pools.length; i++) {
      for (let j = i + 1; j < this.pools.length; j++) {
        const a = this.pools[i]!;
        const b = this.pools[j]!;
        if (length2(a.x - b.x, a.z - b.z) > a.r + b.r) continue;
        const d = (b.temp - a.temp) * mix * 0.5;
        a.temp += d;
        b.temp -= d;
      }
    }
    for (const pool of [...this.pools]) {
      pool.temp = relaxToward(pool.temp, el.ambientTemp, el.ambientRelaxPerSecond, dt);
      if (pool.electrified > 0 && --pool.electrified === 0) pool.charge = 0;
      if (pool.ice >= 0) {
        if (pool.temp >= el.meltTemp) this.meltPool(pool);
        continue;
      }
      if (pool.temp >= el.boilTemp) {
        this.boilPool(pool);
        continue;
      }
      if (pool.temp <= el.freezeTemp) {
        this.freezePool(pool);
        if (pool.ice >= 0) continue;
      }
      if (--pool.ttl <= 0) this.pools = this.pools.filter((q) => q !== pool);
    }

    for (const st of this.steams) {
      st.ttl--;
      st.r = Math.min(el.steam.maxRadius, st.r + el.steam.spreadPerSecond * dt);
    }
    if (this.steams.length > 0) this.steams = this.steams.filter((st) => st.ttl > 0);

    for (const e of this.physics.entities.values()) {
      if (!ELEMENTAL.has(e.kind)) continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      let soak = 0;
      if (t.y - e.radius <= el.pool.contactHeight) {
        for (const pool of this.pools) {
          if (pool.ice >= 0 || length2(t.x - pool.x, t.z - pool.z) > pool.r) continue;
          soak = Math.max(soak, el.pool.wetPerSecond * pool.depth * dt);
        }
      }
      let veiled = false;
      for (const sc of this.steams) {
        if (t.y <= el.steam.ceiling && length2(t.x - sc.x, t.z - sc.z) <= sc.r) veiled = true;
      }
      let st = this.bodyEl.get(e.id);
      if (!st) {
        if (soak === 0 && !veiled) continue;
        st = this.bodyState(e.id);
      }
      const wasWet = st.wet;
      if (soak > 0) st.wet = Math.min(1, st.wet + soak);
      else if (st.wet > 0) {
        const hot = Math.max(0, st.temp - el.body.heatDryingStart) / el.body.heatDryingStart;
        st.wet = Math.max(0, st.wet - el.body.wetDecayPerSecond * dt * (1 + hot));
      }
      if (wasWet < 0.3 && st.wet >= 0.3 && st.temp >= el.infuse.quenchTemp) this.quench(e.id, st);
      st.temp = relaxToward(st.temp, el.ambientTemp, el.ambientRelaxPerSecond, dt);
      if (st.chargeTicks > 0 && --st.chargeTicks === 0) st.charge = 0;
      if (st.energized > 0) st.energized--;
      if (st.shocked > 0) st.shocked--;
      st.veiled = veiled;
      if (
        st.wet < 0.005 &&
        Math.abs(st.temp - el.ambientTemp) < 0.5 &&
        st.charge === 0 &&
        st.energized === 0 &&
        st.shocked === 0 &&
        !veiled
      )
        this.bodyEl.delete(e.id);
    }
  }

  private freezePool(pool: PoolState): void {
    const el = this.rules.elements;
    // A plate never forms around a body (it would be trapped in a fixed collider): wait.
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      if (
        t.y - e.radius < el.ice.height + 0.05 &&
        length2(t.x - pool.x, t.z - pool.z) < pool.r + e.radius
      )
        return;
    }
    if (this.physics.entityCount >= this.rules.limits.maxDynamicBodies) return;
    const id = this.physics.createIcePlate(
      pool.x,
      pool.z,
      pool.r,
      el.ice.height,
      el.ice.topScale,
      el.ice.restitution,
      el.ice.friction,
    );
    if (id < 0) return;
    pool.ice = id;
    pool.electrified = 0;
    pool.charge = 0;
    this.emit({
      type: 'spawn',
      entity: id,
      kind: 'ice',
      p: [q3(pool.x), q3(el.ice.height / 2), q3(pool.z)],
    });
    this.react('freeze', pool.x, el.ice.height, pool.z, pool.depth, id, pool.id);
  }

  private meltPool(pool: PoolState): void {
    const id = pool.ice;
    pool.ice = -1;
    pool.ttl = this.ticks(this.rules.elements.pool.lifetimeSeconds);
    this.despawn(id, 'expired');
    this.react('melt', pool.x, 0.1, pool.z, pool.depth, id, pool.id);
  }

  private boilPool(pool: PoolState): void {
    const el = this.rules.elements;
    this.pools = this.pools.filter((q) => q !== pool);
    if (this.steams.length >= el.maxSteams) this.steams.shift();
    const ttl = this.ticks(el.steam.lifetimeSeconds);
    const steam: SteamState = {
      id: this.nextEffectId++,
      owner: pool.owner,
      x: pool.x,
      z: pool.z,
      r: pool.r + 0.4,
      density: clamp(pool.depth, 0.4, 1),
      ttl,
      maxTtl: ttl,
    };
    this.steams.push(steam);
    this.react('boil', pool.x, 0.5, pool.z, steam.density, -1, steam.id);
  }

  /** Extra float height for the core from steam it is inside (densest cloud wins). */
  private steamLift(x: number, y: number, z: number): number {
    if (this.steams.length === 0) return 0;
    const el = this.rules.elements;
    let best = 0;
    for (const sc of this.steams) {
      if (y > el.steam.ceiling || length2(x - sc.x, z - sc.z) > sc.r) continue;
      best = Math.max(best, sc.density * Math.min(1, sc.ttl / 15));
    }
    return best * el.steam.coreLift;
  }

  /** Element fields: magnet holds, energized lodestones, gravity wells, pools and steam. */
  private applyElementFields(): void {
    const el = this.rules.elements;
    const dt = this.physics.dt;
    const pull = this.pull;

    // MAGNETIZE holds: drain energy, pull every lodestone in range toward the force point.
    for (const p of this.players) {
      const h = p.hold;
      if (!h || h.ability !== 'magnetize') continue;
      const def = this.abilities.magnetize;
      const drain = def.costPerSecond * dt;
      h.ticks++;
      if (
        p.energy < drain ||
        h.ticks > this.ticks(def.maxHoldSeconds) ||
        this.match.phase !== 'playing'
      ) {
        this.releaseHold(p, true);
        continue;
      }
      this.spend(p, drain);
      for (const e of this.physics.entities.values()) {
        if (e.kind !== 'lodestone') continue;
        const b = this.physics.body(e.id);
        if (!b) continue;
        const t = b.translation();
        const boost = (this.bodyEl.get(e.id)?.energized ?? 0) > 0 ? 1.5 : 1;
        softenedPull(
          p.mx - t.x,
          0,
          p.mz - t.z,
          el.magnet.strength * boost,
          el.magnet.softening,
          el.magnet.maxAcceleration,
          el.magnet.range,
          pull,
        );
        this.accumulate(e.id, pull.x, 0, pull.z);
      }
    }

    // Energized lodestones attract conductors; they are pulled back in proportion (action =
    // reaction scaled by mass), so a light core moves more than the heavy steel.
    for (const lo of this.physics.entities.values()) {
      if (lo.kind !== 'lodestone' || (this.bodyEl.get(lo.id)?.energized ?? 0) <= 0) continue;
      const lb = this.physics.body(lo.id);
      if (!lb) continue;
      const lt = lb.translation();
      const lm = lb.mass();
      for (const e of this.physics.entities.values()) {
        if (e.id === lo.id || !MOVABLE.has(e.kind)) continue;
        if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
        const wet = this.bodyEl.get(e.id)?.wet ?? 0;
        if (
          MATERIALS[e.material].conductivity < el.charge.dryConductivity &&
          wet < el.charge.wetConductive
        )
          continue;
        const b = this.physics.body(e.id);
        if (!b) continue;
        const t = b.translation();
        softenedPull(
          lt.x - t.x,
          lt.y - t.y,
          lt.z - t.z,
          el.magnet.strength,
          el.magnet.softening,
          el.magnet.maxAcceleration,
          el.magnet.range,
          pull,
        );
        if (pull.x === 0 && pull.z === 0) continue;
        this.accumulate(e.id, pull.x, pull.y * 0.3, pull.z);
        const ratio = b.mass() / lm;
        this.accumulate(lo.id, -pull.x * ratio, 0, -pull.z * ratio);
      }
    }

    // GRAVITY wells: every movable body in range, softened and capped, fading in and out.
    for (const w of this.effects) {
      if (w.kind !== 'well') continue;
      const life = Math.min(1, w.ttl / 4, (w.maxTtl - w.ttl + 1) / 3);
      for (const e of this.physics.entities.values()) {
        if (!MOVABLE.has(e.kind)) continue;
        if (e.kind === 'core' && this.match.kickoffShield > 0) continue;
        const b = this.physics.body(e.id);
        if (!b) continue;
        const t = b.translation();
        softenedPull(
          w.x - t.x,
          el.gravity.height - t.y,
          w.z - t.z,
          el.gravity.strength * life,
          el.gravity.softening,
          el.gravity.maxAcceleration,
          w.radius,
          pull,
        );
        this.accumulate(e.id, pull.x, pull.y, pull.z);
      }
    }

    if (this.pools.length === 0 && this.steams.length === 0) return;
    for (const e of this.physics.entities.values()) {
      if (!MOVABLE.has(e.kind)) continue;
      const b = this.physics.body(e.id);
      if (!b) continue;
      const t = b.translation();
      // Pools: drag on bodies skimming liquid; electrified pools push bodies outward.
      if (t.y - e.radius <= el.pool.contactHeight) {
        for (const pool of this.pools) {
          if (pool.ice >= 0) continue;
          const dx = t.x - pool.x;
          const dz = t.z - pool.z;
          const d = length2(dx, dz);
          if (d > pool.r) continue;
          const v = b.linvel();
          const k = el.pool.drag * pool.depth;
          this.accumulate(e.id, -v.x * k, 0, -v.z * k);
          if (pool.electrified > 0 && pool.charge > 0) {
            const a = el.charge.shockAcceleration * pool.charge;
            const nx = d > 1e-4 ? dx / d : e.id % 2 === 0 ? 1 : -1;
            const nz = d > 1e-4 ? dz / d : 0;
            this.accumulate(e.id, nx * a, 0, nz * a);
          }
        }
      }
      // Steam: updraft on loose bodies (the core's float height is raised in the hover field).
      if (e.kind === 'core') continue;
      for (const sc of this.steams) {
        if (t.y > el.steam.ceiling || length2(t.x - sc.x, t.z - sc.z) > sc.r) continue;
        const dens = sc.density * Math.min(1, sc.ttl / 15);
        this.accumulate(e.id, 0, el.steam.updraft * dens * (1 - t.y / el.steam.ceiling), 0);
      }
    }
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
    this.bodyEl.delete(id);
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
      if (e.kind === 'guard' || e.kind === 'ice' || e.kind === 'shard') this.despawn(e.id, 'reset');
    }
    this.effects = [];
    this.pools = [];
    this.steams = [];
    this.flames = [];
    this.bodyEl.clear();
    const c = this.rules.core;
    const core = this.physics.body(this.coreId);
    if (core) {
      core.setTranslation({ x: 0, y: c.hoverHeight, z: 0 }, true);
      core.setLinvel({ x: 0, y: 0, z: 0 }, true);
      core.setAngvel({ x: 0, y: 0, z: 0 }, true);
      core.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    this.coreSpin = 0;
    this.prevCore = { x: 0, y: c.hoverHeight, z: 0 };
    for (const b of this.boulders) {
      if (b.id < 0 || !this.physics.body(b.id)) this.spawnObstacle(b); // rebuilt after a fracture
      const body = this.physics.body(b.id);
      if (!body) continue;
      body.setTranslation({ x: b.x, y: b.radius, z: b.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    for (const p of this.players) {
      this.releaseHold(p, false);
      this.releaseGrasp(p, false);
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
    for (const p of this.players) {
      this.releaseHold(p, true);
      this.releaseGrasp(p, true);
    }
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
      if (p.regrip > 0) p.regrip--;
      if (p.regenDelay > 0) p.regenDelay--;
      else if (!p.hold && !p.grasp) p.energy = Math.min(this.rules.energy.max, p.energy + regen);
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
        ...this.elementFields(e.id),
        ...(e.id === this.coreId && this.coreSpin !== 0 ? { s: q3(this.coreSpin) } : {}),
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
      d: [q4(f.dx), q4(f.dz)],
    }));
    this.elementEffects(effects);
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

  /** Element state of a body for snapshots (only non-neutral fields are sent). */
  private elementFields(id: EntityId): Partial<EntitySnapshot> {
    const st = this.bodyEl.get(id);
    if (!st) return {};
    const out: { w?: number; h?: number; c?: number; veil?: 1; sh?: 1; en?: number } = {};
    if (st.wet >= 0.01) out.w = Math.round(st.wet * 100) / 100;
    if (Math.abs(st.temp - this.rules.elements.ambientTemp) >= 2) out.h = Math.round(st.temp);
    if (st.charge > 0) out.c = Math.round(st.charge * 100) / 100;
    if (st.veiled) out.veil = 1;
    if (st.shocked > 0) out.sh = 1;
    if (st.energized > 0) out.en = st.energized;
    return out;
  }

  private elementEffects(out: EffectSnapshot[]): void {
    const el = this.rules.elements;
    const poolLife = this.ticks(el.pool.lifetimeSeconds);
    for (const q of this.pools) {
      out.push({
        id: q.id,
        kind: 'pool',
        owner: q.owner,
        p: [q3(q.x), 0, q3(q.z)],
        r: q3(q.r),
        ttl: q.ice >= 0 ? -1 : q.ttl,
        maxTtl: poolLife,
        s: 0,
        d: [0, 0],
        m: q3(q.depth),
        T: Math.round(q.temp),
        f: (q.ice >= 0 ? EFFECT_FLAG.ICE : 0) | (q.electrified > 0 ? EFFECT_FLAG.ELECTRIFIED : 0),
      });
    }
    for (const sc of this.steams) {
      out.push({
        id: sc.id,
        kind: 'steam',
        owner: sc.owner,
        p: [q3(sc.x), 0, q3(sc.z)],
        r: q3(sc.r),
        ttl: sc.ttl,
        maxTtl: sc.maxTtl,
        s: 0,
        d: [0, 0],
        m: q3(sc.density * Math.min(1, sc.ttl / 15)),
      });
    }
    for (const f of this.flames) {
      out.push({
        id: f.id,
        kind: 'flame',
        owner: f.owner,
        p: [q3(f.x), 0, q3(f.z)],
        r: q3(f.r),
        ttl: f.ttl,
        maxTtl: f.maxTtl,
        s: 0,
        d: [0, 0],
        m: q3(Math.min(1, f.ttl / 15)),
      });
    }
    const hold = this.ticks(this.abilities.magnetize.maxHoldSeconds);
    for (const p of this.players) {
      if (p.hold?.ability !== 'magnetize') continue;
      out.push({
        id: 1_000_000 + p.slot,
        kind: 'magnet',
        owner: p.slot,
        p: [q3(p.mx), 0, q3(p.mz)],
        r: el.magnet.range,
        ttl: Math.max(0, hold - p.hold.ticks),
        maxTtl: hold,
        s: 0,
        d: [0, 0],
        m: 1,
      });
    }
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
      grasp: p.grasp ? p.grasp.target : -1,
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
      // Hand state only when present, so play without a hand channel hashes exactly as before.
      if (p.grasp) h.str('grasp').int(p.grasp.target).int(p.grasp.ticks);
      if (p.regrip > 0) h.str('regrip').int(p.regrip);
      if (p.hand.tick >= 0)
        h.str('hand')
          .num(p.hand.grip)
          .num(p.hand.push)
          .num(p.hand.twist)
          .int(p.hand.tick)
          .num(p.hv.x)
          .num(p.hv.z);
    }
    if (this.coreSpin !== 0) h.str('spin').num(this.coreSpin);
    for (const f of this.effects) h.int(f.id).num(f.x).num(f.z).int(f.ttl).num(f.dx).num(f.dz);
    for (const q of this.pools) {
      h.int(q.id).num(q.x).num(q.z).num(q.r).num(q.depth).num(q.temp);
      h.int(q.ice).int(q.electrified).num(q.charge).int(q.ttl);
    }
    for (const sc of this.steams)
      h.int(sc.id).num(sc.x).num(sc.z).num(sc.r).num(sc.density).int(sc.ttl);
    for (const f of this.flames) h.int(f.id).num(f.x).num(f.z).int(f.ttl);
    for (const [id, st] of [...this.bodyEl].sort((a, b) => a[0] - b[0])) {
      h.int(id).num(st.wet).num(st.temp).num(st.charge).int(st.chargeTicks);
      h.int(st.energized)
        .int(st.shocked)
        .int(st.veiled ? 1 : 0);
    }
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
      pools: this.pools.map((x) => ({ ...x })),
      steams: this.steams.map((x) => ({ ...x })),
      flames: this.flames.map((x) => ({ ...x })),
      bodyEl: [...this.bodyEl].map(([id, st]) => [id, { ...st }] as const),
      coreSpin: this.coreSpin,
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
    if (id === this.coreId) {
      this.prevCore = { x, y, z };
      this.coreSpin = 0;
    }
  }

  /** Debug/test-only (and the Hands Lab's task setup): every hand lets go of what it holds. */
  debugReleaseGrasps(): void {
    for (const p of this.players) this.releaseGrasp(p, true);
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

  /** Debug/test-only: set the remaining round clock (ticks) to exercise expiry rules quickly. */
  debugSetClock(ticks: number): void {
    this.match.clockTicks = Math.max(1, Math.floor(ticks));
  }

  /** Debug/test-only: clear the post-kickoff ability shield. */
  debugClearKickoffShield(): void {
    this.match.kickoffShield = 0;
  }

  /** Debug/test-only: authoritative per-seat state needed by fixtures (energy, cooldowns). */
  debugPlayer(slot: PlayerSlot): {
    energy: number;
    lockout: number;
    cooldowns: Partial<Record<AbilityId, number>>;
    guards: readonly EntityId[];
    grasp: EntityId;
    regrip: number;
  } {
    const p = this.players[slot];
    return {
      energy: p.energy,
      lockout: p.lockout,
      cooldowns: { ...p.cooldowns },
      guards: [...p.guards],
      grasp: p.grasp ? p.grasp.target : -1,
      regrip: p.regrip,
    };
  }

  /** Debug/test-only: the core's deliberate (curving) spin, rad/s about +y. */
  debugCoreSpin(): number {
    return this.coreSpin;
  }

  /** Physics budget counters for HUD/diagnostics. */
  get counters(): {
    entities: number;
    effects: number;
    guards: number;
    regions: number;
    elementBodies: number;
  } {
    let guards = 0;
    for (const e of this.physics.entities.values()) if (e.kind === 'guard') guards++;
    return {
      entities: this.physics.entityCount,
      effects: this.effects.length,
      guards,
      regions: this.pools.length + this.steams.length + this.flames.length,
      elementBodies: this.bodyEl.size,
    };
  }

  /** Debug/test-only: adds a water patch as fixture setup (D04 "initial material patches"). */
  debugAddPool(
    owner: PlayerSlot,
    x: number,
    z: number,
    r: number,
    depth: number,
    temp?: number,
  ): number {
    const el = this.rules.elements;
    const id = this.nextEffectId++;
    this.pools.push({
      id,
      owner,
      x,
      z,
      r,
      depth: clamp(depth, 0.05, 1),
      temp: temp ?? el.ambientTemp,
      ice: -1,
      electrified: 0,
      charge: 0,
      ttl: this.ticks(el.pool.lifetimeSeconds),
    });
    return id;
  }

  /** Debug/test-only: read-only copies of the element regions. */
  debugRegions(): {
    pools: readonly Readonly<PoolState>[];
    steams: readonly Readonly<SteamState>[];
    flames: readonly Readonly<FlameState>[];
  } {
    return {
      pools: this.pools.map((x) => ({ ...x })),
      steams: this.steams.map((x) => ({ ...x })),
      flames: this.flames.map((x) => ({ ...x })),
    };
  }

  /** Debug/test-only: element state of a body (null = neutral). */
  debugBodyElement(id: EntityId): Readonly<BodyElementState> | null {
    const st = this.bodyEl.get(id);
    return st ? { ...st } : null;
  }

  /**
   * Debug/Lab-only material toggle: sets wetness / temperature / thermal shock of an element-bearing
   * body directly (Physics Lab "material state toggles"). Not reachable from any network message.
   */
  debugSetBodyElement(
    id: EntityId,
    patch: { readonly wet?: number; readonly temp?: number; readonly shocked?: boolean },
  ): boolean {
    const e = this.physics.entities.get(id);
    if (!e || !ELEMENTAL.has(e.kind)) return false;
    const st = this.bodyState(id);
    if (patch.wet !== undefined) st.wet = clamp(patch.wet, 0, 1);
    if (patch.temp !== undefined) st.temp = clamp(patch.temp, -60, 400);
    if (patch.shocked !== undefined)
      st.shocked = patch.shocked ? this.ticks(this.rules.elements.body.shockedSeconds) : 0;
    return true;
  }

  /**
   * Debug/Lab-only: sets the core's deliberate spin (rad/s about +y, clamped to the hand's maximum),
   * as a hand's twist would, so a paused Physics Lab frame can show a fast-spinning core (D09
   * evidence). Not reachable from any network message.
   */
  debugSetCoreSpin(spin: number): void {
    const max = this.rules.hand.maxSpin;
    this.coreSpin = Number.isFinite(spin) ? clamp(spin, -max, max) : 0;
  }

  /** Debug/test-only: entity ids of a kind, ascending. */
  debugEntities(kind: string): EntityId[] {
    const out: EntityId[] = [];
    for (const e of this.physics.entities.values()) if (e.kind === kind) out.push(e.id);
    return out.sort((a, b) => a - b);
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

/** Smooth 0 → 1 over [0, 1] (clamped). */
function smoothstep01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Zero inside ±dead, rescaled to keep the full range outside it. */
function deadZone(x: number, dead: number): number {
  const a = Math.abs(x);
  return a <= dead ? 0 : (Math.sign(x) * (a - dead)) / (1 - dead);
}

/** Zero-padded id so string keys sort numerically (deterministic discharge order). */
function pad(n: number): string {
  return String(n).padStart(7, '0');
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
    loadout: [...(p.loadout ?? DEFAULT_LOADOUT)],
    hand: { ...(p.hand ?? NEUTRAL_HAND) },
    grasp: p.grasp ? { ...p.grasp } : null,
    regrip: p.regrip ?? 0,
    hv: { ...(p.hv ?? { x: 0, z: 0 }) },
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
