/**
 * Practical light (Phase 07B): bronze fire braziers on the platform behind the far wall and
 * flanking the gates — warm, motivated light sources against the cool storm, the way lanterns
 * light the stone in the art direction's references.
 *
 * Each brazier is a bronze body (the arena's surface material), a bed of glowing coals, a flame
 * (a camera-facing sheet of rising noise, additive), embers that rise and fade, and a pool of
 * warm light on the stone around it. The pool is a flickering additive decal, not a dynamic
 * light: eight more point lights would cost every lit pixel on screen, a decal only the pixels
 * it covers. All braziers together are five draw calls (bodies, coals, flames, pools, embers):
 * flames face the camera and pools flicker in their vertex/fragment shaders, from per-vertex
 * seeds. Reduced motion slows the fire and steadies the flicker.
 *
 * Decor only: everything stands outside the walls, nothing touches physics.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useFrame, useThree } from '@react-three/fiber';
import { BRAZIERS } from './art-tokens';
import { brazier, BRAZIER_RIM, type Lod } from './arena/geometry';
import { surfaceMaterial } from './arena/materials';
import { NOISE_GLSL } from './shaders';
import { mulberry32 } from './procedural';
import { useSettings } from '../game/settings';

const FLAME_W = 1.1;
const FLAME_H = 1.7;

/** One quad per spot, built from per-vertex attributes (the shaders place and animate them). */
function spotQuads(spots: readonly (readonly [number, number])[], y: number): THREE.BufferGeometry {
  const n = spots.length;
  const center = new Float32Array(n * 4 * 3);
  const corner = new Float32Array(n * 4 * 2);
  const seed = new Float32Array(n * 4);
  const index: number[] = [];
  const corners = [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 1],
    [-0.5, 1],
  ] as const;
  spots.forEach(([x, z], s) => {
    for (let k = 0; k < 4; k++) {
      const v = s * 4 + k;
      center.set([x, y, z], v * 3);
      corner.set(corners[k]!, v * 2);
      seed[v] = s * 7.31;
    }
    index.push(s * 4, s * 4 + 1, s * 4 + 2, s * 4, s * 4 + 2, s * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  // `position` carries the centre too, so bounds and culling are right.
  g.setAttribute('position', new THREE.BufferAttribute(center.slice(), 3));
  g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setIndex(index);
  return g;
}

function createFlameMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uIntensity: { value: BRAZIERS.flame } },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aCorner;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        // A sheet turned to the camera about the vertical (flames stand upright).
        vec3 toCam = cameraPosition - aCenter;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
        vec3 p = aCenter + right * aCorner.x * ${FLAME_W.toFixed(2)} + vec3(0.0, aCorner.y * ${FLAME_H.toFixed(2)}, 0.0);
        vUv = vec2(aCorner.x + 0.5, aCorner.y);
        vSeed = aSeed;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      varying vec2 vUv;
      varying float vSeed;
      ${NOISE_GLSL}
      void main() {
        float x = (vUv.x - 0.5) * 2.0;
        float y = vUv.y;
        // Turbulence rising through the flame; tongues lick and break off near the top.
        float n = fbm3(vec3(x * 2.1, y * 2.6 - uTime * 2.3, uTime * 0.55 + vSeed));
        float sway = (fbm3(vec3(y * 1.4 - uTime * 0.9, vSeed, 3.0)) - 0.5) * 0.5 * y;
        float w = mix(0.82, 0.06, pow(y, 0.75)) * (0.7 + 0.6 * n);
        float body = 1.0 - smoothstep(w * 0.45, w, abs(x + sway));
        body *= smoothstep(0.0, 0.07, y) * (1.0 - smoothstep(0.45 + 0.35 * n, 1.0, y));
        float heat = body * (1.0 - 0.7 * y) * (0.75 + 0.5 * n);
        // Deep orange to gold; never white (b5: the flames read as white candle tips).
        vec3 col = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.4, 0.06), smoothstep(0.1, 0.45, heat));
        col = mix(col, vec3(1.0, 0.66, 0.28), smoothstep(0.55, 0.95, heat));
        gl_FragColor = vec4(col * body * uIntensity, body);
      }
    `,
  });
}

function createCoalsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
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
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        // A cracked dark crust over heat that breathes slowly.
        float n = noise3(vec3(vWorld.xz * 9.0, uTime * 0.4));
        float glow = smoothstep(0.45, 0.8, n) * (0.8 + 0.2 * sin(uTime * 3.0 + vWorld.x * 20.0));
        gl_FragColor = vec4(mix(vec3(0.05, 0.02, 0.01), vec3(1.6, 0.42, 0.06), glow), 1.0);
      }
    `,
  });
}

function createPoolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(BRAZIERS.lightColor) },
      uStrength: { value: BRAZIERS.pool },
      uTime: { value: 0 },
      uFlicker: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aCorner;
      attribute float aSeed;
      uniform float uTime;
      uniform float uFlicker;
      varying vec2 vUv;
      varying float vLight;
      void main() {
        // The quad lies flat on the stone around the brazier; its corner spans [-1, 1].
        vec2 c = vec2(aCorner.x * 2.0, aCorner.y * 2.0 - 1.0);
        vec3 p = vec3(aCenter.x, 0.03, aCenter.z) + vec3(c.x, 0.0, c.y) * ${BRAZIERS.poolRadius.toFixed(2)};
        vUv = c;
        // Two incommensurate wobbles per fire: a flicker that never visibly repeats.
        float f = 0.88 + 0.08 * sin(uTime * 9.1 + aSeed * 1.7) + 0.05 * sin(uTime * 23.3 + aSeed * 4.1);
        vLight = mix(1.0, f, uFlicker);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      varying float vLight;
      void main() {
        float k = pow(max(0.0, 1.0 - length(vUv)), 2.2);
        gl_FragColor = vec4(uColor * k * uStrength * vLight, 1.0);
      }
    `,
  });
}

function createEmberMaterial(pixelRatio: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: pixelRatio } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        // Each ember rises from the bowl for 2–3.5 s, drifting with the updraft, then restarts.
        float life = 2.0 + 1.5 * fract(aSeed * 7.13);
        float t = mod(uTime + aSeed * 13.0, life) / life;
        vec3 p = position;
        p.y += t * (2.2 + 1.6 * fract(aSeed * 3.7));
        p.x += sin(t * 6.0 + aSeed * 40.0) * 0.25 * t + t * 0.5;
        p.z += cos(t * 5.0 + aSeed * 23.0) * 0.25 * t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(2.5 * (30.0 / max(-mv.z, 1.0)), 3.0) * uPixelRatio;
        vAlpha = (1.0 - t) * smoothstep(0.0, 0.08, t);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * a * 1.6, a);
      }
    `,
  });
}

export function Braziers({ lod, size, embers }: { lod: Lod; size: number; embers: number }) {
  const gl = useThree((s) => s.gl);
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const spots = BRAZIERS.spots;
  const built = useMemo(() => {
    const parts = spots.map(([x, z]) => {
      const b = brazier(lod);
      b.bronze.translate(x, 0, z);
      b.coals.translate(x, 0, z);
      return b;
    });
    const out = {
      bronze: mergeGeometries(parts.map((p) => p.bronze)),
      coals: mergeGeometries(parts.map((p) => p.coals)),
      flames: spotQuads(spots, BRAZIER_RIM - 0.1),
      pools: spotQuads(spots, 0),
    };
    for (const p of parts) {
      p.bronze.dispose();
      p.coals.dispose();
    }
    return out;
  }, [lod, spots]);
  const embersGeo = useMemo(() => {
    const rand = mulberry32(131);
    const n = embers * spots.length;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[Math.floor(i / Math.max(1, embers))]!;
      pos.set([x + (rand() - 0.5) * 0.6, BRAZIER_RIM, z + (rand() - 0.5) * 0.6], i * 3);
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [embers, spots]);
  const bronze = useMemo(() => surfaceMaterial('brassAged', size, lod === 'low'), [size, lod]);
  const mats = useMemo(
    () => ({
      coals: createCoalsMaterial(),
      flames: createFlameMaterial(),
      pools: createPoolMaterial(),
      embers: createEmberMaterial(gl.getPixelRatio()),
    }),
    [gl],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(built)) g.dispose();
    },
    [built],
  );
  useEffect(() => () => embersGeo.dispose(), [embersGeo]);
  useEffect(() => () => bronze.dispose(), [bronze]);
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );
  useFrame((_, dt) => {
    // Reduced motion: the fire still burns, slowly and without flicker.
    const step = reducedMotion ? dt * 0.25 : dt;
    for (const m of [mats.coals, mats.flames, mats.pools, mats.embers])
      m.uniforms.uTime!.value += step;
    mats.pools.uniforms.uFlicker!.value = reducedMotion ? 0 : 1;
    mats.embers.uniforms.uPixelRatio!.value = gl.getPixelRatio();
  });
  return (
    <group>
      <mesh geometry={built.bronze} material={bronze} castShadow receiveShadow />
      <mesh geometry={built.coals} material={mats.coals} />
      <mesh geometry={built.pools} material={mats.pools} frustumCulled={false} renderOrder={2} />
      <mesh geometry={built.flames} material={mats.flames} frustumCulled={false} renderOrder={6} />
      {embers > 0 && (
        <points geometry={embersGeo} material={mats.embers} frustumCulled={false} renderOrder={7} />
      )}
    </group>
  );
}
