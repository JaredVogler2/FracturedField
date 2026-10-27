import type { AbilityId } from '@ff/game-data';

export type { AbilityId };

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

/** Small integer ids keep snapshots compact. Never reused within one match. */
export type EntityId = number;

export type PlayerSlot = 0 | 1;
export const PLAYER_SLOTS: readonly PlayerSlot[] = [0, 1];

export const INPUT_SOURCES = [
  'keyboard',
  'pointer',
  'touch',
  'gyro',
  'camera',
  'gamepad',
  'bot',
] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];

/**
 * tap   — instantaneous ability (pulse, sweep, guard)
 * start — begin a held ability (lift)
 * hold  — keep-alive / aim update for a held ability
 * end   — release a held ability
 */
export const INTENT_PHASES = ['tap', 'start', 'hold', 'end'] as const;
export type IntentPhase = (typeof INTENT_PHASES)[number];

/** `aim` intents only move the manipulator; everything else names an ability. */
export type IntentAction = AbilityId | 'aim';

/**
 * Continuous hand state (ADR-0009): what the player's hand is doing, sent with every `aim`
 * intent by every input method. It describes a hand, never a force — the authority alone turns
 * it into (capped) forces, the same way for every input.
 */
export interface HandState {
  /** Closure: 0 = open palm … 1 = fist. */
  readonly grip: number;
  /** Moving toward the screen (+) or back (−), −1 … 1. */
  readonly push: number;
  /** Wrist roll from the neutral pose, −1 … 1. */
  readonly twist: number;
}

/**
 * Canonical, input-agnostic player intention. Clients describe WHAT they want; the authority
 * decides whether it is legal and what force it produces. Never carries positions, forces,
 * energy, cooldowns or scores as truth.
 */
export interface ActionIntent {
  /** Per-connection monotonically increasing sequence number (anti-replay / ACK). */
  readonly seq: number;
  /** Client clock in ms — diagnostics only, never used for simulation. */
  readonly clientTime: number;
  readonly action: IntentAction;
  readonly phase: IntentPhase;
  /** Desired manipulator target in normalized arena coordinates, each axis in [-1, 1]. */
  readonly aim: Vec2;
  /** Optional unit direction (e.g. guard facing). */
  readonly dir?: Vec2;
  /** Requested strength in [0, 1]; the authority clamps and caps it. */
  readonly intensity: number;
  /** Small signed modifier (sweep chirality ±1, element index for infuse). */
  readonly modifier?: number;
  readonly source: InputSource;
  /** The hand's continuous state (on `aim` intents; inputs without one omit it). */
  readonly hand?: HandState;
}

export const ENTITY_KINDS = ['core', 'boulder', 'guard', 'shard', 'ice', 'lodestone'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly kind: EntityKind;
  /** Owner slot for player-created entities, -1 for neutral. */
  readonly owner: PlayerSlot | -1;
  readonly p: Vec3;
  readonly q: Quat;
  readonly v: Vec3;
  /** Remaining lifetime in ticks for transient entities, -1 if permanent. */
  readonly ttl: number;
  /* Authoritative element state, present only when not neutral (keeps snapshots small). */
  /** Wetness 0..1. */
  readonly w?: number;
  /** Temperature proxy (°C, rounded) when away from ambient. */
  readonly h?: number;
  /** Electric charge 0..1 (transient). */
  readonly c?: number;
  /** 1 while inside steam: the server marks the body as veiled (aim previews are withheld). */
  readonly veil?: 1;
  /** 1 while thermally shocked (weakened stone). */
  readonly sh?: 1;
  /** Remaining energized ticks of an electromagnet (lodestone). */
  readonly en?: number;
  /** The core's deliberate spin (rad/s about +y) that curves its path; only while non-zero. */
  readonly s?: number;
}

export interface PlayerSnapshot {
  readonly slot: PlayerSlot;
  /** Manipulator position on the arena plane (world x, z). */
  readonly m: Vec2;
  readonly energy: number;
  /** Remaining cooldown ticks for each ability that is cooling down. */
  readonly cd: Readonly<Partial<Record<AbilityId, number>>>;
  /** Ability currently held, if any. */
  readonly hold: AbilityId | null;
  /** Body the held ability is acting on (lift target), -1 if none. */
  readonly holdTarget: EntityId;
  /** Body the hand's grip is holding (ADR-0009), -1 if none. */
  readonly grasp: EntityId;
  readonly connected: boolean;
}

export const EFFECT_KINDS = ['sweep', 'pool', 'steam', 'flame', 'well', 'magnet'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/** EffectSnapshot.f bit flags. */
export const EFFECT_FLAG = {
  /** A pool that is currently an ice plate (collider present). */
  ICE: 1,
  /** A pool carrying an electric charge (shock zone). */
  ELECTRIFIED: 2,
} as const;

export interface EffectSnapshot {
  readonly id: number;
  readonly kind: EffectKind;
  readonly owner: PlayerSlot;
  readonly p: Vec3;
  readonly r: number;
  readonly ttl: number;
  readonly maxTtl: number;
  /** Signed modifier (+1 left / -1 right of the caster's attack direction). */
  readonly s: number;
  /** Unit wind direction on the arena plane (world x, z). */
  readonly d: Vec2;
  /** Strength 0..1: pool depth, steam density, well/magnet intensity. */
  readonly m?: number;
  /** Temperature proxy (°C, rounded) of a pool or flame. */
  readonly T?: number;
  /** EFFECT_FLAG bits. */
  readonly f?: number;
}

export const MATCH_PHASES = [
  'lobby',
  'countdown',
  'playing',
  'goal',
  'roundEnd',
  'matchEnd',
] as const;
export type MatchPhase = (typeof MATCH_PHASES)[number];

export interface MatchSnapshot {
  readonly phase: MatchPhase;
  /** 1-based round number. */
  readonly round: number;
  readonly score: readonly [number, number];
  readonly roundWins: readonly [number, number];
  /** Ticks left on the round clock (frozen outside `playing`). */
  readonly clockTicks: number;
  /** Ticks left in the current transitional phase (countdown, goal pause, round end). */
  readonly phaseTicks: number;
  readonly golden: boolean;
  readonly paused: boolean;
  readonly winner: PlayerSlot | -1 | null;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly entities: readonly EntitySnapshot[];
  readonly players: readonly [PlayerSnapshot, PlayerSnapshot];
  readonly effects: readonly EffectSnapshot[];
  readonly match: MatchSnapshot;
  /** Last intent sequence number accepted from each slot. */
  readonly ack: readonly [number, number];
  /** Highest event id emitted so far (clients detect gaps). */
  readonly eventCursor: number;
}

interface EventBase {
  readonly id: number;
  readonly tick: number;
}

export type GameEvent =
  | (EventBase & {
      readonly type: 'goal';
      readonly scorer: PlayerSlot;
      readonly p: Vec3;
      readonly speed: number;
    })
  | (EventBase & {
      readonly type: 'cast';
      readonly slot: PlayerSlot;
      readonly ability: AbilityId;
      readonly phase: IntentPhase;
      readonly p: Vec3;
      readonly mag: number;
    })
  | (EventBase & {
      readonly type: 'impact';
      readonly a: EntityId;
      readonly b: EntityId;
      readonly p: Vec3;
      readonly impulse: number;
    })
  | (EventBase & {
      readonly type: 'spawn';
      readonly entity: EntityId;
      readonly kind: EntityKind;
      readonly p: Vec3;
    })
  | (EventBase & {
      readonly type: 'despawn';
      readonly entity: EntityId;
      readonly reason: 'expired' | 'broken' | 'reset';
      readonly p: Vec3;
    })
  | (EventBase & { readonly type: 'phase'; readonly phase: MatchPhase; readonly round: number })
  | (EventBase & { readonly type: 'kickoff'; readonly p: Vec3; readonly v: Vec3 })
  | (EventBase & {
      readonly type: 'roundEnd';
      readonly round: number;
      readonly winner: PlayerSlot | -1;
      readonly reason: 'goals' | 'clock' | 'golden' | 'territory' | 'draw';
    })
  | (EventBase & { readonly type: 'matchEnd'; readonly winner: PlayerSlot | -1 })
  | (EventBase & {
      readonly type: 'grip';
      readonly slot: PlayerSlot;
      /** start: the hand closed on `entity`; end: it let go (`v` = the body's velocity then). */
      readonly phase: 'start' | 'end';
      readonly entity: EntityId;
      readonly p: Vec3;
      readonly v: Vec3;
    })
  | (EventBase & {
      readonly type: 'reaction';
      readonly kind: ReactionKind;
      readonly p: Vec3;
      /** Reaction strength (impulse, charge, depth …), for scaling feedback. */
      readonly mag: number;
      /** Primary entity involved (ice plate, boulder, guard, body), -1 if a region only. */
      readonly entity: EntityId;
      /** Effect (region) id involved, -1 if none. */
      readonly effect: number;
    })
  | (EventBase & {
      readonly type: 'charge';
      readonly slot: PlayerSlot;
      /** Conductors reached, in discharge order (first = closest to the caster). */
      readonly nodes: readonly Vec3[];
      /** Charge 0..1 per node. */
      readonly q: readonly number[];
      /** Discharge links as [from, to] indices into `nodes` (-1 = from the caster). */
      readonly links: readonly (readonly [number, number])[];
      readonly p: Vec3;
    });

/**
 * Element reactions (Phase 04). Each changes server-owned state: a collider, a velocity field,
 * a resource, or a visibility rule — never only a colour.
 */
export const REACTION_KINDS = [
  'soak',
  'ignite',
  'chill',
  'freeze',
  'melt',
  'boil',
  'douse',
  'shatter',
  'fracture',
  'quench',
  'shock',
  'overload',
  'energize',
  'well',
] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export type GameEventType = GameEvent['type'];

export type RejectReason =
  | 'invalid'
  | 'stale'
  | 'rate_limited'
  | 'not_playing'
  | 'not_available'
  | 'cooldown'
  | 'lockout'
  | 'energy'
  | 'out_of_range'
  | 'illegal_target'
  | 'limit'
  | 'paused';

export interface ActionResult {
  readonly seq: number;
  readonly accepted: boolean;
  readonly reason?: RejectReason;
  readonly tick: number;
}
