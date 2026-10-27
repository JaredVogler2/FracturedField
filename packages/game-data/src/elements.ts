/**
 * Element layer tuning (Phase 04). Game-scale approximations, not physical constants: temperature
 * is a heat proxy in °C-like units and "charge" is a normalised 0..1 share of one discharge. Every
 * change of state is injected by a player ability (INFUSE, GRAVITY, MAGNETIZE); nothing here claims
 * energy conservation for supernatural input.
 */

/**
 * INFUSE element selector, carried in ActionIntent.modifier (index into this list). Cooling and
 * charge are the advanced FREEZE and CHARGE moves (loadout picks), see ADR-0006.
 */
export const INFUSE_ELEMENTS = ['wet', 'heat'] as const;
export type InfuseElement = (typeof INFUSE_ELEMENTS)[number];

export interface ElementRules {
  readonly ambientTemp: number;
  /** Liquid → ice at or below this temperature. */
  readonly freezeTemp: number;
  /** Ice → liquid at or above this temperature (hysteresis band above freezeTemp). */
  readonly meltTemp: number;
  /** Liquid → steam at or above this temperature. */
  readonly boilTemp: number;
  /** Temperature relaxation toward ambient for regions and bodies (1/s). */
  readonly ambientRelaxPerSecond: number;
  /** Overlapping pools exchange temperature at this rate (1/s). */
  readonly poolMixPerSecond: number;
  readonly maxPools: number;
  readonly maxSteams: number;
  readonly maxFlames: number;
  readonly pool: {
    readonly radius: number;
    readonly maxRadius: number;
    /** Liquid depth proxy (0..1) added per WET infuse. */
    readonly depthPerInfuse: number;
    readonly growPerInfuse: number;
    /** A liquid pool soaks away after this long without new water. */
    readonly lifetimeSeconds: number;
    /** Horizontal drag rate (1/s) on bodies skimming a pool of depth 1. */
    readonly drag: number;
    /** Wetness gained per second over a pool of depth 1. */
    readonly wetPerSecond: number;
    /** Bodies whose underside is below this height touch the pool (the core rides at ~0.3 m). */
    readonly contactHeight: number;
  };
  readonly ice: {
    /** Plate height (m): the hovering core's underside sits at ~0.30 m, so the rim deflects it. */
    readonly height: number;
    /** Top radius as a fraction of the base radius: the plate rim is a ramp. */
    readonly topScale: number;
    readonly restitution: number;
    readonly friction: number;
    /** Contact impulse (N·s) that shatters a plate. */
    readonly fractureImpulse: number;
    /** Share of the water depth that remains after a plate shatters. */
    readonly shatterDepthKeep: number;
  };
  readonly steam: {
    readonly lifetimeSeconds: number;
    /** Extra float height given to the core inside a full-density cloud (m). */
    readonly coreLift: number;
    /** Upward acceleration on other bodies at full density near the floor (m/s²). */
    readonly updraft: number;
    /** Updraft fades to zero at this height (m). */
    readonly ceiling: number;
    readonly spreadPerSecond: number;
    readonly maxRadius: number;
  };
  readonly flame: {
    readonly radius: number;
    readonly lifetimeSeconds: number;
    /** Heat delivered to overlapping regions and bodies (°C/s at full overlap). */
    readonly heatPerSecond: number;
    /** Drift speed per unit of local wind acceleration (m/s per m/s²). */
    readonly windDrift: number;
    /** Flames over liquid burn out this many times faster. */
    readonly douseFactor: number;
  };
  readonly infuse: {
    readonly radius: number;
    readonly heatDelta: number;
    /** A body at or above this temperature that is suddenly wetted or chilled is shocked. */
    readonly quenchTemp: number;
  };
  readonly freeze: {
    readonly radius: number;
    readonly coolDelta: number;
  };
  readonly charge: {
    /** Conductors within this distance of the caster's force point receive the full charge. */
    readonly radius: number;
    /** Extra gap (m) across which two conductors still connect. */
    readonly contactSlack: number;
    /** Share of charge passed on per hop. */
    readonly attenuation: number;
    readonly minCharge: number;
    readonly maxNodes: number;
    /** Wetness at which a non-conductive body (stone) starts to conduct. */
    readonly wetConductive: number;
    /** Material conductivity at which a body conducts while dry. */
    readonly dryConductivity: number;
    /** Electrified pools push bodies outward (m/s² at charge 1). */
    readonly shockAcceleration: number;
    readonly electrifiedSeconds: number;
    /** A guard reached with at least this charge overloads and shatters. */
    readonly guardOverload: number;
    /** A lodestone reached with at least this charge becomes an electromagnet. */
    readonly energizeThreshold: number;
    readonly energizedSeconds: number;
    /** Charged bodies keep their charge (visual + magnet response) this long. */
    readonly chargeSeconds: number;
  };
  readonly magnet: {
    /** Range of MAGNETIZE and of energized lodestones (m). */
    readonly range: number;
    /** Plummer-softened strength: a = k·r / (r² + ε²)^1.5 (m³/s²). */
    readonly strength: number;
    readonly softening: number;
    readonly maxAcceleration: number;
  };
  readonly gravity: {
    readonly radius: number;
    readonly strength: number;
    readonly softening: number;
    readonly maxAcceleration: number;
    /** Height of the well centre (m). */
    readonly height: number;
  };
  readonly body: {
    readonly wetDecayPerSecond: number;
    /** Hot bodies dry faster: decay × (1 + max(0, T − start) / start). */
    readonly heatDryingStart: number;
    readonly shockedSeconds: number;
    /** Fracture threshold multiplier while thermally shocked. */
    readonly shockedFractureScale: number;
  };
  readonly fracture: {
    readonly shardRadius: number;
    readonly shardMass: number;
    readonly shardLifetimeSeconds: number;
    readonly maxShards: number;
    /** Separation speed given to each shard (m/s). */
    readonly splitSpeed: number;
    /**
     * Share of the striker's pre-impact velocity it keeps when the struck stone or ice shatters:
     * brittle failure absorbs the hit instead of returning a full elastic bounce.
     */
    readonly passThrough: number;
  };
}

export const DEFAULT_ELEMENTS: ElementRules = {
  ambientTemp: 20,
  freezeTemp: -2,
  meltTemp: 3,
  boilTemp: 100,
  ambientRelaxPerSecond: 0.1,
  poolMixPerSecond: 0.6,
  maxPools: 8,
  maxSteams: 6,
  maxFlames: 6,
  pool: {
    radius: 2.2,
    maxRadius: 3.4,
    depthPerInfuse: 0.6,
    growPerInfuse: 0.4,
    lifetimeSeconds: 16,
    drag: 2.0,
    wetPerSecond: 3,
    contactHeight: 1.0,
  },
  ice: {
    height: 0.62,
    topScale: 0.55,
    restitution: 0.92,
    friction: 0.02,
    fractureImpulse: 240,
    shatterDepthKeep: 0.6,
  },
  steam: {
    lifetimeSeconds: 4.5,
    coreLift: 1.8,
    updraft: 16,
    ceiling: 5,
    spreadPerSecond: 0.5,
    maxRadius: 4.2,
  },
  flame: {
    radius: 1.7,
    lifetimeSeconds: 3.5,
    heatPerSecond: 70,
    windDrift: 0.35,
    douseFactor: 4,
  },
  infuse: {
    radius: 2.4,
    heatDelta: 70,
    quenchTemp: 90,
  },
  freeze: {
    radius: 2.6,
    coolDelta: -80,
  },
  charge: {
    radius: 2.6,
    contactSlack: 0.35,
    attenuation: 0.8,
    minCharge: 0.12,
    maxNodes: 14,
    wetConductive: 0.35,
    dryConductivity: 0.5,
    shockAcceleration: 22,
    electrifiedSeconds: 1.2,
    guardOverload: 0.5,
    energizeThreshold: 0.3,
    energizedSeconds: 2.5,
    chargeSeconds: 1.5,
  },
  magnet: {
    range: 7.5,
    strength: 70,
    softening: 1.2,
    maxAcceleration: 16,
  },
  gravity: {
    radius: 7,
    strength: 90,
    softening: 1.5,
    maxAcceleration: 24,
    height: 1.15,
  },
  body: {
    wetDecayPerSecond: 0.12,
    heatDryingStart: 40,
    shockedSeconds: 8,
    shockedFractureScale: 0.45,
  },
  fracture: {
    shardRadius: 0.36,
    shardMass: 5,
    shardLifetimeSeconds: 9,
    maxShards: 3,
    splitSpeed: 2.5,
    passThrough: 0.7,
  },
};
