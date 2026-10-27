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
  readonly network: NetworkRules;
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
  },
  manipulator: {
    maxSpeed: 13,
    midlineReach: 2,
    wallMargin: 0.8,
    height: 1.1,
  },
  network: {
    maxIntentsPerSecond: 40,
    intentBurst: 20,
    maxMessageBytes: 2048,
    disconnectGraceSeconds: 30,
    lobbyIdleSeconds: 600,
    roomTtlSeconds: 3600,
  },
  gravity: 9.81,
};

/** Converts a duration in seconds to a whole number of ticks (never zero for positive input). */
export function secondsToTicks(seconds: number, tickRate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds * tickRate));
}
