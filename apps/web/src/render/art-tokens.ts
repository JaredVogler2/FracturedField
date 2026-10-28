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

/**
 * Sky and aerial perspective (Phase 07B / D08): one gradient shared by the sky dome and the fog,
 * so anything far away dissolves into the sky behind it (lighter, bluer, less contrast) instead of
 * turning into a dark cut-out.
 */
export const SKY = {
  zenith: '#050c16',
  storm: '#0f2a3d',
  /** Haze at the horizon — also the fog colour. */
  horizon: '#2f5a74',
  /** The cloud sea the platform floats over: just below the horizon, and far below. */
  sea: '#264861',
  seaDeep: '#0a1622',
  /** Storm-break light (sky glow, cloud rims, light shafts). */
  glow: '#ffbf80',
} as const;

/**
 * Fog layering: nothing on the platform is fogged (the field stays crisp from any camera); fog
 * grows with distance beyond `start` metres from the arena centre, and a haze thickens below the
 * platform (`hazeTop` → `hazeBottom`, up to `hazeMax`).
 */
export const FOG = { start: 36, hazeTop: -6, hazeBottom: -42, hazeMax: 0.85 } as const;

/**
 * Selected lighting (D08 "final"): a warm storm-break key raking from the far left at ~31° — it
 * rims the brass and the columns and throws long shadows toward the camera — against cool, weak
 * sky light: a camera-side fill, a hemisphere and image-based light from the procedural storm
 * environment. Lit stone reads warm, shadow reads blue (round b2: the key carries about four
 * times the ambient on the floor; in b1 it was about twice, and the frame read flat). Round b5
 * raised every light ~35 % (not the exposure, which would also brighten the sky): sunlit black
 * basalt had sat at ~50/255 and the frames' median luma at 0.13.
 */
export const LIGHTING = {
  exposure: 1.1,
  hemiSky: '#6c9ad0',
  hemiGround: '#1a1f27',
  hemiIntensity: 1.05,
  /**
   * Pale gold (~3800 K), not orange: an orange key turns the blue-grey basalt brown (b2); this
   * one leaves lit stone a warm neutral against blue shadow.
   */
  keyColor: '#ffe0bd',
  keyIntensity: 8.9,
  /** Storm-break key direction (from the arena centre toward the light). */
  keyPosition: [-30, 24, -26] as const,
  fillColor: '#5f9de0',
  fillIntensity: 0.68,
  fillPosition: [24, 12, 30] as const,
  coreLightIntensity: 14,
  coreLightDistance: 16,
  fogColor: SKY.horizon,
  /** Exp² density of the fog beyond FOG.start. */
  fogDensity: 0.0095,
  /** Image-based lighting strength from the procedural storm environment. */
  environmentIntensity: 0.85,
} as const;

/**
 * The storm environment the image-based light is filtered from (radiance of each emissive panel,
 * linear multiples of its colour). Its zenith must match the storm sky — dark — or every
 * upward-facing metal face mirrors a bright sky the frame does not show (b1's white bar on a
 * gate); the warm break where the key sits is what brass should catch.
 */
export const ENVIRONMENT = {
  breakColor: SKY.glow,
  breakRadiance: 7,
  zenithColor: '#47729a',
  zenithRadiance: 0.55,
  horizonColor: '#3b6f93',
  horizonRadiance: 1.0,
} as const;

/**
 * Drifting cloud shadows on the key (render/key-light.ts): world size of one noise tile (m),
 * drift (m/s, x and z) and how much of the key a dense patch takes away. Verified in round b3 at
 * strength 0.95 (broad shade patches across the field); 0.4 was too faint to see in a still.
 */
export const CLOUD_SHADOWS = {
  tileMetres: 48,
  drift: [0.9, 0.35] as const,
  strength: 0.6,
} as const;

/**
 * Fire braziers (render/braziers.tsx): the arena's practical lights. Spots (x, z) stand on the
 * flush first ring of slabs, outside the walls — four behind the far wall (flanking the centre
 * line and the corners), two flanking each gate — never on the camera's side. `flame` is the HDR
 * strength of the flame sheet (blooms), `pool` that of the warm light on the stone (radius m).
 */
export const BRAZIERS = {
  spots: [
    [-4.6, -16.6],
    [4.6, -16.6],
    [-18.5, -16.2],
    [18.5, -16.2],
    [-26.4, -8.6],
    [-26.4, 8.6],
    [26.4, -8.6],
    [26.4, 8.6],
  ] as readonly (readonly [number, number])[],
  flame: 2.1,
  lightColor: '#ff9a4a',
  pool: 0.16,
  poolRadius: 4.2,
} as const;

/**
 * Sky islands with towers and waterfalls (render/far-world.tsx): the far world's storytelling,
 * set toward the storm break (north-west) and the north, 100–160 m out. Island: centre (top
 * surface), seed, top half-width and root depth (m); towers: [dx, dz, radius, height]; fall:
 * [lip dx, lip dz, width, drop] on the side facing the arena.
 */
export interface SkyIsland {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly seed: number;
  readonly width: number;
  readonly depth: number;
  readonly towers: readonly (readonly [number, number, number, number])[];
  readonly fall?: readonly [number, number, number, number];
}

export const FAR_WORLD = {
  stone: '#3a4450',
  windowColor: '#ffb066',
  /** Share of windows lit. */
  litShare: 0.34,
  islands: [
    {
      x: -102,
      y: 6,
      z: -42,
      seed: 401,
      width: 24,
      depth: 34,
      towers: [
        [0, 0, 5.2, 46],
        [9, 6, 3.2, 28],
        [-8, 6, 2.6, 22],
      ],
      fall: [19, 8, 7, 95],
    },
    {
      x: -92,
      y: -4,
      z: -112,
      seed: 402,
      width: 20,
      depth: 30,
      towers: [
        [0, 0, 4.2, 38],
        [7, -6, 2.6, 24],
      ],
      fall: [10, 13, 5, 85],
    },
    { x: -148, y: 16, z: 30, seed: 403, width: 18, depth: 26, towers: [[0, 0, 3.6, 34]] },
    {
      x: 46,
      y: 10,
      z: -146,
      seed: 404,
      width: 22,
      depth: 30,
      towers: [
        [0, 0, 4.8, 42],
        [-8, 5, 2.8, 26],
      ],
      fall: [-6, 18, 6, 90],
    },
  ] as readonly SkyIsland[],
} as const;

/**
 * Emissive accents on the architecture: kept below the bloom threshold's reach so the core,
 * scoring and casts stay the brightest things on screen (CREATIVE_TARGET: "never saturate every
 * emissive object").
 */
export const GLOW = {
  /** Rune inscriptions around the field pillars (a glyph texture, not a solid band). */
  pillarRunes: 1.8,
  /** The team motif on each gate's keystone. */
  gateMotif: 1.5,
  /** The engraved team inlays on the wielders' plinths. */
  plinthInlay: 1.4,
} as const;

export type LightingVariant = {
  readonly [K in keyof typeof LIGHTING]: (typeof LIGHTING)[K] extends string
    ? string
    : (typeof LIGHTING)[K] extends number
      ? number
      : (typeof LIGHTING)[K];
};

/**
 * D08 comparison variants (same light directions, different ratios): `final` is the selection;
 * `flat` has ambient and fill as strong as the key (no shadow story, no depth); `dark` has the key
 * alone at low exposure (moody, but the field cannot be read).
 */
export const LIGHT_VARIANTS = {
  final: LIGHTING,
  flat: {
    ...LIGHTING,
    exposure: 1.05,
    keyIntensity: 2.4,
    hemiIntensity: 1.4,
    fillIntensity: 1.2,
    environmentIntensity: 1.1,
    fogDensity: 0.006,
  },
  dark: {
    ...LIGHTING,
    exposure: 0.62,
    keyIntensity: 5.5,
    hemiIntensity: 0.15,
    fillIntensity: 0,
    environmentIntensity: 0.2,
    fogDensity: 0.014,
  },
} as const satisfies Record<string, LightingVariant>;

export type LightVariantName = keyof typeof LIGHT_VARIANTS;

/**
 * Storm-wet field floor (render/floor-texture.ts): rain lies in broad patches (noise between
 * `patch` → fully wet) and along the joints; wet stone is darker by `darken` and its roughness
 * falls to `roughness` (a near-mirror that catches the sky and the key).
 */
export const FLOOR_WET = { patch: [0.6, 0.68] as const, darken: 0.38, roughness: 0.08 } as const;

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
    // Worked metal: a tight glint line along a lit edge, not a broad lobe lighting a whole rail
    // (b2: rails and tie beams read as neon tubes).
    roughness: [0.2, 0.55],
    metalness: 1,
    normalStrength: 0.4,
    cavity: 0.55,
    wear: 0.3,
    wearColor: '#f6cf98',
    tileMetres: 2.2,
    envMapIntensity: 1.15,
  },
  /** Cold brushed steel: ribs, frames, rings. */
  steelCold: {
    family: 'steel',
    colorLo: '#3c454e',
    colorHi: '#a2b0bb',
    // Brushed and hazed: a flat steel top in the sun's mirror direction lights up all at once,
    // so its lobe is kept broad and low (b4: a white bar along a gate beam at 0.16-0.48).
    roughness: [0.36, 0.62],
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
  /**
   * Distant suspended formations (70–320 m) behind the fog. `openSky`: none stand at azimuths
   * (atan2(z, x), radians) above the first or below the second value — the west to north-west
   * sky, toward the storm break, is left to the sky islands (7B round b5: two formations filled
   * the menu's view of the break).
   */
  formations: { count: 34, seed: 61, near: 70, far: 320, openSky: [2.6, -2.0] as const },
  /** The underside tiers' hidden tops: the deep shadow under the slabs and overhangs. */
  undersideCap: '#06080b',
  /** Surface texture resolution per quality tier (px per tile). */
  surfaceTextureSize: { low: 256, medium: 512, high: 512 },
} as const;

export const POST = {
  bloomThreshold: 0.82,
  bloomIntensity: 0.9,
  bloomRadius: 0.62,
  vignette: 0.42,
} as const;

/**
 * Rendering quality tiers (D08). Simulation, collision and scoring are identical on every tier —
 * only rendering cost changes. `auto` picks a tier from the device class and then adapts to the
 * measured frame rate (render/adaptive-quality.ts); real-time reflections are image-based on all
 * tiers (no reflection probes or SSR).
 */
export interface QualityTier {
  readonly name: 'low' | 'medium' | 'high';
  /** Device-pixel-ratio cap. */
  readonly dpr: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Selective (thresholded) bloom on emissives. */
  readonly bloom: boolean;
  /** Field-floor texture width (px). */
  readonly textureSize: number;
  /** Drifting cloud sheets below the platform. */
  readonly cloudLayers: number;
  /** Storm-break light shafts. */
  readonly shafts: boolean;
  /** Floating dust motes in the key light. */
  readonly dust: number;
  /**
   * Sky: `high` adds cirrus and a full-octave cloud sea; `baked` renders the `low` sky once into
   * a cube map (one texture read per pixel instead of the procedural storm; no slow drift).
   */
  readonly sky: 'baked' | 'low' | 'high';
  /** Element particle density multiplier. */
  readonly particles: number;
  /** Dynamic point lights: the core's, plus the two gate lights when ≥ 3. */
  readonly pointLights: number;
  /**
   * Drifting cloud shadows on the key (one texture read per lit pixel). Off on low, to spare the
   * weakest GPUs that read. Not separately measurable here: all of 7B's additions together cost
   * the low tier ~8 % on the software-rendered phone view (≈125 vs ≈115 ms a frame).
   */
  readonly cloudShadows: boolean;
  /** Heat refraction above flames (a screen-space shimmer in the post pass); high only. */
  readonly heatHaze: boolean;
}

export const QUALITY: Record<QualityTier['name'], QualityTier> = {
  low: {
    name: 'low',
    dpr: 0.8,
    shadows: false,
    shadowMapSize: 1024,
    bloom: false,
    textureSize: 1024,
    cloudLayers: 0,
    shafts: false,
    dust: 0,
    sky: 'baked',
    particles: 0.5,
    pointLights: 1,
    cloudShadows: false,
    heatHaze: false,
  },
  medium: {
    name: 'medium',
    dpr: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    textureSize: 2048,
    cloudLayers: 2,
    shafts: true,
    dust: 260,
    sky: 'low',
    particles: 0.75,
    pointLights: 3,
    cloudShadows: true,
    heatHaze: false,
  },
  high: {
    name: 'high',
    dpr: 2,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    textureSize: 2048,
    cloudLayers: 2,
    shafts: true,
    dust: 560,
    sky: 'high',
    particles: 1,
    pointLights: 3,
    cloudShadows: true,
    heatHaze: true,
  },
};
