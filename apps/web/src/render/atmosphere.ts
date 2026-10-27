/**
 * Aerial perspective (Phase 07B / D08). One sky gradient, written once in GLSL, is used by the sky
 * dome and by the fog of every built-in material, so a distant formation fades into exactly the
 * sky behind it — lighter, bluer, lower in contrast — instead of becoming a dark cut-out against a
 * brighter sky (three's stock fog has one colour for every direction).
 *
 * The fog is also layered: it is measured from the arena centre beyond FOG.start (the playing
 * field and the platform are never fogged, whatever the camera distance), and a height haze below
 * the platform sinks the underside and the lower formations into the cloud sea.
 *
 * `installAtmosphericFog()` replaces three's fog shader chunks (once, before any material
 * compiles); `scene.fog` keeps providing the horizon colour (fogColor) and the density.
 */
import * as THREE from 'three';
import { FOG, LIGHTING, SKY } from './art-tokens';

/** A token colour as a GLSL vec3 in linear working space (what the shaders light in). */
function glslColor(hex: string): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

/** Unit vector toward the storm-break key light (the sky's sun glow sits there). */
export const SUN_DIR = new THREE.Vector3(...LIGHTING.keyPosition).normalize();

const f = (n: number) => n.toFixed(4);

/**
 * `vec3 ffSky(vec3 dir, vec3 horizon, float glow)`: the sky colour seen along a world direction —
 * abyss zenith, storm body, bright horizon haze, the cloud sea below, the warm storm break scaled
 * by `glow` (1 for the sky itself; less for fog, which is in-scattered light, not the sun disc).
 */
export const SKY_GLSL = /* glsl */ `
const vec3 FF_ZENITH = ${glslColor(SKY.zenith)};
const vec3 FF_STORM = ${glslColor(SKY.storm)};
const vec3 FF_SEA = ${glslColor(SKY.sea)};
const vec3 FF_SEA_DEEP = ${glslColor(SKY.seaDeep)};
const vec3 FF_GLOW = ${glslColor(SKY.glow)};
const vec3 FF_SUN = vec3(${f(SUN_DIR.x)}, ${f(SUN_DIR.y)}, ${f(SUN_DIR.z)});
vec3 ffSky( vec3 dir, vec3 horizon, float glow ) {
  float h = dir.y;
  vec3 up = mix( horizon, FF_STORM, smoothstep( 0.02, 0.3, h ) );
  up = mix( up, FF_ZENITH, smoothstep( 0.28, 0.9, h ) );
  vec3 down = mix( horizon * 0.92, FF_SEA, smoothstep( 0.0, -0.12, h ) );
  down = mix( down, FF_SEA_DEEP, smoothstep( -0.12, -0.75, h ) );
  vec3 col = mix( down, up, smoothstep( -0.015, 0.015, h ) );
  float sun = max( dot( dir, FF_SUN ), 0.0 );
  vec2 flat2 = dir.xz + vec2( 1e-4 );
  float az = max( dot( normalize( flat2 ), normalize( FF_SUN.xz ) ), 0.0 );
  col += FF_GLOW * glow * ( pow( sun, 5.0 ) * 0.55 + pow( sun, 48.0 ) * 0.9 );
  col += FF_GLOW * glow * 0.16 * pow( az, 4.0 ) * ( 1.0 - smoothstep( 0.0, 0.45, abs( h ) ) );
  return col;
}
`;

const FOG_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

const FOG_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // World position from the view-space one (instancing and skinning already applied).
  vFogWorld = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;

const FOG_PARS_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${SKY_GLSL}
#endif
`;

const FOG_FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  float ffBeyond = max( 0.0, length( vFogWorld ) - ${f(FOG.start)} );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * ffBeyond * ffBeyond );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, ffBeyond );
  #endif
  fogFactor = max( fogFactor,
    smoothstep( ${f(FOG.hazeTop)}, ${f(FOG.hazeBottom)}, vFogWorld.y ) * ${f(FOG.hazeMax)} );
  // The field and the platform have no fog at all: skip the sky colour there.
  if ( fogFactor > 0.001 )
    gl_FragColor.rgb = mix( gl_FragColor.rgb, ffSky( normalize( vFogWorld - cameraPosition ), fogColor, 0.4 ), fogFactor );
#endif
`;

let installed = false;

/** Replaces three's fog chunks with the aerial-perspective fog (idempotent; before compiling). */
export function installAtmosphericFog(): void {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.fog_pars_vertex = FOG_PARS_VERTEX;
  THREE.ShaderChunk.fog_vertex = FOG_VERTEX;
  THREE.ShaderChunk.fog_pars_fragment = FOG_PARS_FRAGMENT;
  THREE.ShaderChunk.fog_fragment = FOG_FRAGMENT;
}

/**
 * The fog amount at a world point (mirrors FOG_FRAGMENT, for tests and for CPU-side decisions
 * such as fading decor that the fog would fully hide).
 */
export function fogAmount(p: THREE.Vector3, density = LIGHTING.fogDensity): number {
  const beyond = Math.max(0, p.length() - FOG.start);
  const dist = 1 - Math.exp(-density * density * beyond * beyond);
  const t = Math.min(1, Math.max(0, (p.y - FOG.hazeTop) / (FOG.hazeBottom - FOG.hazeTop)));
  return Math.max(dist, t * t * (3 - 2 * t) * FOG.hazeMax);
}
