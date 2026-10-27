/**
 * Data-driven material coefficients shared by the authority and the renderer.
 * Values are game-scale approximations, not measured physical constants.
 */
export const MATERIAL_IDS = [
  'basalt',
  'basaltFractured',
  'steel',
  'brass',
  'riftCore',
  'guardStone',
  'ice',
  'water',
  'vapor',
] as const;

export type MaterialId = (typeof MATERIAL_IDS)[number];

export interface MaterialDef {
  readonly id: MaterialId;
  readonly restitution: number;
  readonly friction: number;
  /** kg / m^3 proxy used when a body has no explicit mass. */
  readonly density: number;
  /** 0 = insulator, 1 = ideal conductor (Phase 04 charge graph). */
  readonly conductivity: number;
  /** Contact impulse (N·s) above which a breakable body fractures; Infinity = unbreakable. */
  readonly fractureImpulse: number;
  /** Relative heat capacity proxy (Phase 04 thermal model). */
  readonly heatCapacity: number;
  readonly solid: boolean;
}

export const MATERIALS: Readonly<Record<MaterialId, MaterialDef>> = {
  basalt: {
    id: 'basalt',
    restitution: 0.55,
    friction: 0.5,
    density: 2900,
    conductivity: 0.02,
    fractureImpulse: Number.POSITIVE_INFINITY,
    heatCapacity: 1,
    solid: true,
  },
  basaltFractured: {
    id: 'basaltFractured',
    restitution: 0.4,
    friction: 0.7,
    density: 2700,
    conductivity: 0.02,
    fractureImpulse: 160,
    heatCapacity: 0.9,
    solid: true,
  },
  steel: {
    id: 'steel',
    restitution: 0.62,
    friction: 0.35,
    density: 7800,
    conductivity: 1,
    fractureImpulse: Number.POSITIVE_INFINITY,
    heatCapacity: 0.6,
    solid: true,
  },
  brass: {
    id: 'brass',
    restitution: 0.6,
    friction: 0.35,
    density: 8500,
    conductivity: 0.9,
    fractureImpulse: Number.POSITIVE_INFINITY,
    heatCapacity: 0.55,
    solid: true,
  },
  riftCore: {
    id: 'riftCore',
    restitution: 0.72,
    friction: 0.25,
    density: 3,
    conductivity: 0.5,
    fractureImpulse: Number.POSITIVE_INFINITY,
    heatCapacity: 1.2,
    solid: true,
  },
  guardStone: {
    id: 'guardStone',
    restitution: 0.85,
    friction: 0.4,
    density: 2400,
    conductivity: 0.05,
    fractureImpulse: 150,
    heatCapacity: 1,
    solid: true,
  },
  ice: {
    id: 'ice',
    restitution: 0.9,
    friction: 0.03,
    density: 917,
    conductivity: 0.05,
    fractureImpulse: 95,
    heatCapacity: 0.5,
    solid: true,
  },
  water: {
    id: 'water',
    restitution: 0,
    friction: 0,
    density: 1000,
    conductivity: 0.8,
    fractureImpulse: Number.POSITIVE_INFINITY,
    heatCapacity: 4,
    solid: false,
  },
  vapor: {
    id: 'vapor',
    restitution: 0,
    friction: 0,
    density: 0.6,
    conductivity: 0.1,
    fractureImpulse: Number.POSITIVE_INFINITY,
    heatCapacity: 2,
    solid: false,
  },
};
