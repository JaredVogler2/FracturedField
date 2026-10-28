/**
 * Fire (7C / D09) over the authoritative flame regions, drawn from the snapshot only: where each
 * flame is, how big and how strong, and the sweep fields the authority also uses to carry it.
 *
 * - Tongues: a few camera-facing cards per flame (one draw call for every flame), each a flame
 *   shaped by noise flowing up it: white-yellow at the root, orange through the body, deep red at
 *   the ragged tips. They lean downwind as far as the local crosswind is strong.
 * - Embers: sparks that convect up from the bed, drift downwind and cool as they rise.
 * - Bed: a glowing, flickering patch on the ground under the flame. It stands in for a light: a
 *   light that came and went would recompile every lit shader.
 * - A doused flame does not just vanish: its tongues sink, redden and go out over half a second
 *   while the steam rises (plumes.tsx).
 *
 * Heat refraction is not drawn: it needs a copy of the frame, and D09 asks for it restrained.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_RULES } from '@ff/game-data';
import type { EffectSnapshot } from '@ff/protocol';
import { useGameClient, useRenderFrame } from '../frame-context';
import { mulberry32 } from '../procedural';
import { NOISE_GLSL } from './glsl';
import { RegionPoints, createRegionPointsMaterial, softSprite } from './points';
import { windAt } from './wind';

type Tier = 'low' | 'medium' | 'high';

const EL = DEFAULT_RULES.elements;
const MAX_FLAMES = EL.maxFlames;
/** Doused flames still going out (their effect has left the snapshot). */
const MAX_DYING = 4;
const SLOTS = MAX_FLAMES + MAX_DYING;
const TONGUES: Record<Tier, number> = { low: 3, medium: 4, high: 5 };
const EMBERS: Record<Tier, number> = { low: 10, medium: 18, high: 28 };
const MAX_TONGUES = SLOTS * TONGUES.high;
const MAX_EMBERS = SLOTS * EMBERS.high;
/** How far a tongue's tip leans per unit of crosswind (m per m/s²), and the most it leans. */
const LEAN_PER_ACCEL = 0.11;
const MAX_LEAN = 1.4;
/** How far an ember drifts downwind over its life per unit of crosswind (m per m/s²). */
const EMBER_DRIFT = 0.16;
/** Seconds a doused flame takes to go out. */
const DOUSE_S = 0.45;

function tongueMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec3 iOffset;
      attribute vec2 iSize;
      // seed, heat 0..1, lean at the tip (world x, z; m)
      attribute vec4 iParams;
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vHeat;
      void main() {
        vUv = uv;
        vSeed = iParams.x;
        vHeat = iParams.y;
        // Upright, turned about the vertical to face the camera.
        vec3 toCam = cameraPosition - iOffset;
        vec3 side = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
        float y = position.y;
        float sway = (sin(uTime * 2.3 + vSeed * 17.0) * 0.6 + sin(uTime * 5.3 + vSeed * 5.0) * 0.4)
          * 0.12 * iSize.y;
        vec3 w = iOffset + side * (position.x * iSize.x + sway * y * y)
          + vec3(iParams.z, 0.0, iParams.w) * (y * y);
        w.y += y * iSize.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vHeat;
      ${NOISE_GLSL}
      void main() {
        float x = vUv.x * 2.0 - 1.0;
        float y = vUv.y;
        // Noise flows up the tongue; the outline wavers with it.
        vec2 q = vec2(x * 1.3 + vSeed * 9.0, y * 2.0 - uTime * (1.7 + 0.6 * vSeed));
        float n = fbm(q * 1.7);
        float lick = fbm(q * 3.9 + 2.7);
        // A round belly low down, narrowing to a ragged tip that breaks up into licks.
        float width = mix(0.92, 0.1, pow(y, 0.8)) * (0.72 + 0.56 * n);
        float d = abs(x + (lick - 0.5) * 0.7 * y) / max(width, 0.03);
        float body = smoothstep(1.0, 0.5, d);
        body *= smoothstep(0.0, 0.1, y) * (1.0 - smoothstep(0.5 + 0.35 * n, 1.0, y));
        body *= smoothstep(0.18, 0.5, n * 0.8 + (1.0 - y) * 0.6);
        // Hottest low in the middle; a dying flame reddens.
        float heat = body * (1.0 - 0.8 * y) * (1.25 - 0.55 * d) * (0.6 + 0.4 * vHeat);
        vec3 col = mix(vec3(0.5, 0.05, 0.01), vec3(1.0, 0.38, 0.05), smoothstep(0.12, 0.5, heat));
        col = mix(col, vec3(1.0, 0.82, 0.45), smoothstep(0.55, 0.95, heat));
        float a = body * vHeat;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * (1.0 + 0.8 * heat), a);
      }`,
  });
}

function bedMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      // x, z, radius, heat 0..1
      attribute vec4 iBed;
      varying vec2 vC;
      varying vec2 vWorld;
      varying float vHeat;
      void main() {
        vC = position.xz;
        vHeat = iBed.w;
        vec3 w = vec3(iBed.x + position.x * iBed.z, 0.035, iBed.y + position.z * iBed.z);
        vWorld = w.xz;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vC;
      varying vec2 vWorld;
      varying float vHeat;
      ${NOISE_GLSL}
      void main() {
        float r = length(vC);
        float n = fbm(vWorld * 2.4 + vec2(uTime * 0.7, -uTime * 0.5));
        float glow = smoothstep(1.0, 0.0, r + (n - 0.5) * 0.35);
        float coals = smoothstep(0.6, 0.85, fbm(vWorld * 9.0 + uTime * 0.3)) * smoothstep(0.6, 0.1, r);
        float flick = 0.85 + 0.15 * sin(uTime * 11.0 + n * 6.0);
        vec3 col = vec3(1.0, 0.36, 0.08) * glow * glow * 0.55 + vec3(1.0, 0.62, 0.22) * coals * 0.5;
        float a = vHeat * flick;
        if (a * (glow + coals) < 0.003) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

/** Instanced cards over one base shape, with dynamic per-instance attributes. */
function instanced(
  base: THREE.BufferGeometry,
  capacity: number,
  attrs: Record<string, number>,
): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  for (const [name, size] of Object.entries(attrs))
    g.setAttribute(
      name,
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
  g.instanceCount = 0;
  return g;
}

interface Burning {
  x: number;
  z: number;
  r: number;
  /** 0..1: how strongly it burns this frame. */
  heat: number;
  /** Height factor (a dying flame sinks). */
  rise: number;
  leanX: number;
  leanZ: number;
  /** Per-flame variety (stable for its id). */
  seed: number;
}

interface Dying {
  id: number;
  x: number;
  z: number;
  r: number;
  heat: number;
  age: number;
}

/** Fire over the authoritative flames: tongues, embers and the glowing bed. */
export function Fire({ tier = 'high' }: { tier?: Tier }) {
  const frame = useRenderFrame();
  const client = useGameClient();
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const parts = useMemo(() => {
    const tongueBase = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
    const tongues = instanced(tongueBase, MAX_TONGUES, { iOffset: 3, iSize: 2, iParams: 4 });
    const tongueMat = tongueMaterial();
    const tongueMesh = new THREE.Mesh(tongues, tongueMat);
    tongueMesh.frustumCulled = false;
    tongueMesh.renderOrder = 4;
    const bedBase = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const beds = instanced(bedBase, SLOTS, { iBed: 4 });
    const bedMat = bedMaterial();
    const bedMesh = new THREE.Mesh(beds, bedMat);
    bedMesh.frustumCulled = false;
    bedMesh.renderOrder = 1;
    const sprite = softSprite();
    const embers = new RegionPoints(MAX_EMBERS, createRegionPointsMaterial(true, sprite));
    embers.points.renderOrder = 5;
    return {
      tongues,
      tongueMat,
      tongueMesh,
      beds,
      bedMat,
      bedMesh,
      embers,
      dispose: () => {
        tongueBase.dispose();
        bedBase.dispose();
        tongues.dispose();
        beds.dispose();
        tongueMat.dispose();
        bedMat.dispose();
        embers.dispose();
        sprite.dispose();
      },
    };
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.add(parts.bedMesh, parts.tongueMesh, parts.embers.points);
    return () => {
      g.remove(parts.bedMesh, parts.tongueMesh, parts.embers.points);
      parts.dispose();
    };
  }, [parts]);

  const seeds = useMemo(() => {
    const rnd = mulberry32(23);
    return Array.from({ length: Math.max(TONGUES.high, EMBERS.high) }, () => ({
      a: rnd() * Math.PI * 2,
      r: Math.sqrt(rnd()),
      phase: rnd(),
      speed: 0.7 + rnd() * 0.6,
      size: 0.75 + rnd() * 0.5,
    }));
  }, []);

  // A flame that leaves the snapshot while still burning was put out (a douse names it; a reset
  // clears every flame): it goes out over DOUSE_S from its last state instead of vanishing. Online,
  // the snapshot drops the flame before the douse event is due, so leaving alone is enough.
  const state = useMemo(() => {
    const st = {
      known: new Map<number, { x: number; z: number; r: number; heat: number }>(),
      /** Flames a douse named that the snapshot still lists. */
      doused: new Set<number>(),
      dying: [] as Dying[],
      burning: [] as Burning[],
      seen: new Set<number>(),
      wind: { x: 0, z: 0 },
      embersShown: 0,
      goOut(id: number) {
        const last = st.known.get(id);
        if (!last || last.heat <= 0.15 || st.dying.some((d) => d.id === id)) return;
        if (st.dying.length >= MAX_DYING) st.dying.shift();
        st.dying.push({ id, ...last, age: 0 });
      },
    };
    return st;
  }, []);
  useEffect(
    () =>
      client.events.on((e) => {
        if (e.type !== 'reaction' || e.kind !== 'douse' || e.effect < 0) return;
        if (!state.known.has(e.effect)) return;
        state.doused.add(e.effect);
        state.goOut(e.effect);
      }),
    [client, state],
  );

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    const effects: readonly EffectSnapshot[] = frame.current?.latest?.effects ?? [];
    parts.tongueMat.uniforms.uTime!.value = t;
    parts.bedMat.uniforms.uTime!.value = t;
    parts.embers.mat.uniforms.uScale!.value =
      (size.height * camera.projectionMatrix.elements[5]) / 2;

    // What burns this frame: the live flames (minus any just doused), then the dying ones.
    const burning = state.burning;
    burning.length = 0;
    const seen = state.seen;
    seen.clear();
    for (const f of effects) {
      if (f.kind !== 'flame' || burning.length >= MAX_FLAMES) continue;
      seen.add(f.id);
      const fadeIn = Math.min(1, (f.maxTtl - f.ttl + 1) / 6);
      const fadeOut = f.ttl < 0 ? 1 : Math.min(1, f.ttl / 12);
      const heat = fadeIn * fadeOut * Math.max(0.35, Math.min(1, f.m ?? 1));
      state.known.set(f.id, { x: f.p[0], z: f.p[2], r: f.r, heat });
      if (state.doused.has(f.id)) continue;
      const w = windAt(effects, f.p[0], f.p[2], state.wind);
      const lean = Math.min(MAX_LEAN, Math.hypot(w.x, w.z) * LEAN_PER_ACCEL);
      const wl = Math.hypot(w.x, w.z) || 1;
      burning.push({
        x: f.p[0],
        z: f.p[2],
        r: f.r,
        heat,
        rise: 0.6 + 0.4 * fadeIn,
        leanX: (w.x / wl) * lean,
        leanZ: (w.z / wl) * lean,
        seed: (f.id * 0.618034) % 1,
      });
    }
    for (const id of state.known.keys()) {
      if (seen.has(id)) continue;
      state.goOut(id);
      state.known.delete(id);
    }
    for (const id of state.doused) if (!seen.has(id)) state.doused.delete(id);
    for (let i = state.dying.length - 1; i >= 0; i--) {
      const d = state.dying[i]!;
      d.age += dt;
      if (d.age >= DOUSE_S) {
        state.dying.splice(i, 1);
        continue;
      }
      const k = 1 - d.age / DOUSE_S;
      burning.push({
        x: d.x,
        z: d.z,
        r: d.r,
        heat: d.heat * k * k,
        rise: 0.3 + 0.7 * k,
        leanX: 0,
        leanZ: 0,
        seed: (d.id * 0.618034) % 1,
      });
    }

    const tongueCount = TONGUES[tier];
    const emberCount = EMBERS[tier];
    const off = parts.tongues.getAttribute('iOffset') as THREE.InstancedBufferAttribute;
    const sz = parts.tongues.getAttribute('iSize') as THREE.InstancedBufferAttribute;
    const prm = parts.tongues.getAttribute('iParams') as THREE.InstancedBufferAttribute;
    const bed = parts.beds.getAttribute('iBed') as THREE.InstancedBufferAttribute;
    let nt = 0;
    let ne = 0;
    for (let b = 0; b < burning.length; b++) {
      const f = burning[b]!;
      bed.setXYZW(b, f.x, f.z, f.r * 1.15, f.heat);
      const height = (1.3 + 1.1 * f.heat) * f.rise;
      // The tallest tongue in the middle, shorter ones round it.
      for (let k = 0; k < tongueCount; k++) {
        const sd = seeds[(k + Math.floor(f.seed * 7)) % seeds.length]!;
        const ring = k === 0 ? 0 : f.r * (0.18 + 0.22 * sd.r);
        const a = sd.a + f.seed * 6.283;
        const tall = k === 0 ? 1 : 0.55 + 0.35 * sd.size;
        off.setXYZ(nt, f.x + Math.cos(a) * ring, 0.02, f.z + Math.sin(a) * ring);
        sz.setXY(nt, f.r * (k === 0 ? 1.15 : 0.75 * sd.size), height * tall);
        prm.setXYZW(
          nt,
          (sd.phase + f.seed) % 1,
          f.heat * (k === 0 ? 1 : 0.85),
          f.leanX * tall,
          f.leanZ * tall,
        );
        nt++;
      }
      // Embers rise from the bed, drift downwind and cool (yellow, orange, then a dull red).
      for (let k = 0; k < emberCount; k++) {
        const sd = seeds[k]!;
        const life = (t * 0.55 * sd.speed + sd.phase + f.seed) % 1;
        const a = sd.a + f.seed * 6.283;
        const rr = sd.r * f.r * 0.5;
        const rise = Math.pow(life, 0.8) * (2.4 + 1.6 * f.heat) * f.rise;
        const wobble = Math.sin(t * 3.1 + sd.a * 5) * 0.25 * life;
        const drift = life * life;
        const x =
          f.x + Math.cos(a) * rr + f.leanX * drift * (EMBER_DRIFT / LEAN_PER_ACCEL) + wobble;
        const z =
          f.z + Math.sin(a) * rr + f.leanZ * drift * (EMBER_DRIFT / LEAN_PER_ACCEL) + wobble * 0.6;
        const fade = (life < 0.1 ? life / 0.1 : 1 - (life - 0.1) / 0.9) * f.heat;
        const twinkle = 0.7 + 0.3 * Math.sin(t * 19 + k * 2.3);
        const g = 0.75 - life * 0.6;
        parts.embers.set(
          ne++,
          x,
          0.25 + rise,
          z,
          (0.09 - life * 0.04) * sd.size,
          fade * twinkle,
          1.0,
          Math.max(0.12, g),
          Math.max(0.02, 0.35 - life * 0.6),
        );
      }
    }
    parts.tongues.instanceCount = nt;
    parts.beds.instanceCount = burning.length;
    if (nt > 0) {
      off.needsUpdate = true;
      sz.needsUpdate = true;
      prm.needsUpdate = true;
      bed.needsUpdate = true;
    }
    if (ne > 0 || state.embersShown > 0) {
      parts.embers.hide(ne);
      parts.embers.commit();
    }
    state.embersShown = ne;
  });
  return <group ref={group} />;
}
