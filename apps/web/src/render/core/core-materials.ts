/**
 * The Rift Core's materials (7C / D09): the plasma heart (layered filaments seen at depth, warmed
 * by heat, whitened by charge), the shell's plates (polished dark crystal you see the heart
 * through, each facet bending the view like a cut gem; hairline cracks of the heart's light that
 * brighten with spin) and the aura (the halo around its silhouette). Every input is a uniform the
 * component sets from authoritative state.
 */
import * as THREE from 'three';
import { NOISE_GLSL } from '../shaders';

/**
 * The heart's plasma, shared by the heart and by the view into it through the plates, so both show
 * the same filaments. Positions are in the core's object space (metres); `phase` is the plasma's
 * animation time (integrated by the component, so a change of energy never makes it jump).
 */
const PLASMA_GLSL = /* glsl */ `
  ${NOISE_GLSL}
  // Filament brightness, 0..1: where two drifting noise fields cross, a bright line in a soft
  // glow (light in a volume, not a vein drawn on a surface).
  float plasmaFilaments(vec3 p, float phase) {
    p *= 2.6;
    float n1 = fbm3(p + vec3(phase, -phase * 0.7, phase * 0.4));
    float n2 = fbm3(p * 1.6 - vec3(phase * 1.3, phase, -phase * 0.8));
    float d = abs(n1 - n2);
    return smoothstep(0.05, 0.0, d) * 0.75 + smoothstep(0.2, 0.0, d) * 0.3;
  }
  // The heart's colour where a ray meets it: deep violet (scaled by deepGain), lighter where it
  // faces the ray (its limb darkens), and the filaments in the hot colour.
  vec3 plasmaColour(float facing, float glow, float energy, vec3 hot, float deepGain) {
    vec3 deep = mix(vec3(0.07, 0.03, 0.16), vec3(0.30, 0.13, 0.55), pow(facing, 1.3)) * deepGain;
    return deep * (0.9 + 0.8 * energy) + hot * glow * (1.0 + 1.2 * energy)
      + vec3(0.55, 0.45, 0.85) * pow(facing, 6.0) * (0.25 + 0.45 * energy);
  }
`;

export interface HeartUniforms {
  /** The plasma's animation time. */
  uPhase: { value: number };
  uEnergy: { value: number };
  /** The filaments' colour (violet-white, warmed by heat, whitened by charge). */
  uHot: { value: THREE.Color };
  uFlash: { value: number };
  /** Extra brightness while the core is small on screen (readability, not a state). */
  uBoost: { value: number };
  /** The camera, in the core's object space (rays into the volume). */
  uCamObj: { value: THREE.Vector3 };
  [key: string]: { value: unknown };
}

/**
 * The heart: a sphere shaded as a volume. Filaments are sampled at the surface and at deeper
 * points along the view ray (`steps`, 1 on the low tier), so the plasma shows depth; the facing
 * term darkens the limb. Colours stay below white except the filaments' cores.
 */
export function createHeartMaterial(
  steps: number,
): THREE.ShaderMaterial & { uniforms: HeartUniforms } {
  const uniforms: HeartUniforms = {
    uPhase: { value: 0 },
    uEnergy: { value: 0 },
    uHot: { value: new THREE.Color(0.8, 0.7, 1.0) },
    uFlash: { value: 0 },
    uBoost: { value: 0 },
    uCamObj: { value: new THREE.Vector3(0, 0, 5) },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    defines: { STEPS: Math.max(1, Math.round(steps)) },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        vPos = position;
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uPhase;
      uniform float uEnergy;
      uniform vec3 uHot;
      uniform float uFlash;
      uniform float uBoost;
      uniform vec3 uCamObj;
      varying vec3 vPos;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      ${PLASMA_GLSL}
      void main() {
        float facing = clamp(dot(normalize(vNormalV), normalize(vViewV)), 0.0, 1.0);
        vec3 dir = normalize(vPos - uCamObj);
        float glow = 0.0;
        for (int i = 0; i < STEPS; i++) {
          glow += plasmaFilaments(vPos + dir * float(i) * 0.2, uPhase) / (1.0 + float(i) * 0.7);
        }
        glow /= float(STEPS) * 0.6 + 0.4;
        vec3 col = plasmaColour(facing, glow, uEnergy, uHot, 1.0);
        col *= (1.0 + uFlash * 3.0) * (1.0 + uBoost);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }) as THREE.ShaderMaterial & { uniforms: HeartUniforms };
}

export interface PlateUniforms {
  /** Plate separation (world metres at the core's scale 1). */
  uExplode: { value: number };
  /** Brightness of the light in the seams and cracks. */
  uCrack: { value: number };
  uCrackColor: { value: THREE.Color };
  /** 0..1: how small the core is on screen. Fine lines fade (they would alias) and the faces glow. */
  uSmall: { value: number };
  /** How much of the heart shows through the crystal, face-on (0 opaque .. 1 clear). */
  uClarity: { value: number };
  /** How much of the plasma's own violet passes the crystal (the filaments always do). */
  uDeepGain: { value: number };
  /** The crystal's colour on the light passing through it. */
  uTint: { value: THREE.Color };
  // Shared with the heart: the view into it shows the same plasma.
  uPhase: { value: number };
  uEnergy: { value: number };
  uHot: { value: THREE.Color };
  uCamObj: { value: THREE.Vector3 };
  /** The heart's radius (the sphere the view through the crystal meets). */
  uHeartR: { value: number };
}

/**
 * The shell's plates: polished dark crystal, lit by the scene (on the medium and high tiers a
 * physical material adds a clear coat and a faint thin-film sheen; the low tier keeps a standard
 * material). Face-on you see into it: the view ray is refracted at the facet and meets the heart,
 * whose plasma shows there, tinted by the crystal; at grazing angles the facet turns to mirror. The
 * vertex stage parts each plate along its own direction. Light leaks out of the seams (the plates'
 * side walls), a hairline round each facet and the cracks across some of them.
 */
export function createPlateMaterial(
  physical: boolean,
  heartRadius: number,
): {
  material: THREE.MeshStandardMaterial;
  uniforms: PlateUniforms;
} {
  const uniforms: PlateUniforms = {
    uExplode: { value: 0 },
    uCrack: { value: 0.6 },
    uCrackColor: { value: new THREE.Color('#b394ff') },
    uSmall: { value: 0 },
    uClarity: { value: 0.7 },
    uDeepGain: { value: 0.35 },
    uTint: { value: new THREE.Color(0.62, 0.5, 0.95) },
    uPhase: { value: 0 },
    uEnergy: { value: 0 },
    uHot: { value: new THREE.Color(0.8, 0.7, 1.0) },
    uCamObj: { value: new THREE.Vector3(0, 0, 5) },
    uHeartR: { value: heartRadius },
  };
  const base: THREE.MeshStandardMaterialParameters = {
    color: '#1a1430',
    metalness: 0,
    roughness: 0.07,
    envMapIntensity: 2.2,
  };
  const material = physical
    ? new THREE.MeshPhysicalMaterial({
        ...base,
        ior: 1.5,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        iridescence: 0.45,
        iridescenceIOR: 1.3,
        iridescenceThicknessRange: [200, 420],
      })
    : new THREE.MeshStandardMaterial(base);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // Medium and high (the physical variant) look two layers deep into the heart.
    if (physical) shader.fragmentShader = `#define CORE_DEEP\n${shader.fragmentShader}`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aDir;
        attribute float aSide;
        attribute float aDepth;
        attribute vec3 aBary;
        attribute float aSeed;
        uniform float uExplode;
        varying float vSide;
        varying float vDepth;
        varying vec3 vBary;
        varying float vSeed;
        varying vec3 vObjPos;
        varying vec3 vObjN;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed += aDir * uExplode * ( 0.7 + 0.6 * aSeed );
        vSide = aSide;
        vDepth = aDepth;
        vBary = aBary;
        vSeed = aSeed;
        vObjPos = transformed;
        vObjN = objectNormal;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uCrack;
        uniform vec3 uCrackColor;
        uniform float uSmall;
        uniform float uClarity;
        uniform float uDeepGain;
        uniform vec3 uTint;
        uniform float uPhase;
        uniform float uEnergy;
        uniform vec3 uHot;
        uniform vec3 uCamObj;
        uniform float uHeartR;
        varying float vSide;
        varying float vDepth;
        varying vec3 vBary;
        varying float vSeed;
        varying vec3 vObjPos;
        varying vec3 vObjN;
        ${PLASMA_GLSL}
        float coreSegDist( vec2 p, vec2 a, vec2 b ) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) );
        }
        // Distance to the plate's cracks, in its barycentric plane (corners (0,0), (1,0), (0,1)):
        // one from edge to edge with a kink, on some plates a branch to the third edge.
        float coreCracks( vec3 bary, float s ) {
          vec2 p = bary.yz;
          vec2 a = vec2( 0.2 + 0.6 * fract( s * 13.7 ), 0.0 );
          float v = 0.2 + 0.6 * fract( s * 7.31 );
          vec2 c = vec2( 1.0 - v, v );
          vec2 m = ( a + c ) * 0.5 + ( vec2( fract( s * 3.17 ), fract( s * 5.93 ) ) - 0.5 ) * 0.3;
          float d = min( coreSegDist( p, a, m ), coreSegDist( p, m, c ) );
          if ( fract( s * 2.31 ) > 0.45 ) {
            d = min( d, coreSegDist( p, m, vec2( 0.0, 0.25 + 0.5 * fract( s * 9.13 ) ) ) );
          }
          return d;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Each shard its own depth of colour: obsidian to smoky amethyst.
        diffuseColor.rgb *= 0.7 + 0.65 * vSeed;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 V = normalize( vObjPos - uCamObj );
          vec3 N = normalize( vObjN );
          float face = 1.0 - vSide;
          // Into the crystal: the view bends at this facet and meets the heart, whose plasma shows
          // there (each facet shows it displaced, as a cut gem does). Face-on the crystal is clear;
          // toward grazing it turns to mirror (the reflection is the material's own).
          vec3 rd = refract( V, N, 0.68 );
          if ( dot( rd, rd ) < 0.5 ) rd = V;
          float b = dot( vObjPos, rd );
          float h = b * b - ( dot( vObjPos, vObjPos ) - uHeartR * uHeartR );
          vec3 seen = vec3( 0.05, 0.02, 0.1 );
          if ( h > 0.0 ) {
            vec3 hit = vObjPos + rd * max( -b - sqrt( h ), 0.0 );
            float facing = clamp( -dot( rd, normalize( hit ) ), 0.0, 1.0 );
            // Through dark crystal the filaments carry; the plasma's own violet is mostly absorbed.
            float glow = plasmaFilaments( hit, uPhase );
            #ifdef CORE_DEEP
            // A second, fainter layer deeper in: the plasma has depth behind the facet.
            glow += plasmaFilaments( hit + rd * uHeartR * 0.35, uPhase ) * 0.45;
            #endif
            seen = plasmaColour( facing, glow, uEnergy, uHot, uDeepGain );
          }
          float cosV = clamp( dot( N, -V ), 0.0, 1.0 );
          float seeThrough = uClarity * ( 1.0 - pow( 1.0 - cosV, 4.0 ) );
          totalEmissiveRadiance += seen * uTint * seeThrough * face;

          // Light leaking out: the seams glow brighter toward the heart; a hairline round each
          // facet; the cracks across it. Fine lines fade when the core is small on screen (they
          // would alias), and the faces glow evenly instead.
          float wall = vSide * ( 0.25 + 0.75 * vDepth );
          float minB = min( vBary.x, min( vBary.y, vBary.z ) );
          float hair = 1.0 - smoothstep( 0.0, fwidth( minB ) * 1.5 + 0.006, minB );
          float cd = coreCracks( vBary, vSeed );
          float crack = ( 1.0 - smoothstep( 0.0, fwidth( cd ) * 1.5 + 0.003, cd ) ) * step( 0.3, fract( vSeed * 4.7 ) );
          float lines = ( hair * 0.7 + crack ) * face * ( 1.0 - uSmall );
          totalEmissiveRadiance += uCrackColor * uCrack * ( wall + lines + face * uSmall * 0.6 );
        }`,
      );
  };
  // One program per variant (the patch is the same for every core).
  material.customProgramCacheKey = () => `ff-core-plate-${physical ? 'p' : 's'}`;
  return { material, uniforms };
}

export interface AuraUniforms {
  uColor: { value: THREE.Color };
  uStrength: { value: number };
  [key: string]: { value: unknown };
}

/**
 * The aura: the far side of a sphere a little larger than the shell, brightest just outside the
 * core's silhouette and fading to nothing at its own edge. The core in front hides the rest, so
 * the halo rings the core without washing over its facets (D09: a halo silhouette on every tier).
 */
export function createAuraMaterial(): THREE.ShaderMaterial & { uniforms: AuraUniforms } {
  const uniforms: AuraUniforms = {
    uColor: { value: new THREE.Color('#b394ff') },
    uStrength: { value: 0.6 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        vNormalV = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        float facing = abs(dot(normalize(vNormalV), normalize(vViewV)));
        gl_FragColor = vec4(uColor * pow(facing, 1.5) * uStrength, 1.0);
      }`,
  }) as THREE.ShaderMaterial & { uniforms: AuraUniforms };
}
