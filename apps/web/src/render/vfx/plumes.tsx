/**
 * Steam and smoke (7C / D09) as soft, lit plumes, drawn from authoritative state only:
 *
 * - Steam clouds: rolling puffs rising through each steam region (as wide as it has spread, as
 *   thick as its density) toward the height where its updraft ends, drifting with the crosswind.
 * - Smoke: a few dark puffs above every flame, carried downwind.
 * - Bursts: a douse, a quench and a boil each throw a puff of steam where they happen; stone that
 *   fractures and a guard that crumbles or breaks throw dust that settles.
 *
 * Every puff is one camera-facing card in a single draw call, sorted far to near each frame (they
 * blend normally, so order matters), lit by the key light from above with a cool shadow side.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_RULES } from '@ff/game-data';
import type { EffectSnapshot } from '@ff/protocol';
import { useGameClient, useRenderFrame } from '../frame-context';
import { LIGHTING } from '../art-tokens';
import { mulberry32 } from '../procedural';
import { NOISE_GLSL } from './glsl';
import { windAt } from './wind';

type Tier = 'low' | 'medium' | 'high';

const EL = DEFAULT_RULES.elements;
const STEAM_PUFFS: Record<Tier, number> = { low: 8, medium: 12, high: 16 };
const SMOKE_PUFFS: Record<Tier, number> = { low: 3, medium: 5, high: 6 };
const MAX_BURST = 36;
const MAX_PUFFS = EL.maxSteams * STEAM_PUFFS.high + EL.maxFlames * SMOKE_PUFFS.high + MAX_BURST;
const KEY_DIR = new THREE.Vector3(...LIGHTING.keyPosition).normalize();
const STEAM = new THREE.Color(0.88, 0.91, 0.95);
const SMOKE = new THREE.Color(0.13, 0.12, 0.11);
const DUST = new THREE.Color(0.44, 0.4, 0.36);

function puffMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uKey: { value: KEY_DIR },
      // Lumpy lighting from the noise's slope (two more noise reads a pixel): medium and high.
      uDetail: { value: 1 },
    },
    vertexShader: /* glsl */ `
      // centre (world), size (m)
      attribute vec4 iA;
      // colour, opacity
      attribute vec4 iB;
      // seed, spin (rad)
      attribute vec2 iC;
      varying vec2 vUv;
      varying vec4 vColor;
      varying float vSeed;
      varying vec3 vRight;
      varying vec3 vUp;
      varying vec3 vToCam;
      void main() {
        vUv = uv;
        vColor = iB;
        vSeed = iC.x;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vRight = right;
        vUp = up;
        vToCam = normalize(cameraPosition - iA.xyz);
        float c = cos(iC.y);
        float s = sin(iC.y);
        vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
        vec3 w = iA.xyz + (right * q.x + up * q.y) * iA.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uKey;
      uniform float uDetail;
      varying vec2 vUv;
      varying vec4 vColor;
      varying float vSeed;
      varying vec3 vRight;
      varying vec3 vUp;
      varying vec3 vToCam;
      ${NOISE_GLSL}
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0) discard;
        vec2 q = c * 2.1 + vSeed * 13.0 + vec2(0.0, -uTime * 0.1);
        float n = fbm(q);
        // A billow: a dense body with lobed edges cut by the noise, not a soft disc; a slow warp
        // bends the card's circle into an irregular blob.
        vec2 warp = vec2(noise(q * 0.5 + 3.1), noise(q * 0.5 + 7.7)) - 0.5;
        float rb = length(c + warp * 0.55);
        float dens = smoothstep(0.02, 0.3, 0.8 - rb + (n - 0.5) * 1.15);
        vec3 N = normalize(c.x * vRight + c.y * vUp + sqrt(max(0.0, 1.0 - r * r)) * vToCam);
        if (uDetail > 0.5) {
          float nx = fbm(q + vec2(0.07, 0.0));
          float ny = fbm(q + vec2(0.0, 0.07));
          N = normalize(N + ((nx - n) * vRight + (ny - n) * vUp) * 5.0);
        }
        float lit = max(dot(N, uKey), 0.0);
        // Lit from the key, its underside in its own shadow, a bright lining where the light
        // grazes its edge.
        float under = smoothstep(0.6, -0.8, c.y);
        float rim = pow(1.0 - max(dot(N, vToCam), 0.0), 3.0) * lit;
        vec3 col = vColor.rgb * mix(vec3(0.42, 0.48, 0.6), vec3(1.08, 1.02, 0.92), lit);
        col *= 1.0 - 0.35 * under;
        col += vColor.rgb * rim * 0.5;
        float a = dens * vColor.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

interface Burst {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  seed: number;
  /** Dust settles (sinks, stays low) where steam rises. */
  dust: boolean;
}

/** Steam clouds, flame smoke and steam bursts. */
export function Plumes({ tier = 'high' }: { tier?: Tier }) {
  const frame = useRenderFrame();
  const client = useGameClient();
  const camera = useThree((s) => s.camera);
  const parts = useMemo(() => {
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const dyn = THREE.DynamicDrawUsage;
    const iA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(dyn);
    const iB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 4), 4).setUsage(dyn);
    const iC = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PUFFS * 2), 2).setUsage(dyn);
    g.setAttribute('iA', iA);
    g.setAttribute('iB', iB);
    g.setAttribute('iC', iC);
    g.instanceCount = 0;
    const mat = puffMaterial();
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    // Unsorted staging, sorted into the attributes far to near.
    const stage = Array.from({ length: MAX_PUFFS }, () => ({
      x: 0,
      y: 0,
      z: 0,
      size: 0,
      r: 0,
      g: 0,
      b: 0,
      a: 0,
      seed: 0,
      spin: 0,
      depth: 0,
    }));
    return { base, g, iA, iB, iC, mat, mesh, stage, order: [] as number[] };
  }, []);
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const grp = group.current;
    if (!grp) return;
    grp.add(parts.mesh);
    return () => {
      grp.remove(parts.mesh);
      parts.base.dispose();
      parts.g.dispose();
      parts.mat.dispose();
    };
  }, [parts]);

  const seeds = useMemo(() => {
    const rnd = mulberry32(11);
    return Array.from({ length: STEAM_PUFFS.high }, () => ({
      a: rnd() * Math.PI * 2,
      r: Math.sqrt(rnd()),
      phase: rnd(),
      speed: 0.7 + rnd() * 0.6,
      size: 0.75 + rnd() * 0.5,
      spin: (rnd() - 0.5) * 0.6,
    }));
  }, []);

  const bursts = useRef<Burst[]>([]);
  useEffect(() => {
    const rnd = mulberry32(41);
    const puff = (x: number, y: number, z: number, n: number, big: number, dust = false) => {
      for (let i = 0; i < n; i++) {
        if (bursts.current.length >= MAX_BURST) bursts.current.shift();
        const a = rnd() * Math.PI * 2;
        const out = (0.8 + rnd() * 1.4) * big * (dust ? 1.6 : 1);
        const up = dust ? 0.4 + rnd() * 1.2 : (1.6 + rnd() * 1.8) * big;
        bursts.current.push({
          p: new THREE.Vector3(x + Math.cos(a) * 0.3, Math.max(0.3, y), z + Math.sin(a) * 0.3),
          v: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out),
          age: 0,
          life: (dust ? 1.6 : 1.2) + rnd() * 0.8,
          size: (0.7 + rnd() * 0.5) * big,
          seed: rnd(),
          dust,
        });
      }
    };
    const guards = new Set<number>();
    return client.events.on((e) => {
      if (e.type === 'spawn' && e.kind === 'guard') guards.add(e.entity);
      else if (e.type === 'despawn' && guards.delete(e.entity) && e.reason !== 'reset')
        puff(e.p[0], 0.4, e.p[2], 6, 1.1, true);
      else if (e.type !== 'reaction') return;
      else if (e.kind === 'douse' || e.kind === 'quench') puff(e.p[0], e.p[1], e.p[2], 7, 1);
      else if (e.kind === 'boil') puff(e.p[0], e.p[1], e.p[2], 12, 1.3);
      else if (e.kind === 'fracture') puff(e.p[0], e.p[1], e.p[2], 7, 0.9, true);
    });
  }, [client]);

  const wind = useMemo(() => ({ x: 0, z: 0 }), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const t = clock.elapsedTime;
    parts.mat.uniforms.uTime!.value = t;
    parts.mat.uniforms.uDetail!.value = tier === 'low' ? 0 : 1;
    const effects: readonly EffectSnapshot[] = frame.current?.latest?.effects ?? [];
    const stage = parts.stage;
    let n = 0;
    const put = (
      x: number,
      y: number,
      z: number,
      size: number,
      c: THREE.Color,
      a: number,
      seed: number,
      spin: number,
    ) => {
      if (n >= MAX_PUFFS || a < 0.004) return;
      const s = stage[n++]!;
      s.x = x;
      s.y = y;
      s.z = z;
      s.size = size;
      s.r = c.r;
      s.g = c.g;
      s.b = c.b;
      s.a = a;
      s.seed = seed;
      s.spin = spin;
    };

    const perSteam = STEAM_PUFFS[tier];
    const perSmoke = SMOKE_PUFFS[tier];
    for (const fx of effects) {
      if (fx.kind === 'steam') {
        const dens = fx.m ?? 0.6;
        const fade = fx.ttl < 0 ? 1 : Math.min(1, fx.ttl / 20);
        const w = windAt(effects, fx.p[0], fx.p[2], wind);
        const scale = Math.max(0.7, Math.min(1.4, fx.r / 3));
        for (let k = 0; k < perSteam; k++) {
          const sd = seeds[k]!;
          const life = (t * 0.16 * sd.speed + sd.phase) % 1;
          const rr = sd.r * fx.r * (0.45 + 0.55 * life);
          const x = fx.p[0] + Math.cos(sd.a + life * 0.7) * rr + w.x * 0.05 * life;
          const z = fx.p[2] + Math.sin(sd.a + life * 0.7) * rr + w.z * 0.05 * life;
          const y = 0.35 + life * EL.steam.ceiling * 0.75;
          const a = dens * 0.48 * Math.pow(Math.sin(life * Math.PI), 0.9) * fade;
          put(x, y, z, (1.0 + 2.4 * life) * sd.size * scale, STEAM, a, sd.phase, sd.spin * t);
        }
      } else if (fx.kind === 'flame') {
        const heat =
          Math.min(1, (fx.maxTtl - fx.ttl + 1) / 6) * (fx.ttl < 0 ? 1 : Math.min(1, fx.ttl / 12));
        const w = windAt(effects, fx.p[0], fx.p[2], wind);
        for (let k = 0; k < perSmoke; k++) {
          const sd = seeds[k]!;
          const life = (t * 0.3 * sd.speed + sd.phase) % 1;
          const rr = sd.r * fx.r * 0.35 * (0.4 + life);
          const x = fx.p[0] + Math.cos(sd.a + life) * rr + (w.x * 0.12 + 0.3) * life;
          const z = fx.p[2] + Math.sin(sd.a + life) * rr + w.z * 0.12 * life;
          const y = 1.9 + life * 3.2;
          const a = 0.2 * heat * Math.sin(life * Math.PI);
          put(x, y, z, (0.8 + 1.8 * life) * sd.size, SMOKE, a, sd.phase, sd.spin * t);
        }
      }
    }
    const list = bursts.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i]!;
      b.age += dt;
      if (b.age >= b.life) {
        list.splice(i, 1);
        continue;
      }
      const damp = Math.exp(-2.2 * dt);
      b.v.x *= damp;
      b.v.z *= damp;
      // Steam keeps rising, slowing; dust is pulled back down and settles on the floor.
      b.v.y = b.dust ? b.v.y * damp - 1.5 * dt : b.v.y * Math.exp(-1.2 * dt);
      b.p.addScaledVector(b.v, dt);
      if (b.p.y < 0.35) b.p.y = 0.35;
      const k = b.age / b.life;
      const a = (b.dust ? 0.42 : 0.5) * (1 - k) * (1 - k);
      put(b.p.x, b.p.y, b.p.z, b.size * (0.8 + 2.2 * k), b.dust ? DUST : STEAM, a, b.seed, k);
    }

    // Far to near, so the normal blend layers the way the eye expects.
    camera.getWorldDirection(fwd);
    const cp = camera.position;
    const order = parts.order;
    order.length = n;
    for (let i = 0; i < n; i++) {
      const s = stage[i]!;
      s.depth = (s.x - cp.x) * fwd.x + (s.y - cp.y) * fwd.y + (s.z - cp.z) * fwd.z;
      order[i] = i;
    }
    order.sort((a, b) => stage[b]!.depth - stage[a]!.depth);
    for (let i = 0; i < n; i++) {
      const s = stage[order[i]!]!;
      parts.iA.setXYZW(i, s.x, s.y, s.z, s.size);
      parts.iB.setXYZW(i, s.r, s.g, s.b, s.a);
      parts.iC.setXY(i, s.seed, s.spin);
    }
    if (n > 0 || parts.g.instanceCount > 0) {
      parts.iA.needsUpdate = true;
      parts.iB.needsUpdate = true;
      parts.iC.needsUpdate = true;
    }
    parts.g.instanceCount = n;
  });
  return <group ref={group} />;
}
