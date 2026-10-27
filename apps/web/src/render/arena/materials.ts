/**
 * Arena PBR materials (Phase 07A / D07): MeshStandardMaterial extended with triplanar sampling of
 * the procedural surface textures, so generated geometry needs no UV unwrapping and every face
 * gets correctly scaled detail. One shader program serves every variant (uniform-driven):
 *
 * - albedo: a token colour range modulated by the detail value, darkened in cavities, lightened
 *   on worn edges (bevels: normals between floor and wall), multiplied by per-vertex tint;
 * - macro variation: the detail value sampled again at ~9× the tile size (top projection, one
 *   fetch) so large surfaces never show the tile repeating;
 * - roughness: a token range driven by the detail roughness, rougher on chipped edges;
 * - metalness: lowered where the cavity channel marks oxide or dirt (both are dielectrics);
 * - normal: world-space triplanar normal mapping (whiteout blend);
 * - wet: darker and glossier (world material state can drive it);
 * - glowing cracks: emissive along the crack mask (fresh fractures, rift-charged stone).
 *
 * Everything is tuned in art-tokens (SURFACES); nothing per-frame allocates.
 *
 * Contract: geometry drawn with a SurfaceMaterial carries a `color` attribute (the generators in
 * arena/geometry always add one). Without it WebGL feeds the shader black — three.js only fills
 * missing attributes for ShaderMaterials — so development builds warn once per geometry.
 */
import * as THREE from 'three';
import { SURFACES, type SurfaceRecipe } from '../art-tokens';
import { surfaceTextures } from './surfaces';

export type SurfaceName = keyof typeof SURFACES;

interface TriplanarUniforms {
  uDetail: { value: THREE.Texture };
  uNormal: { value: THREE.Texture };
  uScale: { value: number };
  uColorLo: { value: THREE.Color };
  uColorHi: { value: THREE.Color };
  uRough: { value: THREE.Vector2 };
  uNormalStrength: { value: number };
  uCavity: { value: number };
  uWear: { value: number };
  uWearColor: { value: THREE.Color };
  uWet: { value: number };
  uGlowColor: { value: THREE.Color };
  uGlow: { value: number };
}

const VERTEX_DECL = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
`;

const VERTEX_BODY = /* glsl */ `
vec4 triWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  triWorld = instanceMatrix * triWorld;
#endif
triWorld = modelMatrix * triWorld;
vTriPos = triWorld.xyz;
// World normal from three's view-space normal, which already handles non-uniform object and
// instance scale (v · M multiplies by the transpose: the inverse of the view rotation).
vTriNormal = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vTriPos;
varying vec3 vTriNormal;
uniform sampler2D uDetail;
uniform sampler2D uNormal;
uniform float uScale;
uniform vec3 uColorLo;
uniform vec3 uColorHi;
uniform vec2 uRough;
uniform float uNormalStrength;
uniform float uCavity;
uniform float uWear;
uniform vec3 uWearColor;
uniform float uWet;
uniform vec3 uGlowColor;
uniform float uGlow;

vec3 triBlend( vec3 n ) {
  vec3 b = pow( abs( n ), vec3( 4.0 ) );
  return b / ( b.x + b.y + b.z + 1e-5 );
}
vec4 triSample( sampler2D t, vec3 p, vec3 w ) {
  return texture2D( t, p.zy ) * w.x + texture2D( t, p.xz ) * w.y + texture2D( t, p.xy ) * w.z;
}
`;

const MAP = /* glsl */ `
vec3 triW = triBlend( vTriNormal );
vec3 triP = vTriPos * uScale;
vec4 triD = triSample( uDetail, triP, triW );
float triNy = abs( normalize( vTriNormal ).y );
// Bevels sit between the floor-facing and wall-facing normals: worn, chipped, lighter.
float triEdge = smoothstep( 0.12, 0.35, triNy ) * ( 1.0 - smoothstep( 0.8, 0.96, triNy ) );
vec3 triAlbedo = mix( uColorLo, uColorHi, triD.r );
// Macro variation (one fetch, top projection, heavily mipmapped): breaks up the tile repeat.
triAlbedo *= mix( 0.8, 1.14, texture2D( uDetail, vTriPos.xz * uScale * 0.11 ).r );
triAlbedo *= mix( 1.0, 0.5, triD.b * uCavity );
triAlbedo = mix( triAlbedo, uWearColor, triEdge * uWear );
triAlbedo *= mix( 1.0, 0.55, uWet );
diffuseColor.rgb *= triAlbedo;
`;

const ROUGHNESS = /* glsl */ `
float roughnessFactor = mix( uRough.x, uRough.y, triD.g );
roughnessFactor = mix( roughnessFactor, min( 1.0, roughnessFactor + 0.22 ), triEdge * uWear );
roughnessFactor = mix( roughnessFactor, 0.12, uWet );
`;

const METALNESS = /* glsl */ `
float metalnessFactor = metalness * ( 1.0 - triD.b * uCavity );
`;

const NORMAL = /* glsl */ `
{
  vec3 nW = normalize( vTriNormal );
  vec3 tX = texture2D( uNormal, triP.zy ).xyz * 2.0 - 1.0;
  vec3 tY = texture2D( uNormal, triP.xz ).xyz * 2.0 - 1.0;
  vec3 tZ = texture2D( uNormal, triP.xy ).xyz * 2.0 - 1.0;
  float s = uNormalStrength * ( 1.0 - 0.6 * uWet );
  tX.xy *= s; tY.xy *= s; tZ.xy *= s;
  // Whiteout blend in world space (B. Golus, "Normal Mapping for a Triplanar Shader").
  tX = vec3( tX.xy + nW.zy, abs( tX.z ) * nW.x );
  tY = vec3( tY.xy + nW.xz, abs( tY.z ) * nW.y );
  tZ = vec3( tZ.xy + nW.xy, abs( tZ.z ) * nW.z );
  vec3 nPert = normalize( tX.zyx * triW.x + tY.xzy * triW.y + tZ.xyz * triW.z );
  normal = normalize( ( viewMatrix * vec4( nPert, 0.0 ) ).xyz );
}
`;

const EMISSIVE = /* glsl */ `
totalEmissiveRadiance += uGlowColor * uGlow * smoothstep( 0.35, 0.9, triD.a );
`;

/** A MeshStandardMaterial with the triplanar surface; its uniforms are live (state can drive them). */
export class SurfaceMaterial extends THREE.MeshStandardMaterial {
  readonly tri: TriplanarUniforms;

  constructor(recipe: SurfaceRecipe, textureSize: number) {
    super({ color: '#ffffff', roughness: 1, vertexColors: true });
    const tex = surfaceTextures(recipe.family, textureSize);
    this.tri = {
      uDetail: { value: tex.detail },
      uNormal: { value: tex.normal },
      uScale: { value: 1 },
      uColorLo: { value: new THREE.Color() },
      uColorHi: { value: new THREE.Color() },
      uRough: { value: new THREE.Vector2() },
      uNormalStrength: { value: 1 },
      uCavity: { value: 1 },
      uWear: { value: 0 },
      uWearColor: { value: new THREE.Color() },
      uWet: { value: 0 },
      uGlowColor: { value: new THREE.Color() },
      uGlow: { value: 0 },
    };
    this.applyRecipe(recipe, textureSize);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.tri);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
        .replace('#include <map_fragment>', MAP)
        .replace('#include <roughnessmap_fragment>', ROUGHNESS)
        .replace('#include <metalnessmap_fragment>', METALNESS)
        .replace('#include <normal_fragment_maps>', NORMAL)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EMISSIVE}`);
    };
    // Every SurfaceMaterial compiles the same program; only uniforms differ.
    this.customProgramCacheKey = () => 'ff-surface-v2';
    if (import.meta.env.DEV) {
      this.onBeforeRender = (_r, _s, _c, geometry, object) => {
        if (geometry.hasAttribute('color') || uncoloured.has(geometry)) return;
        uncoloured.add(geometry);
        console.warn(
          `SurfaceMaterial: "${object.name || object.type}" has no vertex colour attribute and ` +
            'renders black — build it with the arena generators (they add one).',
        );
      };
    }
  }

  /**
   * Switches this surface to another recipe at runtime — how world material state (chilled,
   * charged, scorched…) changes a surface: uniforms only, the same shader program, no recompile.
   * `uWet` is separate and live (water state layers over any recipe).
   */
  applyRecipe(recipe: SurfaceRecipe, textureSize: number): void {
    const tex = surfaceTextures(recipe.family, textureSize);
    const u = this.tri;
    u.uDetail.value = tex.detail;
    u.uNormal.value = tex.normal;
    u.uScale.value = 1 / recipe.tileMetres;
    u.uColorLo.value.set(recipe.colorLo);
    u.uColorHi.value.set(recipe.colorHi);
    u.uRough.value.set(recipe.roughness[0], recipe.roughness[1]);
    u.uNormalStrength.value = recipe.normalStrength;
    u.uCavity.value = recipe.cavity;
    u.uWear.value = recipe.wear;
    u.uWearColor.value.set(recipe.wearColor);
    u.uGlowColor.value.set(recipe.glowColor ?? '#000000');
    u.uGlow.value = recipe.glow ?? 0;
    this.metalness = recipe.metalness;
    this.envMapIntensity = recipe.envMapIntensity ?? 1;
  }
}

const uncoloured = new WeakSet<THREE.BufferGeometry>();

/** Builds the named surface from its art-token recipe. */
export function surfaceMaterial(name: SurfaceName, textureSize: number): SurfaceMaterial {
  return new SurfaceMaterial(SURFACES[name], textureSize);
}
