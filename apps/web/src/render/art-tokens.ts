/**
 * Central art direction tokens (docs/CREATIVE_TARGET.md palette). Every material, light and fog
 * value is tuned here instead of being scattered across components.
 */
export const PALETTE = {
  skyAbyss: '#071421',
  storm: '#12364a',
  basaltShadow: '#202830',
  basaltPolished: '#343b42',
  coldSilver: '#9aaab7',
  brass: '#c18b53',
  amber: '#ff9c46',
  cyan: '#50d8e8',
  riftViolet: '#9c7dff',
  icePale: '#beeffc',
  waterDeep: '#0d688a',
  earthInterior: '#c76d32',
  arc: '#c7b7ff',
} as const;

export const TEAM_COLORS = [PALETTE.amber, PALETTE.cyan] as const;

export const LIGHTING = {
  exposure: 1.05,
  hemiSky: '#5f7f99',
  hemiGround: '#1a1f26',
  hemiIntensity: 0.9,
  keyColor: '#ffe6c7',
  keyIntensity: 3.6,
  /** Storm-break key light direction (from high side). */
  keyPosition: [-18, 34, 22] as const,
  fillColor: '#6fa8d8',
  fillIntensity: 0.8,
  fillPosition: [26, 14, -18] as const,
  coreLightIntensity: 14,
  coreLightDistance: 16,
  fogColor: '#0c1f2e',
  fogDensity: 0.0105,
  /** Image-based lighting strength from the procedural storm environment. */
  environmentIntensity: 0.65,
} as const;

export const MATERIALS = {
  floorRoughness: 0.72,
  floorMetalness: 0.04,
  wallColor: '#2a3139',
  wallRoughness: 0.8,
  brassRoughness: 0.32,
  brassMetalness: 0.95,
  steelColor: '#7f8d99',
  steelRoughness: 0.38,
  steelMetalness: 0.9,
  boulderColor: '#3d3a39',
  guardColor: '#4a4f58',
} as const;

/**
 * PBR surface recipes for the arena (Phase 07A / D07). `family` picks the procedural texture set
 * (arena/surfaces.ts); colours are the albedo range the detail value spans (sRGB hex); roughness
 * is the range the detail roughness spans; `wear` lightens and roughens bevelled edges;
 * `tileMetres` is the world size of one texture tile.
 */
export interface SurfaceRecipe {
  readonly family: 'basalt' | 'fractured' | 'rift' | 'brass' | 'steel';
  readonly colorLo: string;
  readonly colorHi: string;
  readonly roughness: readonly [number, number];
  readonly metalness: number;
  readonly normalStrength: number;
  readonly cavity: number;
  readonly wear: number;
  readonly wearColor: string;
  readonly tileMetres: number;
  readonly envMapIntensity?: number;
  readonly glowColor?: string;
  readonly glow?: number;
}

export const SURFACES = {
  /** Platform slabs and walls: dark basalt worn to a soft polish, pale chipped edges. */
  basaltPolished: {
    family: 'basalt',
    colorLo: '#14191f',
    colorHi: '#46505a',
    roughness: [0.3, 0.72],
    metalness: 0.04,
    normalStrength: 0.85,
    cavity: 0.8,
    wear: 0.45,
    wearColor: '#7a838b',
    tileMetres: 3.2,
    envMapIntensity: 0.9,
  },
  /** Gate pylons, monoliths, the broken rim: rough fractured stone with deep cracks. */
  basaltFractured: {
    family: 'fractured',
    colorLo: '#191c21',
    colorHi: '#565a60',
    roughness: [0.62, 0.95],
    metalness: 0.03,
    normalStrength: 1.25,
    cavity: 1,
    wear: 0.55,
    wearColor: '#8a8f93',
    tileMetres: 2.6,
  },
  /** Cold, frost-dusted stone (ice reactions, the chilled state of any slab). */
  basaltChilled: {
    family: 'fractured',
    colorLo: '#25333d',
    colorHi: '#a9c3d1',
    roughness: [0.45, 0.85],
    metalness: 0.02,
    normalStrength: 1.05,
    cavity: 0.7,
    wear: 0.3,
    wearColor: '#d8eef7',
    tileMetres: 2.6,
  },
  /** The underside mass: deep shadowed stone (seen from the elevated camera at the rim). */
  basaltDeep: {
    family: 'fractured',
    colorLo: '#0d1014',
    colorHi: '#2a2f35',
    roughness: [0.75, 0.98],
    metalness: 0.02,
    normalStrength: 1.4,
    cavity: 1,
    wear: 0.2,
    wearColor: '#40464c',
    tileMetres: 5,
  },
  /** Loose rubble and floating fragments: rough, unworn (rounded rocks carry no chipped edges). */
  basaltRubble: {
    family: 'fractured',
    colorLo: '#15181c',
    colorHi: '#464b52',
    roughness: [0.7, 0.96],
    metalness: 0.02,
    normalStrength: 1.2,
    cavity: 0.9,
    wear: 0.05,
    wearColor: '#5c6268',
    tileMetres: 1.8,
  },
  /** Distant formations: broad features (large tile) and enough value to read form in the haze. */
  basaltFar: {
    family: 'fractured',
    colorLo: '#1c2026',
    colorHi: '#5a6068',
    roughness: [0.75, 0.98],
    metalness: 0.02,
    normalStrength: 1.4,
    cavity: 0.8,
    wear: 0,
    wearColor: '#5a6068',
    tileMetres: 8,
  },
  /** Slabs the rift has cracked open: scorched stone, jagged glowing violet fissures. */
  riftCracked: {
    family: 'rift',
    colorLo: '#16141b',
    colorHi: '#46434f',
    roughness: [0.55, 0.9],
    metalness: 0.03,
    normalStrength: 1.3,
    cavity: 1,
    wear: 0.35,
    wearColor: '#7c7590',
    tileMetres: 5,
    glowColor: '#9c7dff',
    glow: 3,
  },
  /**
   * Hand-forged aged brass: bright worked metal, sparse low-lying oxide (rendered less metallic),
   * pale where handled. Used as trim and accents, never as a large field of colour.
   */
  brassAged: {
    family: 'brass',
    colorLo: '#4a2f17',
    colorHi: '#e6ad6c',
    roughness: [0.16, 0.7],
    metalness: 1,
    normalStrength: 0.4,
    cavity: 0.55,
    wear: 0.3,
    wearColor: '#f6cf98',
    tileMetres: 2.2,
    envMapIntensity: 1.35,
  },
  /** Cold brushed steel: ribs, frames, rings. */
  steelCold: {
    family: 'steel',
    colorLo: '#3c454e',
    colorHi: '#a2b0bb',
    roughness: [0.24, 0.58],
    metalness: 0.95,
    normalStrength: 0.35,
    cavity: 0.6,
    wear: 0.2,
    wearColor: '#cfd9e0',
    tileMetres: 1.8,
    envMapIntensity: 1.1,
  },
} as const satisfies Record<string, SurfaceRecipe>;

/** Arena set-dressing layout (Phase 07A): seeds, sizes and counts for the generators. */
export const ARENA_ART = {
  platform: {
    seed: 7,
    outerRadius: 32,
    sectors: 13,
    maxSlabDepth: 11,
    thickness: [1.4, 2.6] as const,
    gap: 0.16,
    bites: 4,
    cracked: 3,
    channel: 0.5,
  },
  /** Monumental columns on the rim: angle (radians from +X), radius, height, shaft radius. */
  monoliths: [
    { angle: 0.62, radius: 28.6, height: 19, shaft: 1.7, seed: 31 },
    { angle: Math.PI - 0.62, radius: 28.6, height: 16, shaft: 1.6, seed: 32 },
    { angle: Math.PI + 0.66, radius: 29, height: 21, shaft: 1.8, seed: 33 },
    { angle: -0.66, radius: 29, height: 15, shaft: 1.5, seed: 34 },
  ],
  /** Floating fragments around the rim (decor only: no collision). */
  shards: { count: 42, seed: 51 },
  /** Distant suspended formations (70–320 m) behind the fog. */
  formations: { count: 34, seed: 61, near: 70, far: 320 },
  /** Surface texture resolution per quality tier (px per tile). */
  surfaceTextureSize: { low: 256, medium: 512, high: 512 },
} as const;

export const POST = {
  bloomThreshold: 0.82,
  bloomIntensity: 0.9,
  bloomRadius: 0.62,
  vignette: 0.42,
} as const;

/** Rendering quality tiers (D08). Adaptive switching lands in Phase 07B. */
export interface QualityTier {
  readonly name: 'low' | 'medium' | 'high';
  readonly dpr: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly bloom: boolean;
  readonly textureSize: number;
}

export const QUALITY: Record<QualityTier['name'], QualityTier> = {
  low: {
    name: 'low',
    dpr: 0.8,
    shadows: false,
    shadowMapSize: 1024,
    bloom: false,
    textureSize: 1024,
  },
  medium: {
    name: 'medium',
    dpr: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    textureSize: 2048,
  },
  high: {
    name: 'high',
    dpr: 2,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    textureSize: 2048,
  },
};
