/**
 * The storm-break key light's two cheap modulations (Phase 07B / D08), shared by the arena's lit
 * materials through one patch of three's directional-light loop:
 *
 * - **Cloud shadows**: a tileable noise texture drifting with the wind darkens the key in broad,
 *   slow patches — the storm overhead, and large-scale light variation across the platform. One
 *   texture read per pixel; frozen under reduced motion.
 * - **Baked static shadows** (tiers without shadow maps): the walls, pillars, gates and rim
 *   columns are rendered once, flattened onto the ground along the key direction, into a mask
 *   that dims the key on ground-facing surfaces near the floor. The low tier keeps the arena's
 *   shadow story at no per-frame cost.
 *
 * Only the key is modulated (directional light 0: the shadow-casting light sorts first, and on
 * tiers without shadows it is the first directional light in the scene). Uniform objects are
 * shared, so updating a value updates every patched material without recompiling.
 */
import * as THREE from 'three';
import { CLOUD_SHADOWS } from './art-tokens';
import { ValueNoise2D } from './procedural';

export const keyLightUniforms = {
  ffCloudMap: { value: null as THREE.Texture | null },
  /** x: 1 / world size of one texture tile; y, z: drift offset (world m); w: strength. */
  ffCloud: { value: new THREE.Vector4(1 / CLOUD_SHADOWS.tileMetres, 0, 0, 0) },
  ffKeyMask: { value: null as THREE.Texture | null },
  /** x, z of the mask's corner (world m) and 1 / its size along x and z. */
  ffKeyMaskXform: { value: new THREE.Vector4(0, 0, 1, 1) },
  ffKeyMaskOn: { value: 0 },
};

const VERTEX_DECL = /* glsl */ `
varying vec3 vFfWorld;
`;

const VERTEX_BODY = /* glsl */ `
{
  vec4 ffW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    ffW = instanceMatrix * ffW;
  #endif
  vFfWorld = ( modelMatrix * ffW ).xyz;
}
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vFfWorld;
uniform sampler2D ffCloudMap;
uniform vec4 ffCloud;
uniform sampler2D ffKeyMask;
uniform vec4 ffKeyMaskXform;
uniform float ffKeyMaskOn;
// The key's share of light at this point: drifting cloud shadow × baked static shadow.
float ffKeyFactor( vec3 viewNormal ) {
  float k = 1.0;
  if ( ffCloud.w > 0.0 ) {
    float c = texture2D( ffCloudMap, ( vFfWorld.xz + ffCloud.yz ) * ffCloud.x ).r;
    k = 1.0 - ffCloud.w * smoothstep( 0.42, 0.68, c );
  }
  if ( ffKeyMaskOn > 0.5 ) {
    vec3 n = normalize( ( vec4( viewNormal, 0.0 ) * viewMatrix ).xyz );
    // The mask is flat on y = 0: ground-facing surfaces near the floor only (walls, pillars and
    // everything else skip the texture read — the low tier's weak GPUs pay per pixel).
    float w = smoothstep( 0.55, 0.9, n.y ) * ( 1.0 - smoothstep( 0.2, 0.9, abs( vFfWorld.y ) ) );
    if ( w > 0.0 ) {
      vec2 uv = ( vFfWorld.xz - ffKeyMaskXform.xy ) * ffKeyMaskXform.zw;
      k *= mix( 1.0, texture2D( ffKeyMask, uv, 1.0 ).r, w );
    }
  }
  return k;
}
`;

const LOOP_HOOK = 'getDirectionalLightInfo( directionalLight, directLight );';

/**
 * Adds the key modulation to a lit material's shader (call from `onBeforeCompile`). The material's
 * program cache key must change with this patch (it does when the patch is part of the material's
 * own onBeforeCompile).
 */
export function patchKeyLight(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, keyLightUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_BODY}`);
  const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
    LOOP_HOOK,
    `${LOOP_HOOK}\n\t\tdirectLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? ffKeyFactor( geometryNormal ) : 1.0;`,
  );
  if (lights === THREE.ShaderChunk.lights_fragment_begin)
    throw new Error('key-light: three.js directional-light loop changed; update LOOP_HOOK');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
    .replace('#include <lights_fragment_begin>', lights);
}

/**
 * A tileable cloud-shadow texture (single channel, 128² texels): four octaves of periodic value
 * noise, so the drift never shows a seam.
 */
export function cloudShadowTexture(size = 128, seed = 71): THREE.DataTexture {
  const octaves = [4, 8, 16, 32].map((period, i) => ({
    noise: new ValueNoise2D(seed + i, period),
    period,
    amp: 0.5 ** i,
  }));
  const norm = octaves.reduce((s, o) => s + o.amp, 0);
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves)
        v += o.noise.sample((x / size) * o.period, (y / size) * o.period) * o.amp;
      data[y * size + x] = Math.round((v / norm) * 255);
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** World rectangle the baked mask covers (the platform and everything that shades it). */
export interface MaskBounds {
  readonly minX: number;
  readonly minZ: number;
  readonly sizeX: number;
  readonly sizeZ: number;
}

const FLATTEN_VERTEX = /* glsl */ `
uniform vec3 uToLight;
void main() {
  vec4 w = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
    w = instanceMatrix * w;
  #endif
  w = modelMatrix * w;
  // Slide each point down the key's ray onto the ground plane (points below it stay put).
  float h = max( w.y, 0.0 );
  vec3 p = w.xyz - uToLight * ( h / uToLight.y );
  gl_Position = projectionMatrix * viewMatrix * vec4( p.x, 0.0, p.z, 1.0 );
}
`;

/**
 * Renders the static shadow casters under `root` (meshes with `castShadow`) flattened onto the
 * ground along `toLight` into a top-down mask: white is lit, black is shadow. Mipmapped, so a
 * biased read softens the edges. One draw per caster, once.
 */
export function bakeKeyShadowMask(
  gl: THREE.WebGLRenderer,
  root: THREE.Object3D,
  toLight: THREE.Vector3,
  bounds: MaskBounds,
  size = 1024,
): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(
    size,
    Math.round((size * bounds.sizeZ) / bounds.sizeX),
    {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    },
  );
  const flatten = new THREE.ShaderMaterial({
    uniforms: { uToLight: { value: toLight.clone().normalize() } },
    vertexShader: FLATTEN_VERTEX,
    fragmentShader: 'void main() { gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 ); }',
    side: THREE.DoubleSide,
  });
  const scene = new THREE.Scene();
  scene.overrideMaterial = flatten;
  root.updateWorldMatrix(true, true);
  const proxies: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    // Instanced decor (floating fragments) never shades the platform: skipped.
    if (!m.isMesh || !m.castShadow || !m.visible || (o as THREE.InstancedMesh).isInstancedMesh)
      return;
    const proxy = new THREE.Mesh(m.geometry);
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(m.matrixWorld);
    proxy.matrixWorld.copy(m.matrixWorld);
    proxy.frustumCulled = false;
    proxies.push(proxy);
    scene.add(proxy);
  });
  // Looking straight down, x to the right and z down the image: uv = (x, z) from the corner.
  const cam = new THREE.OrthographicCamera(
    bounds.minX,
    bounds.minX + bounds.sizeX,
    -bounds.minZ,
    -(bounds.minZ + bounds.sizeZ),
    -100,
    100,
  );
  cam.position.set(0, 50, 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  const prevTarget = gl.getRenderTarget();
  const prevColor = gl.getClearColor(new THREE.Color());
  const prevAlpha = gl.getClearAlpha();
  gl.setRenderTarget(target);
  gl.setClearColor(0xffffff, 1);
  gl.clear(true, false, false);
  gl.render(scene, cam);
  gl.setRenderTarget(prevTarget);
  gl.setClearColor(prevColor, prevAlpha);
  flatten.dispose();
  return target;
}

/** Points the shared mask uniforms at a baked mask (or switches the mask off with `null`). */
export function setKeyMask(target: THREE.WebGLRenderTarget | null, bounds?: MaskBounds): void {
  const u = keyLightUniforms;
  u.ffKeyMask.value = target?.texture ?? null;
  u.ffKeyMaskOn.value = target && bounds ? 1 : 0;
  // The bake's image has +x to the right and the far edge (min z) at the top, and a render
  // target's v runs bottom-up: v = (maxZ − z) / sizeZ.
  if (bounds)
    u.ffKeyMaskXform.value.set(
      bounds.minX,
      bounds.minZ + bounds.sizeZ,
      1 / bounds.sizeX,
      -1 / bounds.sizeZ,
    );
}
