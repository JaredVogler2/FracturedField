/**
 * Canonical ability vocabulary. Every input source (camera, touch, gyro, keyboard, gamepad, bot)
 * resolves to one of these ids inside a normalized ActionIntent.
 */
export const ABILITY_IDS = [
  'pulse',
  'lift',
  'draw',
  'sweep',
  'guard',
  'infuse',
  'freeze',
  'charge',
  'magnetize',
  'gravity',
  'focus',
] as const;

export type AbilityId = (typeof ABILITY_IDS)[number];

export type AbilityKind = 'tap' | 'hold';

export interface AbilityBase {
  readonly id: AbilityId;
  readonly kind: AbilityKind;
  /** Energy spent when the ability starts. */
  readonly cost: number;
  /** Energy drained per second while held (hold abilities). */
  readonly costPerSecond: number;
  readonly cooldownSeconds: number;
  /** Lockout during which no other ability may start (seconds). */
  readonly lockoutSeconds: number;
  /** Implemented in the current build; unimplemented abilities are rejected by the authority. */
  readonly available: boolean;
}

export interface PulseDef extends AbilityBase {
  readonly id: 'pulse';
  /** Impulse magnitude at full strength (N·s). Δv = impulse / mass. */
  readonly impulse: number;
  readonly fullStrengthRadius: number;
  readonly radius: number;
  /** Upward share of the impulse direction (adds liveliness without lofting). */
  readonly lift: number;
  /** Upward share used when the target is already elevated (lift -> pulse = lob shot). */
  readonly loft: number;
  /** Height above the hover band at which a body counts as elevated (m). */
  readonly loftThreshold: number;
}

export interface LiftDef extends AbilityBase {
  readonly id: 'lift';
  readonly range: number;
  /** Target centre height of a lifted body (m). */
  readonly height: number;
  readonly stiffness: number;
  readonly damping: number;
  /** Horizontal pull toward the manipulator (m/s^2 per metre). */
  readonly carryStiffness: number;
  readonly maxAcceleration: number;
  readonly maxHoldSeconds: number;
}

/**
 * SWEEP raises a bounded crosswind: a disc of air at the manipulator blowing in one lateral
 * direction (left/right of the caster's attack direction, or an explicit input direction). A
 * uniform field bends a passing core predictably; equal and opposite crosswinds cancel exactly.
 * (A pure vortex was rejected after testing: its sideways push cancels over a straight pass.)
 */
export interface SweepDef extends AbilityBase {
  readonly id: 'sweep';
  readonly radius: number;
  readonly durationSeconds: number;
  /** Wind acceleration on a body of `referenceMass` at the field centre (m/s^2). */
  readonly windAcceleration: number;
  /** Bodies heavier than this accelerate proportionally less (wind is a force, not gravity). */
  readonly referenceMass: number;
}

export interface GuardDef extends AbilityBase {
  readonly id: 'guard';
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly halfDepth: number;
  readonly lifetimeSeconds: number;
  /** Guards may not be placed closer than this to their own goal line (prevents sealing a goal). */
  readonly goalLineClearance: number;
  /** Contact impulse (N·s) at which the barrier shatters. */
  readonly breakImpulse: number;
  readonly restitution: number;
}

export interface GenericAbilityDef extends AbilityBase {
  readonly id: Exclude<AbilityId, 'pulse' | 'lift' | 'sweep' | 'guard'>;
}

export interface AbilityTable {
  readonly pulse: PulseDef;
  readonly lift: LiftDef;
  readonly sweep: SweepDef;
  readonly guard: GuardDef;
  readonly draw: GenericAbilityDef;
  readonly infuse: GenericAbilityDef;
  readonly freeze: GenericAbilityDef;
  readonly charge: GenericAbilityDef;
  readonly magnetize: GenericAbilityDef;
  readonly gravity: GenericAbilityDef;
  readonly focus: GenericAbilityDef;
}

/** Starting tuning (docs/GAME_DESIGN.md). Adjust here only — never inline in systems. */
export const DEFAULT_ABILITIES: AbilityTable = {
  pulse: {
    id: 'pulse',
    kind: 'tap',
    cost: 10,
    costPerSecond: 0,
    cooldownSeconds: 0.35,
    lockoutSeconds: 0.15,
    available: true,
    impulse: 118,
    fullStrengthRadius: 2.6,
    radius: 7.5,
    lift: 0.08,
    loft: 0.32,
    loftThreshold: 0.8,
  },
  lift: {
    id: 'lift',
    kind: 'hold',
    cost: 4,
    costPerSecond: 6,
    cooldownSeconds: 0.3,
    lockoutSeconds: 0.15,
    available: true,
    range: 6.5,
    height: 3.4,
    stiffness: 22,
    damping: 6,
    carryStiffness: 3.5,
    maxAcceleration: 30,
    maxHoldSeconds: 4,
  },
  sweep: {
    id: 'sweep',
    kind: 'tap',
    cost: 24,
    costPerSecond: 0,
    cooldownSeconds: 0.8,
    lockoutSeconds: 0.2,
    available: true,
    radius: 5.5,
    durationSeconds: 1.8,
    windAcceleration: 12,
    referenceMass: 8,
  },
  guard: {
    id: 'guard',
    kind: 'tap',
    cost: 28,
    costPerSecond: 0,
    cooldownSeconds: 1.6,
    lockoutSeconds: 0.25,
    available: true,
    halfWidth: 1.7,
    halfHeight: 0.95,
    halfDepth: 0.3,
    lifetimeSeconds: 3.6,
    goalLineClearance: 2.6,
    // A full-power direct shot (~8 kg × 1.85 × 15 m/s ≈ 220 N·s) is blocked; a second strong hit
    // or a chained double-pulse shot shatters the barrier.
    breakImpulse: 300,
    restitution: 0.85,
  },
  draw: base('draw', 'hold', 0, 7),
  infuse: base('infuse', 'tap', 18, 0),
  freeze: base('freeze', 'tap', 22, 0),
  charge: base('charge', 'tap', 20, 0),
  magnetize: base('magnetize', 'hold', 8, 9),
  gravity: base('gravity', 'tap', 55, 0),
  focus: base('focus', 'hold', 45, 0),
};

function base(
  id: GenericAbilityDef['id'],
  kind: AbilityKind,
  cost: number,
  costPerSecond: number,
): GenericAbilityDef {
  return {
    id,
    kind,
    cost,
    costPerSecond,
    cooldownSeconds: 0.6,
    lockoutSeconds: 0.2,
    available: false,
  };
}

export function isAbilityId(value: unknown): value is AbilityId {
  return typeof value === 'string' && (ABILITY_IDS as readonly string[]).includes(value);
}
