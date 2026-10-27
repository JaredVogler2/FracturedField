import * as THREE from 'three';

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

/** Storm sky dome: abyss zenith, storm horizon, warm break glow toward the key light. */
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color('#050d16') },
      uHorizon: { value: new THREE.Color('#16405a') },
      uGlow: { value: new THREE.Color('#d9a066') },
      uSunDir: { value: new THREE.Vector3(-0.45, 0.35, 0.55).normalize() },
      uTime: { value: 0 },
    },
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
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        float h = vDir.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(-0.05, 0.6, h));
        col = mix(col, uHorizon * 0.35, smoothstep(0.0, -0.4, h));
        float sun = max(dot(vDir, uSunDir), 0.0);
        col += uGlow * pow(sun, 6.0) * 0.55 + uGlow * pow(sun, 40.0) * 0.6;
        float clouds = fbm3(vec3(vDir.xz / max(0.18, abs(h) + 0.25) * 2.2, uTime * 0.01));
        float band = smoothstep(0.42, 0.0, abs(h - 0.06));
        col = mix(col, col * 0.55 + uHorizon * 0.2, smoothstep(0.45, 0.75, clouds) * band);
        col += uGlow * smoothstep(0.55, 0.8, clouds) * band * pow(sun, 2.0) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
