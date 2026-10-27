import { DEFAULT_ELEMENTS, type ElementRules } from './elements.js';
/**
 * Match-level rules. All durations are expressed in seconds here and converted to integer
 * ticks by the simulation (`secondsToTicks`). Never read wall-clock time in the simulation.
 */
export interface MatchRules {
  /** Fixed simulation rate (Hz). The authoritative world always steps at exactly 1 / tickRate. */
  readonly tickRate: number;
  /** Network snapshot rate (Hz) for remote sessions. */
  readonly snapshotRate: number;
  readonly roundsToWinMatch: number;
  /** Hard upper bound on rounds so a match always terminates (draw rounds count). */
  readonly maxRounds: number;
  readonly roundSeconds: number;
  readonly goalsToWinRound: number;
  readonly goldenRiftSeconds: number;
  readonly countdownSeconds: number;
  readonly goalPauseSeconds: number;
  readonly roundEndPauseSeconds: number;
  /** After kickoff the core ignores ability forces for this long (fairness after a reset). */
  readonly kickoffShieldSeconds: number;
  /** Kickoff nudge applied to the core (velocity change, m/s); direction is seeded. */
  readonly kickoffSpeed: number;
}

export interface EnergyRules {
  readonly max: number;
  readonly regenPerSecond: number;
  /** Regeneration pauses briefly after spending so spam is not free. */
  readonly regenDelaySeconds: number;
  readonly startValue: number;
}

export interface WorldLimits {
  readonly maxDynamicBodies: number;
  readonly maxActiveEffects: number;
  readonly maxGuardsPerPlayer: number;
  /** Absolute speed cap for any dynamic body (m/s). */
  readonly maxBodySpeed: number;
  readonly maxCoreSpeed: number;
  readonly maxAngularSpeed: number;
  /** Combined acceleration cap from all sustained fields on one body (m/s^2). */
  readonly maxFieldAcceleration: number;
}

export interface CoreRules {
  readonly radius: number;
  readonly mass: number;
  readonly restitution: number;
  readonly friction: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  /** The core levitates on its own field around this height (centre, metres). */
  readonly hoverHeight: number;
  /** Above hoverHeight + hoverBand the levitation field releases and gravity dominates. */
  readonly hoverBand: number;
  readonly hoverStiffness: number;
  readonly hoverDamping: number;
  /** Minimum penetration of the core centre past the goal plane for a goal (fraction of radius). */
  readonly goalPenetration: number;
  /**
   * Anti-stall "Meridian drift": a slow core further than `idleDriftDeadZone` from the centre line
   * is pulled back toward it (m/s^2), fading out as speed approaches `idleDriftSpeed`. Symmetric,
   * weak, and irrelevant to any moving shot — it only prevents unreachable dead cores.
   */
  readonly idleDriftAcceleration: number;
  readonly idleDriftSpeed: number;
  readonly idleDriftDeadZone: number;
}

export interface ManipulatorRules {
  /** Maximum travel speed of a player's in-world manipulator (m/s); identical for all inputs. */
  readonly maxSpeed: number;
  /** How far past the centre line a manipulator may reach (m). */
  readonly midlineReach: number;
  /** Clearance from arena walls (m). */
  readonly wallMargin: number;
  readonly height: number;
}

/**
 * Continuous manipulation (ADR-0009): how the hand channel (grip, push, twist) becomes force.
 * Accelerations are m/s² on a body of the core's mass (lighter bodies a little more, heavier ones
 * less, as `massScale`); every hand force goes through the per-body field cap. Energy is spent in
 * proportion to the work done (acceleration × mass ratio × time), so holding still is cheap and
 * flinging is not — a full-strength throw costs about what a PULSE does.
 */
export interface HandRules {
  /** The hand closes on a body at or above this grip and lets go at or below the release grip. */
  readonly engageGrip: number;
  readonly releaseGrip: number;
  /** A body is grippable within this horizontal distance of the force point (m). */
  readonly reach: number;
  /** The core counts as this much closer when choosing what to grip (m). */
  readonly coreBias: number;
  /** A gripped body slips out when it ends up farther than this from the force point (m). */
  readonly breakDistance: number;
  /** Height a gripped body is carried at (centre, m). */
  readonly holdHeight: number;
  /** Hold spring stiffness at the lightest and the firmest grip (1/s²). */
  readonly stiffness: readonly [number, number];
  /** Damping ratio of the hold relative to the hand (the body matches the hand's velocity). */
  readonly dampingRatio: number;
  /** Cap on a hold's acceleration (m/s²; gravity support included). */
  readonly maxHoldAcceleration: number;
  /** Ticks after letting go before the hand may grip again (s). */
  readonly regripSeconds: number;
  /** A hand state older than this counts as an open, still hand (s). */
  readonly staleSeconds: number;
  /** Open hand moving: bodies within this radius (m) are dragged along the hand's motion. */
  readonly sweepRadius: number;
  /**
   * Drag gain toward the hand's velocity (1/s), its cap (m/s²) and the hand speed it needs (m/s):
   * the drag fades in from that speed to twice it.
   */
  readonly sweepGain: number;
  readonly maxSweepAcceleration: number;
  readonly minSweepSpeed: number;
  /**
   * Time constant (s) smoothing the force point's motion into the hand's velocity: tracking
   * jitter of a hand held still averages out instead of reading as strokes.
   */
  readonly velocitySmoothing: number;
  /** Push / pull: radius (m), acceleration at full push (m/s²), dead zone (|push| below it: none). */
  readonly pushRadius: number;
  readonly pushAcceleration: number;
  readonly pushDeadZone: number;
  /** Twist spins a gripped body about the vertical: rate at full twist (rad/s), gain (1/s), dead zone. */
  readonly maxSpin: number;
  readonly spinGain: number;
  readonly twistDeadZone: number;
  /** Curve of a spinning core: a = magnus · ω × v (per rad), capped (m/s²). */
  readonly magnus: number;
  readonly maxMagnusAcceleration: number;
  /** A core contact at least this hard (N·s) keeps only `spinKeptOnImpact` of the spin. */
  readonly spinScrubImpulse: number;
  readonly spinKeptOnImpact: number;
  /** Energy per second while gripping, and per (m/s² · s) of applied acceleration (≈ per m/s of Δv). */
  readonly holdCostPerSecond: number;
  readonly workCost: number;
}

export interface NetworkRules {
  /** Maximum intents accepted per seat per second (burst bucket refills at this rate). */
  readonly maxIntentsPerSecond: number;
  readonly intentBurst: number;
  readonly maxMessageBytes: number;
  readonly disconnectGraceSeconds: number;
  readonly lobbyIdleSeconds: number;
  readonly roomTtlSeconds: number;
}

export interface GameRules {
  readonly match: MatchRules;
  readonly energy: EnergyRules;
  readonly limits: WorldLimits;
  readonly core: CoreRules;
  readonly manipulator: ManipulatorRules;
  readonly hand: HandRules;
  readonly network: NetworkRules;
  readonly elements: ElementRules;
  readonly gravity: number;
}

export const DEFAULT_RULES: GameRules = {
  match: {
    tickRate: 30,
    snapshotRate: 20,
    roundsToWinMatch: 2,
    maxRounds: 5,
    roundSeconds: 90,
    goalsToWinRound: 3,
    goldenRiftSeconds: 45,
    countdownSeconds: 3,
    goalPauseSeconds: 2.5,
    roundEndPauseSeconds: 3.5,
    kickoffShieldSeconds: 0.4,
    kickoffSpeed: 2.2,
  },
  energy: {
    max: 100,
    regenPerSecond: 10,
    regenDelaySeconds: 0.35,
    startValue: 100,
  },
  limits: {
    maxDynamicBodies: 20,
    maxActiveEffects: 30,
    maxGuardsPerPlayer: 2,
    maxBodySpeed: 30,
    maxCoreSpeed: 28,
    maxAngularSpeed: 40,
    maxFieldAcceleration: 45,
  },
  core: {
    radius: 0.85,
    mass: 8,
    restitution: 0.72,
    friction: 0.25,
    linearDamping: 0.18,
    angularDamping: 0.6,
    hoverHeight: 1.15,
    hoverBand: 1.4,
    hoverStiffness: 30,
    hoverDamping: 7,
    goalPenetration: 0.9,
    idleDriftAcceleration: 1.1,
    idleDriftSpeed: 3,
    idleDriftDeadZone: 4,
  },
  manipulator: {
    maxSpeed: 13,
    midlineReach: 2,
    wallMargin: 0.8,
    height: 1.1,
  },
  hand: {
    engageGrip: 0.6,
    releaseGrip: 0.35,
    reach: 3.2,
    coreBias: 0.75,
    breakDistance: 6,
    holdHeight: 2.2,
    stiffness: [6, 40],
    dampingRatio: 0.7,
    maxHoldAcceleration: 40,
    regripSeconds: 0.2,
    // Long enough to ride out a render hitch or a burst of network jitter (at 0.3 s, a page
    // drawing a frame every ~0.45 s let go every frame — seen in CI), short enough that a hand
    // that is really gone lets go within a blink.
    staleSeconds: 0.6,
    sweepRadius: 2.6,
    sweepGain: 6,
    maxSweepAcceleration: 30,
    minSweepSpeed: 1.5,
    velocitySmoothing: 0.12,
    pushRadius: 4.5,
    pushAcceleration: 40,
    pushDeadZone: 0.15,
    maxSpin: 14,
    spinGain: 5,
    twistDeadZone: 0.12,
    magnus: 0.05,
    maxMagnusAcceleration: 4,
    spinScrubImpulse: 25,
    spinKeptOnImpact: 0.5,
    holdCostPerSecond: 4,
    workCost: 0.6,
  },
  network: {
    maxIntentsPerSecond: 40,
    intentBurst: 20,
    maxMessageBytes: 2048,
    disconnectGraceSeconds: 30,
    lobbyIdleSeconds: 600,
    roomTtlSeconds: 3600,
  },
  elements: DEFAULT_ELEMENTS,
  gravity: 9.81,
};

/** Converts a duration in seconds to a whole number of ticks (never zero for positive input). */
export function secondsToTicks(seconds: number, tickRate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds * tickRate));
}

/**
 * Short rounds for automated tests, demos and quick local practice. Online rooms only accept it on
 * development hosts; production rooms always play `standard`.
 */
export const FAST_RULES: GameRules = {
  ...DEFAULT_RULES,
  match: {
    ...DEFAULT_RULES.match,
    roundSeconds: 25,
    goalsToWinRound: 1,
    goldenRiftSeconds: 10,
    countdownSeconds: 2,
    goalPauseSeconds: 1.5,
    roundEndPauseSeconds: 2,
  },
};

/**
 * The Hands Lab sandbox (ADR-0009, local only): one endless round, no kickoff nudge and no
 * anti-stall drift — bodies stay exactly where a task puts them until a hand moves them — and
 * manipulation costs no energy: the lab measures whether moving things by hand is intuitive, not
 * resource play (a slow first carry would otherwise run dry and drop). Every force is the
 * match's own.
 */
export const LAB_RULES: GameRules = {
  ...DEFAULT_RULES,
  match: {
    ...DEFAULT_RULES.match,
    roundSeconds: 36_000,
    goalsToWinRound: 9_999,
    roundsToWinMatch: 1,
    maxRounds: 1,
    countdownSeconds: 1,
    goalPauseSeconds: 1,
    kickoffSpeed: 0,
  },
  core: { ...DEFAULT_RULES.core, idleDriftAcceleration: 0 },
  hand: { ...DEFAULT_RULES.hand, holdCostPerSecond: 0, workCost: 0 },
};

export const RULESET_IDS = ['standard', 'fast'] as const;
export type RulesetId = (typeof RULESET_IDS)[number];

export function rulesFor(id: RulesetId): GameRules {
  return id === 'fast' ? FAST_RULES : DEFAULT_RULES;
}
