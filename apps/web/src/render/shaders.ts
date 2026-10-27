import * as THREE from 'three';
import { SKY_GLSL } from './atmosphere';
import { SKY } from './art-tokens';

/**
 * Original GLSL materials. Each factory returns a material with typed uniforms; callers update
 * `uTime` (and state uniforms) per frame and dispose on unmount.
 */

const NOISE_GLSL = /* glsl */ `
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yxz + 19.19);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n = mix(
      mix(mix(dot(hash33(i) - 0.5, f), dot(hash33(i + vec3(1,0,0)) - 0.5, f - vec3(1,0,0)), u.x),
          mix(dot(hash33(i + vec3(0,1,0)) - 0.5, f - vec3(0,1,0)), dot(hash33(i + vec3(1,1,0)) - 0.5, f - vec3(1,1,0)), u.x), u.y),
      mix(mix(dot(hash33(i + vec3(0,0,1)) - 0.5, f - vec3(0,0,1)), dot(hash33(i + vec3(1,0,1)) - 0.5, f - vec3(1,0,1)), u.x),
          mix(dot(hash33(i + vec3(0,1,1)) - 0.5, f - vec3(0,1,1)), dot(hash33(i + vec3(1,1,1)) - 0.5, f - vec3(1,1,1)), u.x), u.y), u.z);
    return n * 2.0 + 0.5;
  }
  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise3(p); p *= 2.07; a *= 0.5; }
    return s;
  }
`;

export interface CoreUniforms {
  uTime: { value: number };
  uEnergy: { value: number };
  uColorA: { value: THREE.Color };
  uColorB: { value: THREE.Color };
  [key: string]: { value: unknown };
}

/** Inner plasma volume of the Rift Core: view-dependent depth illusion with turbulent filaments. */
export function createCorePlasmaMaterial(): THREE.ShaderMaterial & { uniforms: CoreUniforms } {
  const uniforms: CoreUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 },
    uColorA: { value: new THREE.Color('#9c7dff') },
    uColorB: { value: new THREE.Color('#e9f4ff') },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uEnergy;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec3 vPos;
      varying vec3 vNormal;
      varying vec3 vView;
      ${NOISE_GLSL}
      void main() {
        float facing = clamp(dot(vNormal, vView), 0.0, 1.0);
        vec3 p = vPos * 2.4;
        float t = uTime * 0.35;
        float n1 = fbm3(p + vec3(t, -t * 0.7, t * 0.4));
        float n2 = fbm3(p * 1.9 - vec3(t * 1.3, t, -t * 0.8));
        float filaments = smoothstep(0.04, 0.0, abs(n1 - n2)) + smoothstep(0.035, 0.0, abs(n1 - 0.5)) * 0.9;
        float depth = pow(facing, 1.6);
        vec3 col = mix(uColorA * 0.55, uColorB, depth * (0.55 + 0.45 * n2));
        col += uColorB * filaments * (0.8 + uEnergy);
        col *= 1.4 + uEnergy * 1.6;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }) as THREE.ShaderMaterial & { uniforms: CoreUniforms };
}

export interface ShellUniforms {
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uIntensity: { value: number };
  [key: string]: { value: unknown };
}

/** Thin refractive-looking outer shell: Fresnel rim with drifting hairline cracks. */
export function createCoreShellMaterial(): THREE.ShaderMaterial & { uniforms: ShellUniforms } {
  const uniforms: ShellUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#b9a8ff') },
    uIntensity: { value: 1 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        vPos = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      ${NOISE_GLSL}
      void main() {
        float f = 1.0 - clamp(dot(vNormal, vView), 0.0, 1.0);
        float rim = pow(f, 2.6);
        float cracks = smoothstep(0.03, 0.0, abs(noise3(vPos * 3.1 + uTime * 0.05) - 0.5));
        float a = rim * 0.85 + cracks * 0.35 * (0.4 + f);
        gl_FragColor = vec4(uColor * a * uIntensity, a);
      }
    `,
  }) as THREE.ShaderMaterial & { uniforms: ShellUniforms };
}

export interface MembraneUniforms {
  uTime: { value: number };
  uColor: { value: THREE.Color };
  uPulse: { value: number };
  [key: string]: { value: unknown };
}

/** Rift gate receiver membrane: slow vortex swirl, bright rim, pulse on goals. */
export function createMembraneMaterial(
  color: string,
): THREE.ShaderMaterial & { uniforms: MembraneUniforms } {
  const uniforms: MembraneUniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(color) },
    uPulse: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPulse;
      varying vec2 vUv;
      ${NOISE_GLSL}
      void main() {
        vec2 c = vUv - vec2(0.5, 0.35);
        float r = length(c * vec2(1.0, 1.25));
        float ang = atan(c.y, c.x);
        float swirl = fbm3(vec3(cos(ang) * 2.0 + r * 4.0, sin(ang) * 2.0 - uTime * 0.4, r * 3.0 - uTime * 0.25));
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x) * smoothstep(0.0, 0.05, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
        float rim = (1.0 - edge);
        float core = smoothstep(0.75, 0.0, r);
        float a = (0.12 + swirl * 0.28) * core * edge + rim * 0.55 + uPulse * 0.9 * core;
        vec3 col = uColor * (0.6 + swirl * 0.9 + uPulse * 2.5) + vec3(1.0) * rim * 0.25;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  }) as THREE.ShaderMaterial & { uniforms: MembraneUniforms };
}

interface RiftGlassUniforms {
  [uniform: string]: THREE.IUniform;
  uColor: { value: THREE.Color };
  uTime: { value: number };
  uGlow: { value: number };
}

/**
 * Translucent rift glass (Phase 07A): crystal that lets the world show through, bright facets at
 * grazing angles (fresnel) and energy rising from the root where it grew out of the crack.
 * Premultiplied alpha, so it both veils what is behind it and glows. Instancing-aware.
 */
export function createRiftGlassMaterial(
  color: string,
  glow = 2,
): THREE.ShaderMaterial & { uniforms: RiftGlassUniforms } {
  const uniforms: RiftGlassUniforms = {
    uColor: { value: new THREE.Color(color) },
    uTime: { value: 0 },
    uGlow: { value: glow },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        vH = position.y;
        vec4 mv = modelViewMatrix * p;
        vV = -mv.xyz;
        vN = normalize(normalMatrix * n);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uGlow;
      varying vec3 vN;
      varying vec3 vV;
      varying float vH;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float fres = pow(1.0 - ndv, 3.0);
        float root = smoothstep(1.2, 0.0, vH);
        float pulse = 0.85 + 0.15 * sin(uTime * 1.7 + vH * 6.0);
        vec3 col = uColor * (0.3 + root) * uGlow * pulse + vec3(0.86, 0.8, 1.0) * fres * 0.9;
        float a = 0.26 + 0.52 * fres + 0.18 * root;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  }) as THREE.ShaderMaterial & { uniforms: RiftGlassUniforms };
}

/**
 * Storm sky dome (Phase 07B): the shared aerial-perspective gradient (atmosphere.ts → ffSky, the
 * same colours the fog fades to), an eye-wall of towering storm clouds ringing the horizon with
 * ragged tops and edges lit toward the storm break, drifting cirrus above it (high detail) and the
 * billowing cloud sea below, lit toward the break and dissolving into the horizon haze.
 * Drawn after the opaque scene at the far plane, so pixels the arena covers cost nothing.
 */
export function createSkyMaterial(detail: 'low' | 'high' = 'high'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: new THREE.Color(SKY.horizon) },
      uTime: { value: 0 },
    },
    defines: detail === 'high' ? { FF_SKY_HIGH: '' } : {},
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      ${SKY_GLSL}
      float fbmLo(vec3 p) {
        float s = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) { s += a * noise3(p); p *= 2.07; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 dir = normalize(vDir);
        float h = dir.y;
        vec3 col = ffSky(dir, uHorizon, 1.0);
        vec2 ring = normalize(dir.xz + vec2(1e-4));
        float sunAz = max(dot(ring, normalize(FF_SUN.xz)), 0.0);
        // Eye-wall: storm towers around the horizon, ragged tops, edges lit toward the break.
        float tops = 0.13 + 0.24 * fbmLo(vec3(ring * 2.2, uTime * 0.004));
        float wall = smoothstep(tops, tops - 0.08, h) * smoothstep(-0.22, -0.03, h);
        float billow = fbmLo(vec3(ring * 6.0, h * 10.0 + uTime * 0.012));
        vec3 tower = mix(FF_STORM * 0.55, uHorizon * 0.95, billow);
        float rim = smoothstep(tops - 0.06, tops, h + billow * 0.05);
        tower += FF_GLOW * (rim * 0.75 * pow(sunAz, 2.0) + pow(sunAz, 8.0) * billow * 0.3);
        col = mix(col, tower, wall * 0.85);
        #ifdef FF_SKY_HIGH
          // Drifting cirrus above the eye-wall.
          float cir = fbmLo(vec3(dir.xz / max(h, 0.08) * 0.7 + vec2(uTime * 0.006, 0.0), 3.1));
          float sun = max(dot(dir, FF_SUN), 0.0);
          col += (FF_GLOW * pow(sun, 3.0) * 0.45 + FF_STORM * 0.3)
            * smoothstep(0.55, 0.82, cir) * smoothstep(0.22, 0.55, h);
        #endif
        // The cloud sea below: billows in perspective, lit toward the break, hazing at the horizon.
        if (h < 0.0) {
          vec2 sea = dir.xz / max(-h, 0.04);
          #ifdef FF_SKY_HIGH
            float b = fbm3(vec3(sea * 0.5 + vec2(uTime * 0.01, 0.0), 1.7));
          #else
            float b = fbmLo(vec3(sea * 0.5 + vec2(uTime * 0.01, 0.0), 1.7));
          #endif
          vec3 seaCol = mix(FF_SEA_DEEP, FF_SEA * 1.2, smoothstep(0.32, 0.78, b));
          seaCol += FF_GLOW * 0.32 * pow(sunAz, 3.0) * smoothstep(0.55, 0.85, b);
          col = mix(col, seaCol, smoothstep(-0.02, -0.28, h) * 0.8);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
