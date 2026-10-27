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
