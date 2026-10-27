/**
 * The storm around the platform (Phase 07B / D08): drifting cloud sheets below it at different
 * heights and speeds (parallax depth under the suspended arena), light shafts falling from the
 * storm break onto the far side of the platform, and dust motes rising in the updraft through the
 * key light. All decor: nothing here touches the simulation, and every layer is budgeted per
 * quality tier (art-tokens QUALITY).
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { FOG, SKY } from './art-tokens';
import { SKY_GLSL, SUN_DIR } from './atmosphere';
import { mulberry32 } from './procedural';

const VALUE_NOISE_2D = /* glsl */ `
float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), u.x),
             mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vfbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(7.1, 3.7); a *= 0.5; }
  return s;
}
`;

interface CloudLayer {
  readonly y: number;
  readonly inner: number;
  readonly outer: number;
  readonly scale: number;
  readonly drift: readonly [number, number];
  readonly opacity: number;
}

/** Nearest first; a tier draws the first `count` layers. */
const CLOUD_LAYERS: readonly CloudLayer[] = [
  { y: -17, inner: 26, outer: 260, scale: 0.022, drift: [0.9, 0.35], opacity: 0.78 },
  { y: -38, inner: 0, outer: 520, scale: 0.011, drift: [-0.45, 0.6], opacity: 0.9 },
];

function createCloudMaterial(layer: CloudLayer): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uHorizon: { value: new THREE.Color(SKY.horizon) },
      uLit: { value: new THREE.Color(SKY.horizon).lerp(new THREE.Color(SKY.glow), 0.35) },
      uShade: { value: new THREE.Color(SKY.seaDeep) },
      uScale: { value: layer.scale },
      uDrift: { value: new THREE.Vector2(...layer.drift) },
      uOpacity: { value: layer.opacity },
      uInner: { value: layer.inner },
      uOuter: { value: layer.outer },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uHorizon;
      uniform vec3 uLit;
      uniform vec3 uShade;
      uniform float uScale;
      uniform vec2 uDrift;
      uniform float uOpacity;
      uniform float uInner;
      uniform float uOuter;
      varying vec3 vWorld;
      ${VALUE_NOISE_2D}
      ${SKY_GLSL}
      void main() {
        vec2 p = vWorld.xz * uScale + uDrift * uTime * uScale;
        float d = vfbm(p);
        float body = smoothstep(0.42, 0.72, d);
        float r = length(vWorld.xz);
        body *= smoothstep(uInner, uInner + 30.0, r) * (1.0 - smoothstep(uOuter * 0.55, uOuter, r));
        // Lit tops toward the storm break, darker hollows; then fade into the sky like the fog.
        vec2 toSun = normalize(FF_SUN.xz);
        float facing = 0.55 + 0.45 * dot(normalize(vWorld.xz + vec2(1e-3)), toSun);
        vec3 col = mix(uShade, uLit, smoothstep(0.5, 0.95, d) * facing);
        col += FF_GLOW * 0.12 * pow(max(facing, 0.0), 3.0) * smoothstep(0.62, 0.9, d);
        float far = max(0.0, length(vWorld) - ${FOG.start.toFixed(1)});
        float fog = 1.0 - exp(-far * far * 0.000016);
        col = mix(col, ffSky(normalize(vWorld - cameraPosition), uHorizon, 0.4), fog);
        float a = body * uOpacity;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}

/** Cloud sheets drifting below the platform (nearest first; `count` from the quality tier). */
export function CloudSheets({ count }: { count: number }) {
  const layers = useMemo(
    () =>
      CLOUD_LAYERS.slice(0, count).map((layer) => ({
        layer,
        material: createCloudMaterial(layer),
        geometry: new THREE.RingGeometry(Math.max(0.1, layer.inner), layer.outer, 96, 4),
      })),
    [count],
  );
  useEffect(
    () => () =>
      layers.forEach((l) => {
        l.material.dispose();
        l.geometry.dispose();
      }),
    [layers],
  );
  useFrame((_, dt) => {
    for (const l of layers) l.material.uniforms.uTime!.value += dt;
  });
  return (
    <group>
      {layers.map(({ layer, material, geometry }, i) => (
        <mesh
          key={i}
          geometry={geometry}
          material={material}
          position-y={layer.y}
          rotation-x={-Math.PI / 2}
          renderOrder={-2 + i}
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

/** Storm-break shafts: centre, length, width, intensity (beyond the far side of the platform). */
const SHAFTS = [
  { at: [-30, 14, -30], length: 70, width: 11, intensity: 0.16 },
  { at: [-10, 16, -38], length: 76, width: 7, intensity: 0.12 },
  { at: [-44, 12, -8], length: 64, width: 9, intensity: 0.12 },
  { at: [6, 18, -44], length: 70, width: 6, intensity: 0.09 },
  { at: [-22, 20, -48], length: 80, width: 14, intensity: 0.08 },
] as const;

function createShaftMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(SKY.glow) },
      uAxis: { value: SUN_DIR.clone().negate() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec3 aSize;
      uniform vec3 uAxis;
      varying vec2 vUv;
      varying float vSeed;
      varying float vIntensity;
      void main() {
        // Billboard around the light direction: long along the shaft, facing the camera.
        vec3 toCam = normalize(cameraPosition - aCenter);
        vec3 side = normalize(cross(uAxis, toCam));
        vec3 p = aCenter + side * position.x * aSize.y + uAxis * position.y * aSize.x;
        vUv = position.xy + 0.5;
        vSeed = aCenter.x * 0.13 + aCenter.z * 0.07;
        vIntensity = aSize.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vSeed;
      varying float vIntensity;
      void main() {
        float across = abs(vUv.x - 0.5) * 2.0;
        float beam = exp(-across * across * 3.5);
        float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
        float flicker = 0.75 + 0.25 * sin(uTime * 0.6 + vSeed + vUv.y * 6.0);
        float a = beam * along * flicker * vIntensity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}

/** Light shafts from the storm break (one draw: instanced billboards). */
export function LightShafts() {
  const material = useMemo(() => createShaftMaterial(), []);
  const geometry = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute(
      'aCenter',
      new THREE.InstancedBufferAttribute(new Float32Array(SHAFTS.flatMap((s) => [...s.at])), 3),
    );
    g.setAttribute(
      'aSize',
      new THREE.InstancedBufferAttribute(
        new Float32Array(SHAFTS.flatMap((s) => [s.length, s.width, s.intensity])),
        3,
      ),
    );
    g.instanceCount = SHAFTS.length;
    return g;
  }, []);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
  });
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

function createDustMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(SKY.glow).lerp(new THREE.Color('#ffffff'), 0.4) },
      uPixelRatio: { value: pixelRatio },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime * (0.05 + aSeed * 0.05);
        p.x += sin(t + aSeed * 6.283) * 1.8;
        p.z += cos(t * 0.8 + aSeed * 11.0) * 1.8;
        // Rising in the updraft, wrapping over a 14 m column.
        p.y = mod(p.y + uTime * (0.12 + aSeed * 0.18), 14.0) - 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Specks, never blobs: capped at a few pixels however close they drift.
        gl_PointSize = min((1.2 + aSeed * 2.2) * (40.0 / max(-mv.z, 1.0)), 3.2) * uPixelRatio;
        vAlpha = smoothstep(-1.5, 0.5, p.y) * (1.0 - smoothstep(9.0, 12.5, p.y)) * (0.3 + 0.5 * aSeed);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vAlpha * 0.55;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}

/** Dust motes drifting up through the key light over and around the platform. */
export function DustMotes({ count }: { count: number }) {
  const gl = useThree((s) => s.gl);
  const material = useMemo(() => createDustMaterial(gl.getPixelRatio()), [gl]);
  const geometry = useMemo(() => {
    const rand = mulberry32(97);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 76;
      pos[i * 3 + 1] = rand() * 14;
      pos[i * 3 + 2] = (rand() - 0.5) * 50;
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [count]);
  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );
  useFrame((_, dt) => {
    material.uniforms.uTime!.value += dt;
    material.uniforms.uPixelRatio!.value = gl.getPixelRatio();
  });
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />;
}
