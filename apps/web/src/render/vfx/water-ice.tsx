/**
 * Water pools and the ice plates frozen from them (7C / D09), drawn from authoritative state only:
 * the pool effects in the snapshot (where, how big, how deep, how warm, frozen or charged) and the
 * impacts that land on the ice. Nothing here decides an outcome; the ice drawn is the collider's
 * own frustum (its facets move its corners by a few percent at most).
 *
 * - Water: darker toward its deepest point, ripple normals, a fresnel reflection of the storm sky
 *   at grazing angles, key-light glints, a broken foam band at the shore and foam rings round the
 *   bodies standing in it; charged water carries thin branching arcs.
 * - Ice: a faceted crystal plate that freezes in from the rim when the pool turns to ice (the
 *   collider is there at once; the front only shows it forming), a spectral rim on medium and
 *   high, cracks radiating from where bodies strike it, frost toward its base, and a melt back
 *   into the pool when it thaws. A plate broken by a hard hit is gone at once: crystal fragments
 *   fly from the strike and the (shallower) pool is water again.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_RULES } from '@ff/game-data';
import { EFFECT_FLAG, type EffectSnapshot } from '@ff/protocol';
import { useGameClient, useRenderFrame } from '../frame-context';
import { LIGHTING } from '../art-tokens';
import { NOISE_GLSL, VORONOI_EDGE_GLSL } from './glsl';
import { breakIce, newIceState, stepIce, type IceState } from './ice-state';
import { createRimMaterial } from './rim-material';

const EL = DEFAULT_RULES.elements;
const MAX_POOLS = EL.maxPools;
/** Bodies a pool shows foam round (the nearest ones standing in it). */
const MAX_CONTACTS = 4;
/** Impact cracks an ice plate remembers. */
const MAX_CRACKS = 4;
/** Impulse of an impact that cracks the ice right across (the event's units). */
const FULL_IMPACT = 220;
/** Ice fragments in flight at once (all plates), and per break by tier. */
const MAX_FRAGMENTS = 48;
const FRAGMENTS_PER_BREAK = { low: 10, medium: 16, high: 22 } as const;
const FRAGMENT_GRAVITY = 14;
const KEY_DIR = new THREE.Vector3(...LIGHTING.keyPosition).normalize();

interface WaterUniforms {
  [key: string]: THREE.IUniform;
  uTime: { value: number };
  uDepth: { value: number };
  uElectric: { value: number };
  uFade: { value: number };
  uWarm: { value: number };
  uKey: { value: THREE.Vector3 };
  /** Bodies in the pool, in its local units (radius 1): x, z, body radius, speed. */
  uContacts: { value: THREE.Vector4[] };
}

function createWaterMaterial(): THREE.ShaderMaterial & { uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uDepth: { value: 0.6 },
    uElectric: { value: 0 },
    uFade: { value: 1 },
    uWarm: { value: 0 },
    uKey: { value: KEY_DIR },
    uContacts: { value: Array.from({ length: MAX_CONTACTS }, () => new THREE.Vector4()) },
  };
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms,
    defines: { MAX_CONTACTS },
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
      uniform vec4 uContacts[MAX_CONTACTS];
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
        // Ripples round the bodies standing in the water, spreading as they move.
        float ring = 0.0;
        float foam = 0.0;
        for (int i = 0; i < MAX_CONTACTS; i++) {
          vec4 k = uContacts[i];
          if (k.z <= 0.0) continue;
          float d = length(c - k.xy) - k.z;
          float wake = 0.35 + 0.65 * clamp(k.w / 6.0, 0.0, 1.0);
          ring += sin(d * 34.0 - uTime * 7.0) * exp(-max(d, 0.0) * 9.0) * wake;
          foam += smoothstep(0.09, 0.0, abs(d - 0.02)) * (0.45 + 0.55 * fbm(p * 7.0 + uTime));
        }
        // Ripple normal from the height field (finite differences), plus the contact rings.
        float e = 0.07;
        float h0 = height(p);
        float hx = height(p + vec2(e, 0.0));
        float hz = height(p + vec2(0.0, e));
        vec3 N = normalize(vec3((h0 - hx) * 1.8 + ring * 0.05, 1.0, (h0 - hz) * 1.8 + ring * 0.05));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        float spec = pow(max(dot(reflect(-uKey, N), V), 0.0), 90.0);
        // Darker toward the deepest point: the water has depth, not a flat tint.
        float deepness = uDepth * (1.0 - r * r);
        vec3 shallow = vec3(0.05, 0.14, 0.17);
        vec3 deep = vec3(0.008, 0.04, 0.065);
        vec3 col = mix(shallow, deep, clamp(deepness * 1.3, 0.0, 1.0));
        vec3 sky = vec3(0.20, 0.34, 0.46);
        col = mix(col, sky, clamp(fres * 0.75 + 0.05, 0.0, 1.0));
        // Faint moving caustic shimmer keeps the surface alive at a distance.
        float caustic = smoothstep(0.035, 0.0, abs(fbm(p * 2.2 + uTime * 0.25) - 0.5));
        col += vec3(0.25, 0.55, 0.6) * caustic * 0.14 * (1.0 - deepness);
        col += vec3(1.0, 0.94, 0.82) * spec * 1.8;
        // Foam: a broken band along the shore and round the bodies in the water.
        float shoreFoam = smoothstep(0.74, 0.88, shore) * smoothstep(1.0, 0.9, shore)
          * smoothstep(0.42, 0.7, fbm(p * 5.0 + vec2(uTime * 0.2, -uTime * 0.13)));
        foam = clamp(foam + shoreFoam, 0.0, 1.0);
        col = mix(col, vec3(0.78, 0.86, 0.88), foam * 0.75);
        float meniscus = smoothstep(0.78, 0.9, shore) * smoothstep(1.0, 0.9, shore);
        col += vec3(0.3, 0.5, 0.58) * meniscus * 0.4;
        col = mix(col, vec3(0.32, 0.22, 0.15), uWarm * 0.3);
        float alpha = (0.6 + 0.3 * deepness + fres * 0.2 + meniscus * 0.12 + foam * 0.3) * edge * uFade;
        alpha += spec * 0.5 * edge;
        if (uElectric > 0.0) {
          float tq = floor(uTime * 14.0);
          vec2 q = p * 1.3 + vec2(hash(vec2(tq, 1.7)), hash(vec2(tq, 4.3))) * 9.0;
          vec2 warp = vec2(fbm(q * 1.2), fbm(q * 1.2 + 5.2)) - 0.5;
          float ridge = 1.0 - abs(fbm(q + warp * 2.2) * 2.0 - 1.0);
          float mask = smoothstep(0.42, 0.68, noise(q * 0.55 + tq * 0.37));
          float arc = pow(clamp(ridge, 0.0, 1.0), 34.0) * mask * uElectric;
          float halo = pow(clamp(ridge, 0.0, 1.0), 9.0) * mask * uElectric;
          // Electrified water reads violet-blue even between arcs (distinct from glints). Its crackle
          // is a state, kept under the discharge arcs (an event) that leap between conductors.
          col += vec3(0.05, 0.04, 0.15) * uElectric;
          col += vec3(0.55, 0.75, 1.0) * arc * 2.4 + vec3(0.42, 0.3, 1.0) * halo * 0.6;
          alpha = max(alpha, clamp(arc * 0.9 + halo * 0.25, 0.0, 1.0) * edge);
        }
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
      }`,
  }) as THREE.ShaderMaterial & { uniforms: WaterUniforms };
}

interface IceUniforms {
  /** 0..1: how far the freeze front has crossed the plate (from the rim inward). */
  uFreeze: { value: number };
  /** 0..1: a thaw under way (the plate fades and wets back into the pool). */
  uMelt: { value: number };
  /** 0..1: warm ice looks wetter and darker before it melts. */
  uWarmth: { value: number };
  /** Impact cracks, in the plate's local units: x, z, strength 0..1, age (s). */
  uCracks: { value: THREE.Vector4[] };
}

/**
 * The ice plate: a lit crystal (a physical material with a thin-film sheen, the spectral rim, on
 * medium and high; a standard one on low) with procedural cracks and frost toward its base, the
 * freeze front, the impact cracks and the thaw.
 */
function createIceMaterial(physical: boolean): {
  material: THREE.MeshStandardMaterial;
  uniforms: IceUniforms;
} {
  const uniforms: IceUniforms = {
    uFreeze: { value: 1 },
    uMelt: { value: 0 },
    uWarmth: { value: 0 },
    uCracks: { value: Array.from({ length: MAX_CRACKS }, () => new THREE.Vector4()) },
  };
  const base: THREE.MeshStandardMaterialParameters = {
    color: '#74b9dc',
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    opacity: 0.62,
    emissive: '#0f4560',
    emissiveIntensity: 0.28,
    envMapIntensity: 1.1,
    flatShading: true,
  };
  const material = physical
    ? new THREE.MeshPhysicalMaterial({
        ...base,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        iridescence: 0.6,
        iridescenceIOR: 1.31,
        iridescenceThicknessRange: [180, 560],
      })
    : new THREE.MeshStandardMaterial(base);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIcePos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvIcePos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vIcePos;
        uniform float uFreeze;
        uniform float uMelt;
        uniform float uWarmth;
        uniform vec4 uCracks[${MAX_CRACKS}];
        ${NOISE_GLSL}
        ${VORONOI_EDGE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // The frustum: y in [-0.5, 0.5], radius 1 at the base and ${EL.ice.topScale.toFixed(3)} at the top.
        float iceRad = length(vIcePos.xz) / mix(1.0, ${EL.ice.topScale.toFixed(3)}, vIcePos.y + 0.5);
        // The freeze front crosses the plate from the rim inward.
        float front = 1.0 - uFreeze;
        float ragged = (fbm(vIcePos.xz * 5.0) - 0.5) * 0.16;
        // (Fully frozen, nothing is cut away: the ragged edge would otherwise hole the centre.)
        if (front > 0.001 && iceRad + ragged < front - 0.01) discard;
        float frontLine = smoothstep(0.1, 0.0, iceRad + ragged - front) * step(0.001, front);
        vec2 icp = vIcePos.xz * 2.6 + vec2(vIcePos.y * 0.9, 0.0);
        float crackD = voronoiEdge(icp + (fbm(icp * 1.7) - 0.5) * 0.35);
        float cracks = 1.0 - smoothstep(0.0, 0.045, crackD);
        float fine = 1.0 - smoothstep(0.0, 0.02, voronoiEdge(icp * 2.7 + 3.1));
        float frost = smoothstep(0.1, -0.5, vIcePos.y) * (0.55 + 0.45 * fbm(vIcePos.xz * 9.0));
        // Impact cracks: spokes radiating from each strike, as long as the strike was strong.
        float strike = 0.0;
        for (int i = 0; i < ${MAX_CRACKS}; i++) {
          vec4 k = uCracks[i];
          if (k.z <= 0.0) continue;
          vec2 d = vIcePos.xz - k.xy;
          float rr = length(d);
          float ang = atan(d.y, d.x);
          float spokes = pow(abs(sin(ang * 3.0 + k.x * 11.0 + fbm(d * 6.0) * 1.6)), 30.0);
          float reach = 0.2 + 0.8 * k.z;
          strike += spokes * smoothstep(reach, 0.0, rr) + smoothstep(0.06 * k.z + 0.02, 0.0, rr);
        }
        strike = clamp(strike, 0.0, 1.0);
        // Thicker toward the middle: a deeper blue there, as in a real slab.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.38, 0.56), (1.0 - min(iceRad, 1.0)) * 0.35);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.98, 1.0),
          clamp(cracks * 0.55 + fine * 0.12 + frost * 0.45 + frontLine * 0.8 + strike * 0.9, 0.0, 1.0));
        // Warm ice darkens and wets; a thaw turns it to water and away.
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.5, 0.6), uWarmth * 0.45 + uMelt * 0.5);
        diffuseColor.a = clamp(diffuseColor.a + cracks * 0.18 + frost * 0.12 + strike * 0.2 + frontLine * 0.2, 0.0, 1.0);
        diffuseColor.a *= 1.0 - uMelt;`,
      );
  };
  material.customProgramCacheKey = () => `ff-ice-${physical ? 'p' : 's'}`;
  return { material, uniforms };
}

/** Hash of a rounded corner position, the same wherever that corner appears. */
function cornerHash(x: number, y: number, z: number, k: number): number {
  let h = Math.imul(Math.round(x * 1000) + 7919 * k, 73856093);
  h ^= Math.imul(Math.round(y * 1000), 19349663);
  h ^= Math.imul(Math.round(z * 1000), 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296 - 0.5;
}

/**
 * The plate: the collider's frustum (base radius 1, top radius topScale, height 1) cut into
 * facets. Rim corners move in or out by up to 4 % and the upper ring up or down a little; shared
 * corners move together, so the faceted plate stays closed and on the collider.
 */
export function iceCrystalGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(EL.ice.topScale, 1, 1, 11, 2, false).toNonIndexed();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const radial = Math.hypot(v.x, v.z);
    if (radial < 1e-4) continue; // cap centres stay
    const k = 1 + cornerHash(v.x, v.y, v.z, 1) * 0.08;
    const y = v.y > 0.49 ? v.y : v.y + (v.y > -0.49 ? cornerHash(v.x, v.y, v.z, 2) * 0.12 : 0);
    pos.setXYZ(i, v.x * k, y, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * One ice fragment: a long, irregular octahedral crystal about 0.2 m across (flat facets). Every
 * fragment shares it; each flies with its own non-uniform scale and spin.
 */
export function iceShardGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const j = 1 + cornerHash(v.x, v.y, v.z, 3) * 0.5;
    pos.setXYZ(i, v.x * 0.12 * j, v.y * 0.26 * j, v.z * 0.09 * j);
  }
  g.computeVertexNormals();
  return g;
}

interface Fragment {
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  /** Spin axis (unit) and rate (rad/s). */
  axis: THREE.Vector3;
  rate: number;
  s: THREE.Vector3;
  age: number;
  life: number;
}

interface PoolVisual {
  /** The pool effect this visual follows (-1: free). */
  id: number;
  water: THREE.Mesh;
  waterMat: THREE.ShaderMaterial & { uniforms: WaterUniforms };
  ice: THREE.Mesh;
  ice_: { material: THREE.MeshStandardMaterial; uniforms: IceUniforms };
  iceRim: THREE.Mesh;
  state: IceState;
  /** The plate's last placement, for drawing a thaw after the pool is gone. */
  last: { x: number; z: number; r: number };
  cracks: { x: number; z: number; s: number; age: number }[];
}

/** Water pools (depth, foam, charge) and the ice plates frozen from them. */
export function WaterAndIce({ tier = 'high' }: { tier?: 'low' | 'medium' | 'high' }) {
  const frame = useRenderFrame();
  const client = useGameClient();
  const group = useRef<THREE.Group>(null);
  const disc = useMemo(() => new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), []);
  const crystal = useMemo(() => iceCrystalGeometry(), []);
  const rimMat = useMemo(() => createRimMaterial('#c9f4ff'), []);
  const physical = tier !== 'low';
  // Fragments: opaque and flat-shaded like the event shards, so they share that compiled program.
  const fragments = useMemo(() => {
    const geometry = iceShardGeometry();
    const material = new THREE.MeshStandardMaterial({
      color: '#cdeeff',
      roughness: 0.12,
      metalness: 0,
      flatShading: true,
      emissive: '#2a6f8f',
      emissiveIntensity: 0.45,
      envMapIntensity: 2.2,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_FRAGMENTS);
    mesh.count = 0;
    mesh.frustumCulled = false;
    const list: Fragment[] = Array.from({ length: MAX_FRAGMENTS }, () => ({
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      axis: new THREE.Vector3(0, 1, 0),
      rate: 0,
      s: new THREE.Vector3(1, 1, 1),
      age: 0,
      life: 0,
    }));
    return { mesh, geometry, material, list, live: 0 };
  }, []);
  const pools = useMemo<PoolVisual[]>(
    () =>
      Array.from({ length: MAX_POOLS }, () => {
        const waterMat = createWaterMaterial();
        const water = new THREE.Mesh(disc, waterMat);
        water.renderOrder = 2;
        water.visible = false;
        const ice_ = createIceMaterial(physical);
        const ice = new THREE.Mesh(crystal, ice_.material);
        ice.castShadow = true;
        ice.receiveShadow = true;
        ice.visible = false;
        const iceRim = new THREE.Mesh(crystal, rimMat);
        iceRim.visible = false;
        iceRim.renderOrder = 3;
        return {
          id: -1,
          water,
          waterMat,
          ice,
          ice_,
          iceRim,
          state: newIceState(false),
          last: { x: 0, z: 0, r: 1 },
          cracks: [],
        };
      }),
    [disc, crystal, rimMat, physical],
  );
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const p of pools) g.add(p.water, p.ice, p.iceRim);
    g.add(fragments.mesh);
    return () => {
      g.remove(fragments.mesh);
      for (const p of pools) {
        g.remove(p.water, p.ice, p.iceRim);
        p.waterMat.dispose();
        p.ice_.material.dispose();
      }
    };
  }, [pools, fragments]);
  useEffect(
    () => () => {
      disc.dispose();
      crystal.dispose();
      rimMat.dispose();
      fragments.geometry.dispose();
      fragments.material.dispose();
    },
    [disc, crystal, rimMat, fragments],
  );

  // Strikes on the ice and plates broken, folded in on the next frame.
  const strikes = useRef<{ x: number; z: number; s: number }[]>([]);
  const breaks = useRef<{ pool: number; x: number; z: number; s: number }[]>([]);
  useEffect(
    () =>
      client.events.on((e) => {
        if (e.type === 'impact' && e.impulse > 25)
          strikes.current.push({ x: e.p[0], z: e.p[2], s: Math.min(1, e.impulse / FULL_IMPACT) });
        else if (e.type === 'reaction' && e.kind === 'shatter')
          breaks.current.push({
            pool: e.effect,
            x: e.p[0],
            z: e.p[2],
            s: Math.min(1, e.mag / FULL_IMPACT),
          });
      }),
    [client],
  );
  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      s: new THREE.Vector3(),
    }),
    [],
  );

  const live = useMemo(() => new Map<number, EffectSnapshot>(), []);
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    const latest = frame.current?.latest;
    const entities = frame.current?.entities;
    live.clear();
    if (latest) for (const e of latest.effects) if (e.kind === 'pool') live.set(e.id, e);
    // Visuals follow pool ids: keep each pool on its visual (a frozen one that is gone thaws
    // away where it stood); hand new pools a free one.
    for (const fx of live.values()) {
      if (pools.some((v) => v.id === fx.id)) continue;
      const free = pools.find((v) => v.id < 0);
      if (!free) break;
      free.id = fx.id;
      free.state = newIceState(((fx.f ?? 0) & EFFECT_FLAG.ICE) !== 0);
      free.cracks.length = 0;
    }
    const hits = strikes.current.splice(0);
    // A broken plate: fragments fly from the strike (the strongest hit on it this frame, else
    // its strongest crack, else its centre) and the plate is not drawn again.
    for (const b of breaks.current.splice(0)) {
      const v = pools.find((q) => q.id === b.pool);
      const at = v ? v.last : { x: b.x, z: b.z, r: 1.5 };
      let sx = at.x;
      let sz = at.z;
      let best = -1;
      for (const h of hits) {
        const d2 = (h.x - at.x) ** 2 + (h.z - at.z) ** 2;
        if (d2 <= at.r * at.r * 1.21 && h.s > best) {
          best = h.s;
          sx = h.x;
          sz = h.z;
        }
      }
      const crack = v?.cracks[0];
      if (best < 0 && crack) {
        sx = at.x + crack.x * at.r;
        sz = at.z + crack.z * at.r;
      }
      if (v) breakIce(v.state);
      throwFragments(at, sx, sz, b.s);
    }
    for (const v of pools) {
      const fx = v.id >= 0 ? live.get(v.id) : undefined;
      const view =
        v.id >= 0 ? stepIce(v.state, !!fx, ((fx?.f ?? 0) & EFFECT_FLAG.ICE) !== 0, dt) : null;
      if (!view || view.done) {
        v.id = -1;
        v.water.visible = v.ice.visible = v.iceRim.visible = false;
        continue;
      }
      if (fx) {
        v.last.x = fx.p[0];
        v.last.z = fx.p[2];
        v.last.r = fx.r;
      }
      const { x, z, r } = v.last;

      // Water: visible while the pool is water (fading back in during a thaw).
      const depth = fx?.m ?? 0.6;
      const fade = !fx ? 0 : fx.ttl < 0 ? 1 : Math.min(1, fx.ttl / 30);
      v.water.visible = view.water;
      if (view.water && fx) {
        v.water.position.set(x, 0.025, z);
        v.water.scale.setScalar(r);
        const u = v.waterMat.uniforms;
        u.uTime.value = t;
        u.uDepth.value = depth;
        const electrified = ((fx.f ?? 0) & EFFECT_FLAG.ELECTRIFIED) !== 0;
        u.uElectric.value = electrified ? 0.6 + 0.4 * Math.sin(t * 40) : 0;
        u.uFade.value = fade * view.waterFade;
        u.uWarm.value = Math.max(0, Math.min(1, ((fx.T ?? 20) - 40) / 60));
        // Foam round the bodies standing in the water (the nearest few).
        let n = 0;
        const contacts = u.uContacts.value;
        if (entities)
          for (const e of entities.values()) {
            if (n >= MAX_CONTACTS) break;
            if (e.kind === 'ice') continue;
            const dx = (e.px - x) / r;
            const dz = (e.pz - z) / r;
            if (dx * dx + dz * dz > 1.1 || e.py > 1.6) continue;
            const radius = e.kind === 'core' ? DEFAULT_RULES.core.radius : 0.7;
            contacts[n++]!.set(dx, dz, radius / r, Math.hypot(e.vx, e.vz));
          }
        for (let i = n; i < MAX_CONTACTS; i++) contacts[i]!.set(0, 0, 0, 0);
      }

      // Ice: while frozen, and through a thaw (a broken plate is gone at once).
      v.ice.visible = v.iceRim.visible = view.ice;
      if (!view.ice) continue;
      v.ice.position.set(x, EL.ice.height / 2, z);
      v.ice.scale.set(r, EL.ice.height, r);
      v.iceRim.position.copy(v.ice.position);
      v.iceRim.scale.copy(v.ice.scale).multiplyScalar(1.01);
      const iu = v.ice_.uniforms;
      iu.uFreeze.value = view.freeze;
      iu.uMelt.value = view.melt;
      const warmth = Math.max(0, Math.min(1, ((fx?.T ?? -40) + 30) / 33));
      iu.uWarmth.value = warmth;
      (v.iceRim.material as THREE.ShaderMaterial).uniforms.uStrength!.value =
        (1.1 - warmth * 0.6) * (1 - view.melt);
      // Strikes that landed on this plate leave cracks (strongest kept); old ones fade.
      for (const h of hits) {
        const lx = (h.x - x) / r;
        const lz = (h.z - z) / r;
        if (lx * lx + lz * lz > 1.21) continue;
        v.cracks.push({ x: lx, z: lz, s: h.s, age: 0 });
        v.cracks.sort((a, b) => b.s - a.s);
        v.cracks.length = Math.min(v.cracks.length, MAX_CRACKS);
      }
      const cu = iu.uCracks.value;
      for (let i = 0; i < MAX_CRACKS; i++) {
        const c = v.cracks[i];
        if (c) {
          c.age += dt;
          cu[i]!.set(c.x, c.z, c.s, c.age);
        } else cu[i]!.set(0, 0, 0, 0);
      }
    }
    stepFragments(dt);
  });

  /** Fragments over the plate's top, flung outward from the strike, faster for a harder hit. */
  function throwFragments(
    at: { x: number; z: number; r: number },
    sx: number,
    sz: number,
    strength: number,
  ) {
    const f = fragments;
    const n = FRAGMENTS_PER_BREAK[tier];
    for (let i = 0; i < n; i++) {
      // With every fragment in flight, overwrite some (each lives under 1.5 s).
      const slot = f.live < MAX_FRAGMENTS ? f.live++ : i % MAX_FRAGMENTS;
      const g = f.list[slot]!;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * at.r * 0.9;
      g.p.set(
        at.x + Math.cos(a) * rr,
        0.1 + Math.random() * EL.ice.height,
        at.z + Math.sin(a) * rr,
      );
      const dx = g.p.x - sx;
      const dz = g.p.z - sz;
      const d = Math.hypot(dx, dz) || 1;
      const out = (2 + 5 * strength) * (0.5 + Math.random() * 0.7);
      g.v.set((dx / d) * out, 2.5 + Math.random() * (2 + 3 * strength), (dz / d) * out);
      g.q.setFromAxisAngle(g.axis.set(Math.random(), Math.random(), Math.random()).normalize(), a);
      g.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      g.rate = 6 + Math.random() * 10;
      const k = Math.min(1.6, 0.5 + at.r * 0.35) * (0.6 + Math.random() * 0.8);
      g.s.set(k * (0.7 + Math.random() * 0.6), k * (0.7 + Math.random() * 0.6), k);
      g.age = 0;
      g.life = 0.9 + Math.random() * 0.6;
    }
  }

  function stepFragments(dt: number) {
    const f = fragments;
    let i = 0;
    while (i < f.live) {
      const g = f.list[i]!;
      g.age += dt;
      if (g.age >= g.life) {
        // Swap the spent fragment with the last live one.
        f.live--;
        f.list[i] = f.list[f.live]!;
        f.list[f.live] = g;
        continue;
      }
      g.v.y -= FRAGMENT_GRAVITY * dt;
      g.p.addScaledVector(g.v, dt);
      if (g.p.y < 0.06) {
        g.p.y = 0.06;
        g.v.set(g.v.x * 0.55, -g.v.y * 0.3, g.v.z * 0.55);
        g.rate *= 0.6;
      }
      g.q.premultiply(tmp.q.setFromAxisAngle(g.axis, g.rate * dt));
      const shrink = Math.min(1, (g.life - g.age) / 0.25);
      f.mesh.setMatrixAt(i, tmp.m.compose(g.p, g.q, tmp.s.copy(g.s).multiplyScalar(shrink)));
      i++;
    }
    f.mesh.count = f.live;
    if (f.live > 0) f.mesh.instanceMatrix.needsUpdate = true;
  }

  return <group ref={group} />;
}
