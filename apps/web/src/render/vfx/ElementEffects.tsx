import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_RULES } from '@ff/game-data';
import { EFFECT_FLAG, type EffectSnapshot, type GameEvent } from '@ff/protocol';
import { useGameClient, useRenderFrame } from '../frame-context';
import { mulberry32 } from '../procedural';
import { LIGHTING } from '../art-tokens';

/*
 * Element visuals (Phase 04). Everything here is driven by authoritative snapshot state or events
 * (pools, ice plates, steam, flames, wells, magnet holds, discharges). Nothing decides an outcome;
 * quality tiers may thin particles but never hide a region that affects play.
 */

const EL = DEFAULT_RULES.elements;
const MAX_POOLS = EL.maxPools;
const MAX_STEAMS = EL.maxSteams;
const MAX_FLAMES = EL.maxFlames;
const MAX_WELLS = 4;

function effectsOf(
  latest: { effects: readonly EffectSnapshot[] } | null | undefined,
  kind: string,
) {
  const out: EffectSnapshot[] = [];
  if (!latest) return out;
  for (const e of latest.effects) if (e.kind === kind) out.push(e);
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Water pools and ice plates                                                                  */
/* ------------------------------------------------------------------------------------------ */

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Normalised 3-octave value noise in [0, 1].
float fbm(vec2 p) {
  return (noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.01) * 0.125) / 0.875;
}`;

/** Distance to the nearest Voronoi cell border (IQ's two-pass method) — ice crack lines. */
const VORONOI_EDGE_GLSL = /* glsl */ `
float voronoiEdge(vec2 p) {
  vec2 n = floor(p); vec2 f = fract(p);
  vec2 mg = vec2(0.0); vec2 mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 19.19));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 19.19));
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}`;

/** Key light direction (towards the light), matching LIGHTING.keyPosition. */
const KEY_DIR = new THREE.Vector3(...LIGHTING.keyPosition).normalize();

/**
 * Shallow water on stone: mostly a darkened, wet-looking floor with ripple normals, a fresnel
 * reflection of the storm sky at grazing angles, key-light glints and a meniscus at the shore.
 * Electrified pools carry thin, flickering, branching arcs (sparse, re-seeded ~14×/s).
 */
function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uDepth: { value: 0.6 },
      uElectric: { value: 0 },
      uFade: { value: 1 },
      uWarm: { value: 0 },
      uKey: { value: KEY_DIR },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDepth;
      uniform float uElectric;
      uniform float uFade;
      uniform float uWarm;
      uniform vec3 uKey;
      varying vec2 vUv;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      float height(vec2 p) {
        return fbm(p * 1.5 + vec2(uTime * 0.33, uTime * 0.21))
          + 0.5 * fbm(p * 3.6 - vec2(uTime * 0.47, -uTime * 0.29));
      }
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0) discard;
        vec2 p = vWorld.xz;
        // Irregular, soft shoreline.
        float shore = r + (fbm(p * 1.2) - 0.5) * 0.24;
        float edge = smoothstep(1.0, 0.8, shore);
        if (edge <= 0.001) discard;
        // Ripple normal from the height field (finite differences).
        float e = 0.07;
        float h0 = height(p);
        float hx = height(p + vec2(e, 0.0));
        float hz = height(p + vec2(0.0, e));
        vec3 N = normalize(vec3((h0 - hx) * 1.4, 1.0, (h0 - hz) * 1.4));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        float spec = pow(max(dot(reflect(-uKey, N), V), 0.0), 80.0);
        vec3 shallow = vec3(0.045, 0.13, 0.16);
        vec3 deep = vec3(0.012, 0.05, 0.075);
        vec3 col = mix(shallow, deep, uDepth);
        vec3 sky = vec3(0.20, 0.34, 0.46);
        col = mix(col, sky, clamp(fres * 0.9 + 0.08, 0.0, 1.0));
        // Faint moving caustic shimmer keeps the surface alive at a distance.
        float caustic = smoothstep(0.035, 0.0, abs(fbm(p * 2.2 + uTime * 0.25) - 0.5));
        col += vec3(0.25, 0.55, 0.6) * caustic * 0.16;
        col += vec3(1.0, 0.94, 0.82) * spec * 1.8;
        float meniscus = smoothstep(0.78, 0.9, shore) * smoothstep(1.0, 0.9, shore);
        col += vec3(0.3, 0.5, 0.58) * meniscus * 0.55;
        col = mix(col, vec3(0.32, 0.22, 0.15), uWarm * 0.3);
        float alpha = (0.58 + 0.28 * uDepth + fres * 0.2 + meniscus * 0.15) * edge * uFade;
        alpha += spec * 0.5 * edge;
        if (uElectric > 0.0) {
          float tq = floor(uTime * 14.0);
          vec2 q = p * 1.3 + vec2(hash(vec2(tq, 1.7)), hash(vec2(tq, 4.3))) * 9.0;
          vec2 warp = vec2(fbm(q * 1.2), fbm(q * 1.2 + 5.2)) - 0.5;
          float ridge = 1.0 - abs(fbm(q + warp * 2.2) * 2.0 - 1.0);
          float mask = smoothstep(0.42, 0.68, noise(q * 0.55 + tq * 0.37));
          float arc = pow(clamp(ridge, 0.0, 1.0), 34.0) * mask * uElectric;
          float halo = pow(clamp(ridge, 0.0, 1.0), 9.0) * mask * uElectric;
          // Electrified water reads violet-blue even between arcs (distinct from glints).
          col += vec3(0.05, 0.04, 0.15) * uElectric;
          col += vec3(0.55, 0.75, 1.0) * arc * 5.0 + vec3(0.42, 0.3, 1.0) * halo * 0.9;
          alpha = max(alpha, clamp(arc * 1.4 + halo * 0.3, 0.0, 1.0) * edge);
        }
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

/** Ice: lit standard material plus procedural crack lines and frost toward the base. */
function createIceMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: '#a9d8f2',
    roughness: 0.12,
    metalness: 0,
    transparent: true,
    opacity: 0.74,
    emissive: '#1b5873',
    emissiveIntensity: 0.32,
    envMapIntensity: 1.9,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIcePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIcePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vIcePos;\n${NOISE_GLSL}\n${VORONOI_EDGE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 icp = vIcePos.xz * 2.6 + vec2(vIcePos.y * 0.9, 0.0);
        float crackD = voronoiEdge(icp + (fbm(icp * 1.7) - 0.5) * 0.35);
        float cracks = 1.0 - smoothstep(0.0, 0.045, crackD);
        float fine = 1.0 - smoothstep(0.0, 0.02, voronoiEdge(icp * 2.7 + 3.1));
        float frost = smoothstep(0.1, -0.5, vIcePos.y) * (0.55 + 0.45 * fbm(vIcePos.xz * 9.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.98, 1.0),
          clamp(cracks * 0.7 + fine * 0.25 + frost * 0.45, 0.0, 1.0));
        diffuseColor.a = clamp(diffuseColor.a + cracks * 0.18 + frost * 0.12, 0.0, 1.0);`,
      );
  };
  return mat;
}

function createRimMaterial(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 3.0);
        gl_FragColor = vec4(uColor * rim * uStrength, rim * uStrength);
      }`,
  });
}

interface PoolVisual {
  water: THREE.Mesh;
  waterMat: THREE.ShaderMaterial;
  ice: THREE.Mesh;
  iceRim: THREE.Mesh;
}

/** Water pools (animated, electrified veins) and the ice-ramp plates frozen from them. */
export function WaterAndIce() {
  const frame = useRenderFrame();
  const group = useRef<THREE.Group>(null);
  const disc = useMemo(() => new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), []);
  // Same frustum as the authoritative collider (base radius 1, top radius topScale, height 1).
  const frustum = useMemo(
    () => new THREE.CylinderGeometry(EL.ice.topScale, 1, 1, 28, 1, false),
    [],
  );
  const iceMat = useMemo(() => createIceMaterial(), []);
  const rimMat = useMemo(() => createRimMaterial('#c9f4ff'), []);
  const pools = useMemo<PoolVisual[]>(
    () =>
      Array.from({ length: MAX_POOLS }, () => {
        const waterMat = createWaterMaterial();
        const water = new THREE.Mesh(disc, waterMat);
        water.renderOrder = 2;
        water.visible = false;
        const ice = new THREE.Mesh(frustum, iceMat);
        ice.castShadow = true;
        ice.receiveShadow = true;
        ice.visible = false;
        const iceRim = new THREE.Mesh(frustum, rimMat);
        iceRim.visible = false;
        iceRim.renderOrder = 3;
        return { water, waterMat, ice, iceRim };
      }),
    [disc, frustum, iceMat, rimMat],
  );
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const p of pools) g.add(p.water, p.ice, p.iceRim);
    return () => {
      for (const p of pools) {
        g.remove(p.water, p.ice, p.iceRim);
        p.waterMat.dispose();
      }
      disc.dispose();
      frustum.dispose();
      iceMat.dispose();
      rimMat.dispose();
    };
  }, [pools, disc, frustum, iceMat, rimMat]);

  useFrame(({ clock }) => {
    const list = effectsOf(frame.current?.latest, 'pool');
    const t = clock.elapsedTime;
    for (let i = 0; i < MAX_POOLS; i++) {
      const v = pools[i]!;
      const fx = list[i];
      if (!fx) {
        v.water.visible = v.ice.visible = v.iceRim.visible = false;
        continue;
      }
      const frozen = ((fx.f ?? 0) & EFFECT_FLAG.ICE) !== 0;
      const electrified = ((fx.f ?? 0) & EFFECT_FLAG.ELECTRIFIED) !== 0;
      const depth = fx.m ?? 0.6;
      const fade = fx.ttl < 0 ? 1 : Math.min(1, fx.ttl / 30);
      v.water.visible = !frozen;
      v.water.position.set(fx.p[0], 0.025, fx.p[2]);
      v.water.scale.setScalar(fx.r);
      const u = v.waterMat.uniforms;
      u.uTime!.value = t;
      u.uDepth!.value = depth;
      u.uElectric!.value = electrified ? 0.6 + 0.4 * Math.sin(t * 40) : 0;
      u.uFade!.value = fade;
      u.uWarm!.value = Math.max(0, Math.min(1, ((fx.T ?? 20) - 40) / 60));
      v.ice.visible = v.iceRim.visible = frozen;
      if (frozen) {
        v.ice.position.set(fx.p[0], EL.ice.height / 2, fx.p[2]);
        v.ice.scale.set(fx.r, EL.ice.height, fx.r);
        v.iceRim.position.copy(v.ice.position);
        v.iceRim.scale.copy(v.ice.scale).multiplyScalar(1.01);
        // Ice close to melting looks wetter and less bright.
        const warmth = Math.max(0, Math.min(1, ((fx.T ?? -40) + 30) / 33));
        (v.iceRim.material as THREE.ShaderMaterial).uniforms.uStrength!.value = 1.1 - warmth * 0.6;
      }
    }
  });
  return <group ref={group} />;
}

/* ------------------------------------------------------------------------------------------ */
/* Particle regions: steam (soft, normal blend), flames and wells (additive)                   */
/* ------------------------------------------------------------------------------------------ */

function createRegionPointsMaterial(
  additive: boolean,
  sprite: THREE.Texture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uMap: { value: sprite }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
  });
}

/**
 * Fire particles: each point is a procedural flame tongue (round, bright base tapering to a
 * flickering tip) rather than a round blob, additively blended.
 */
function createFlamePointsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 400 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vSeed;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vSeed = fract(position.x * 3.7 + position.z * 1.3);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vAlpha;
      varying vec3 vColor;
      varying float vSeed;
      void main() {
        vec2 pc = gl_PointCoord * 2.0 - 1.0;      // y: -1 top .. 1 bottom
        float v = (pc.y + 1.0) * 0.5;             // 0 = tip, 1 = base
        float wob = sin(v * 7.0 + uTime * 13.0 + vSeed * 6.28) * 0.12 * (1.0 - v);
        float w = 0.12 + 0.55 * pow(v, 0.65);     // narrow tip, round belly
        float dx = (pc.x + wob) / w;
        float body = 1.0 - smoothstep(0.55, 1.0, abs(dx));
        body *= smoothstep(0.0, 0.35, v) * (1.0 - smoothstep(0.82, 1.0, v));
        float core = (1.0 - smoothstep(0.0, 0.6, abs(dx))) * smoothstep(0.45, 0.85, v);
        float a = (body * 0.75 + core * 0.5) * vAlpha;
        if (a < 0.004) discard;
        vec3 col = vColor + vec3(0.35, 0.3, 0.2) * core;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

class RegionPoints {
  readonly geo = new THREE.BufferGeometry();
  readonly pos: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly color: Float32Array;
  readonly points: THREE.Points;
  constructor(
    readonly capacity: number,
    readonly mat: THREE.ShaderMaterial,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    const dyn = THREE.DynamicDrawUsage;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(dyn));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(dyn));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(dyn));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(dyn));
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }
  set(
    i: number,
    x: number,
    y: number,
    z: number,
    size: number,
    a: number,
    r: number,
    g: number,
    b: number,
  ) {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.alpha[i] = a;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
  }
  hide(from: number) {
    for (let i = from; i < this.capacity; i++) this.alpha[i] = 0;
  }
  commit() {
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor'])
      (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

const STEAM_PER = 44;
const FLAME_PER = 54;
const FLAME_BED = 5;
const SMOKE_PER = 14;
const WELL_PER = 60;

interface Seed {
  a: number;
  r: number;
  phase: number;
  speed: number;
  size: number;
}

function seeds(n: number, salt: number): Seed[] {
  const rnd = mulberry32(salt);
  return Array.from({ length: n }, () => ({
    a: rnd() * Math.PI * 2,
    r: Math.sqrt(rnd()),
    phase: rnd(),
    speed: 0.6 + rnd() * 0.8,
    size: 0.7 + rnd() * 0.6,
  }));
}

/** Steam clouds, flames and gravity wells as particle volumes over their authoritative regions. */
export function ElementRegions({ density = 1 }: { density?: number }) {
  const frame = useRenderFrame();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const sprite = useMemo(() => softSprite(), []);
  // Steam and flame smoke share the soft normal-blended layer.
  const steam = useMemo(
    () =>
      new RegionPoints(
        MAX_STEAMS * STEAM_PER + MAX_FLAMES * SMOKE_PER,
        createRegionPointsMaterial(false, sprite),
      ),
    [sprite],
  );
  // Additive glow: flame beds and gravity-well motes.
  const glow = useMemo(
    () =>
      new RegionPoints(
        MAX_FLAMES * FLAME_BED + MAX_WELLS * WELL_PER,
        createRegionPointsMaterial(true, sprite),
      ),
    [sprite],
  );
  const fire = useMemo(
    () => new RegionPoints(MAX_FLAMES * FLAME_PER, createFlamePointsMaterial()),
    [],
  );
  const steamSeeds = useMemo(() => seeds(STEAM_PER, 11), []);
  const flameSeeds = useMemo(() => seeds(FLAME_PER, 23), []);
  const smokeSeeds = useMemo(() => seeds(SMOKE_PER, 29), []);
  const wellSeeds = useMemo(() => seeds(WELL_PER, 37), []);
  const wellMeshes = useMemo(() => {
    const core = new THREE.SphereGeometry(0.55, 24, 16);
    const ring = new THREE.TorusGeometry(1.25, 0.035, 8, 64);
    const coreMat = new THREE.MeshBasicMaterial({ color: '#050208' });
    const rim = createRimMaterial('#b48cff');
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#c3a2ff',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const items = Array.from({ length: MAX_WELLS }, () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(core, coreMat), new THREE.Mesh(core, rim));
      const r = new THREE.Mesh(ring, ringMat);
      r.rotation.x = Math.PI / 2;
      g.add(r);
      g.visible = false;
      return g;
    });
    return {
      items,
      dispose: () => [core, ring, coreMat, rim, ringMat].forEach((d) => d.dispose()),
    };
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.add(steam.points, glow.points, fire.points, ...wellMeshes.items);
    return () => {
      g.remove(steam.points, glow.points, fire.points, ...wellMeshes.items);
      steam.dispose();
      glow.dispose();
      fire.dispose();
      wellMeshes.dispose();
      sprite.dispose();
    };
  }, [steam, glow, fire, wellMeshes, sprite]);

  useFrame(({ clock }) => {
    const latest = frame.current?.latest;
    const t = clock.elapsedTime;
    const projScale = (size.height * camera.projectionMatrix.elements[5]) / 2;
    steam.mat.uniforms.uScale!.value = projScale;
    glow.mat.uniforms.uScale!.value = projScale;
    fire.mat.uniforms.uScale!.value = projScale;
    fire.mat.uniforms.uTime!.value = t;
    const perSteam = Math.max(8, Math.round(STEAM_PER * density));
    const perFlame = Math.max(10, Math.round(FLAME_PER * density));

    let n = 0;
    for (const s of effectsOf(latest, 'steam').slice(0, MAX_STEAMS)) {
      const dens = s.m ?? 0.6;
      for (let k = 0; k < perSteam; k++) {
        const sd = steamSeeds[k]!;
        const life = (t * 0.22 * sd.speed + sd.phase) % 1;
        const rr = sd.r * s.r * (0.6 + 0.5 * life);
        const x = s.p[0] + Math.cos(sd.a + life * 0.8) * rr;
        const z = s.p[2] + Math.sin(sd.a + life * 0.8) * rr;
        const y = 0.3 + life * EL.steam.ceiling * 0.8;
        const a = dens * 0.34 * Math.sin(life * Math.PI);
        steam.set(n++, x, y, z, (1.6 + life * 2.2) * sd.size, a, 0.86, 0.9, 0.94);
      }
    }
    // Flames: tongues rising and converging, a glowing bed on the ground, smoke above.
    const flames = effectsOf(latest, 'flame').slice(0, MAX_FLAMES);
    let nf = 0;
    let ng = 0;
    for (const f of flames) {
      const strength = Math.max(0.35, Math.min(1, f.m ?? 1));
      const fadeIn = Math.min(1, (f.maxTtl - f.ttl + 1) / 6);
      const fadeOut = f.ttl < 0 ? 1 : Math.min(1, f.ttl / 12);
      const k0 = fadeIn * fadeOut * strength;
      const height = 1.0 + 1.1 * strength;
      for (let k = 0; k < perFlame; k++) {
        const sd = flameSeeds[k]!;
        const life = (t * 1.55 * sd.speed + sd.phase) % 1;
        const rr = sd.r * f.r * 0.6 * Math.pow(1 - life, 1.3);
        const sway = Math.sin(t * 6 + sd.a * 3 + life * 4) * 0.1 * life;
        const x = f.p[0] + Math.cos(sd.a) * rr + sway;
        const z = f.p[2] + Math.sin(sd.a) * rr;
        const y = 0.05 + Math.pow(life, 0.85) * height * (0.75 + 0.35 * sd.speed);
        // White-yellow at the root, orange through the body, deep red at the tips.
        const cr = 1.0;
        const cg = life < 0.25 ? 0.85 - life * 1.2 : Math.max(0.12, 0.55 - (life - 0.25) * 0.6);
        const cb = life < 0.2 ? 0.45 - life * 1.6 : 0.05;
        const a = k0 * (life < 0.12 ? life / 0.12 : 1 - (life - 0.12) / 0.88) * 0.7;
        const flick = 0.85 + 0.15 * Math.sin(t * 23 + k * 1.7);
        fire.set(nf++, x, y, z, (0.62 - life * 0.32) * sd.size * flick, a, cr, cg, cb);
      }
      for (let k = 0; k < FLAME_BED; k++) {
        const sd = flameSeeds[k]!;
        const pulse = 0.8 + 0.2 * Math.sin(t * 9 + k * 2.1);
        const x = f.p[0] + Math.cos(sd.a) * f.r * 0.35 * sd.r;
        const z = f.p[2] + Math.sin(sd.a) * f.r * 0.35 * sd.r;
        glow.set(ng++, x, 0.12, z, f.r * 0.75 * sd.size, 0.28 * k0 * pulse, 1.0, 0.36, 0.08);
      }
      for (let k = 0; k < Math.max(4, Math.round(SMOKE_PER * density)); k++) {
        const sd = smokeSeeds[k]!;
        const life = (t * 0.32 * sd.speed + sd.phase) % 1;
        const rr = sd.r * f.r * 0.45 * (0.4 + life);
        const x = f.p[0] + Math.cos(sd.a + life) * rr + life * 0.4;
        const z = f.p[2] + Math.sin(sd.a + life) * rr;
        const y = height * 0.8 + life * 3.0;
        const a = 0.2 * k0 * Math.sin(life * Math.PI);
        steam.set(n++, x, y, z, (1.0 + life * 2.2) * sd.size, a, 0.1, 0.09, 0.085);
      }
    }
    fire.hide(nf);
    fire.commit();
    steam.hide(n);
    steam.commit();
    n = ng;
    const wells = effectsOf(latest, 'well').slice(0, MAX_WELLS);
    for (let w = 0; w < MAX_WELLS; w++) {
      const g = wellMeshes.items[w]!;
      const fx = wells[w];
      if (!fx) {
        g.visible = false;
        continue;
      }
      const life = Math.min(1, fx.ttl / 8, (fx.maxTtl - fx.ttl + 1) / 6);
      g.visible = true;
      g.position.set(fx.p[0], EL.gravity.height, fx.p[2]);
      g.scale.setScalar(0.6 + 0.4 * life);
      g.children[2]!.rotation.z = t * 2.2;
      for (let k = 0; k < WELL_PER; k++) {
        const sd = wellSeeds[k]!;
        const life2 = (t * 0.9 * sd.speed + sd.phase) % 1;
        const rr = (1 - life2) * fx.r * 0.75 * sd.r + 0.3;
        const ang = sd.a + life2 * 5.5;
        const x = fx.p[0] + Math.cos(ang) * rr;
        const z = fx.p[2] + Math.sin(ang) * rr;
        const y = EL.gravity.height + (sd.phase - 0.5) * 0.8 * (1 - life2);
        glow.set(n++, x, y, z, 0.35 * sd.size, life * 0.8 * life2, 0.7, 0.5, 1.0);
      }
    }
    glow.hide(n);
    glow.commit();
  });
  return <group ref={group} />;
}

/* ------------------------------------------------------------------------------------------ */
/* Magnet field lines and discharge bolts                                                      */
/* ------------------------------------------------------------------------------------------ */

const ARC_SEG = 14;
const MAX_ARCS = 6;

/** MAGNETIZE holds draw curved field lines from the force point to each lodestone in range. */
export function MagnetFields() {
  const frame = useRenderFrame();
  const lines = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_ARCS * 3 * ARC_SEG * 6), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(MAX_ARCS * 3 * ARC_SEG * 6), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const l = new THREE.LineSegments(geo, mat);
    l.frustumCulled = false;
    return l;
  }, []);
  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
    [lines],
  );
  useFrame(({ clock }) => {
    const f = frame.current;
    const pos = lines.geometry.attributes.position!.array as Float32Array;
    const col = lines.geometry.attributes.color!.array as Float32Array;
    col.fill(0);
    let seg = 0;
    const magnets = effectsOf(f?.latest, 'magnet');
    if (f && magnets.length > 0) {
      const lodestones = [...f.entities.values()].filter((e) => e.kind === 'lodestone');
      for (const m of magnets) {
        for (const lo of lodestones) {
          const dx = lo.px - m.p[0];
          const dz = lo.pz - m.p[2];
          const d = Math.hypot(dx, dz);
          if (d > m.r || seg > MAX_ARCS * 3 * ARC_SEG - 3 * ARC_SEG) continue;
          for (let strand = 0; strand < 3; strand++) {
            const bulge = (strand - 1) * 0.9;
            const nx = -dz / (d || 1);
            const nz = dx / (d || 1);
            let px = m.p[0];
            let py = 0.9;
            let pz = m.p[2];
            for (let i = 1; i <= ARC_SEG; i++) {
              const s = i / ARC_SEG;
              const b = Math.sin(s * Math.PI) * bulge;
              const x = m.p[0] + dx * s + nx * b;
              const z = m.p[2] + dz * s + nz * b;
              const y = 0.9 + (lo.py - 0.9) * s + Math.sin(s * Math.PI) * 0.6;
              pos.set([px, py, pz, x, y, z], seg * 6);
              const flow = 0.5 + 0.5 * Math.sin(s * 12 - clock.elapsedTime * 9 + strand);
              const a = 0.25 + 0.75 * flow;
              col.set([0.45 * a, 0.75 * a, 1.2 * a, 0.45 * a, 0.75 * a, 1.2 * a], seg * 6);
              seg++;
              px = x;
              py = y;
              pz = z;
            }
          }
        }
      }
    }
    lines.geometry.setDrawRange(0, seg * 2);
    lines.geometry.attributes.position!.needsUpdate = true;
    lines.geometry.attributes.color!.needsUpdate = true;
  });
  return <primitive object={lines} />;
}

interface Bolt {
  from: THREE.Vector3;
  to: THREE.Vector3;
  q: number;
  age: number;
  seed: number;
}

const BOLT_SEG = 10;
const MAX_BOLTS = 24;

/** Discharge bolts along the authoritative conduction path of each CHARGE event. */
export function ChargeBolts() {
  const client = useGameClient();
  const bolts = useRef<Bolt[]>([]);
  const lines = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * BOLT_SEG * 6), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(MAX_BOLTS * BOLT_SEG * 6), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const l = new THREE.LineSegments(geo, mat);
    l.frustumCulled = false;
    return l;
  }, []);
  useEffect(
    () => () => {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    },
    [lines],
  );
  useEffect(
    () =>
      client.events.on((e: GameEvent) => {
        if (e.type !== 'charge') return;
        const node = (i: number) =>
          i < 0 ? new THREE.Vector3(...e.p) : new THREE.Vector3(...(e.nodes[i] ?? e.p));
        for (const [from, to] of e.links) {
          if (bolts.current.length >= MAX_BOLTS) bolts.current.shift();
          bolts.current.push({
            from: node(from),
            to: node(to),
            q: e.q[to] ?? 1,
            age: 0,
            seed: Math.random() * 1000,
          });
        }
      }),
    [client],
  );
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const pos = lines.geometry.attributes.position!.array as Float32Array;
    const col = lines.geometry.attributes.color!.array as Float32Array;
    let seg = 0;
    const list = bolts.current;
    for (let b = list.length - 1; b >= 0; b--) {
      const bolt = list[b]!;
      bolt.age += dt;
      if (bolt.age > 0.4) list.splice(b, 1);
    }
    for (const bolt of list) {
      // Re-jitter every ~50 ms: crackling, not a static line.
      const rnd = mulberry32(Math.floor(bolt.seed + bolt.age * 20));
      const fade = Math.max(0, 1 - bolt.age / 0.4) * (0.4 + 0.6 * bolt.q);
      let prev = bolt.from.clone();
      for (let i = 1; i <= BOLT_SEG; i++) {
        const s = i / BOLT_SEG;
        const p = bolt.from.clone().lerp(bolt.to, s);
        if (i < BOLT_SEG) {
          const amp = Math.sin(s * Math.PI) * 0.45;
          p.x += (rnd() - 0.5) * amp;
          p.y += (rnd() - 0.2) * amp;
          p.z += (rnd() - 0.5) * amp;
        }
        pos.set([prev.x, prev.y, prev.z, p.x, p.y, p.z], seg * 6);
        col.set(
          [0.75 * fade, 0.9 * fade, 1.6 * fade, 0.75 * fade, 0.9 * fade, 1.6 * fade],
          seg * 6,
        );
        seg++;
        prev = p;
      }
    }
    lines.geometry.setDrawRange(0, seg * 2);
    lines.geometry.attributes.position!.needsUpdate = true;
    lines.geometry.attributes.color!.needsUpdate = true;
  });
  return <primitive object={lines} />;
}

/** Soft radial sprite (generated, no asset). */
function softSprite(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(1 - r, 1.8) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
