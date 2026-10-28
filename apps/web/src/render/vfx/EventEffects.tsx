import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_ABILITIES, MERIDIAN_ARENA } from '@ff/game-data';
import type { GameEvent } from '@ff/protocol';
import { useGameClient, useRenderFrame } from '../frame-context';
import { PALETTE, TEAM_COLORS } from '../art-tokens';
import { useSettings } from '../../game/settings';
import { mulberry32 } from '../procedural';

const RING_POOL = 20;
const PARTICLES = 640;
const SHARDS = 32;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  r0: number;
  r1: number;
  active: boolean;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  r: number;
  g: number;
  b: number;
  drag: number;
  gravity: number;
}

interface Shard {
  p: THREE.Vector3;
  v: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
}

/**
 * Transient feedback effects spawned only from authoritative events (cast, impact, goal,
 * despawn, kickoff; an ice plate's break is drawn with the plate, in water-ice.tsx). Pooled meshes / particle buffers: no per-event allocation in steady state.
 */
export function EventEffects() {
  const client = useGameClient();
  const frame = useRenderFrame();
  const reducedFlashes = useSettings((s) => s.reducedFlashes);
  const group = useRef<THREE.Group>(null);
  const rand = useMemo(() => mulberry32(99), []);

  const ringGeo = useMemo(() => new THREE.RingGeometry(0.92, 1, 64, 1), []);
  const rings = useMemo<Ring[]>(
    () =>
      Array.from({ length: RING_POOL }, () => {
        const mat = new THREE.MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(ringGeo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.visible = false;
        mesh.renderOrder = 5;
        return { mesh, mat, age: 0, life: 1, r0: 0.3, r1: 3, active: false };
      }),
    [ringGeo],
  );

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: PARTICLES }, () => ({
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        age: 1,
        life: 0,
        r: 1,
        g: 1,
        b: 1,
        drag: 1,
        gravity: 0,
      })),
    [],
  );
  const pointsGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    g.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    return g;
  }, []);
  const sprite = useMemo(() => makeSoftSprite(), []);
  const pointsMat = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.32,
        map: sprite,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    [sprite],
  );
  const nextParticle = useRef(0);

  const shardGeo = useMemo(() => new THREE.TetrahedronGeometry(0.22, 0), []);
  const shardMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a4f58', roughness: 0.6, flatShading: true }),
    [],
  );
  const shardMesh = useMemo(() => {
    const m = new THREE.InstancedMesh(shardGeo, shardMat, SHARDS);
    m.count = 0;
    m.frustumCulled = false;
    return m;
  }, [shardGeo, shardMat]);
  const shards = useRef<Shard[]>([]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const r of rings) g.add(r.mesh);
    g.add(shardMesh);
    return () => {
      for (const r of rings) {
        g.remove(r.mesh);
        r.mat.dispose();
      }
      g.remove(shardMesh);
    };
  }, [rings, shardMesh]);

  useEffect(
    () => () => {
      ringGeo.dispose();
      pointsGeo.dispose();
      pointsMat.dispose();
      sprite.dispose();
      shardGeo.dispose();
      shardMat.dispose();
    },
    [ringGeo, pointsGeo, pointsMat, shardGeo, shardMat, sprite],
  );

  useEffect(() => {
    const color = new THREE.Color();
    const spawnRing = (
      x: number,
      y: number,
      z: number,
      hex: string,
      r0: number,
      r1: number,
      life: number,
      opacity = 0.9,
    ) => {
      const r = rings.find((q) => !q.active) ?? rings[0]!;
      r.active = true;
      r.age = 0;
      r.life = life;
      r.r0 = r0;
      r.r1 = r1;
      r.mat.color.set(hex);
      r.mat.userData.base = opacity;
      r.mesh.position.set(x, y, z);
      r.mesh.visible = true;
    };
    const burst = (
      x: number,
      y: number,
      z: number,
      hex: string,
      count: number,
      speed: number,
      life: number,
      gravity = 4,
      up = 0.5,
    ) => {
      color.set(hex);
      for (let i = 0; i < count; i++) {
        const p = particles[nextParticle.current]!;
        nextParticle.current = (nextParticle.current + 1) % PARTICLES;
        const a = rand() * Math.PI * 2;
        const e = (rand() - 0.2) * up;
        const s = speed * (0.35 + rand() * 0.65);
        p.x = x;
        p.y = y;
        p.z = z;
        p.vx = Math.cos(a) * s;
        p.vz = Math.sin(a) * s;
        p.vy = e * s + rand() * speed * 0.3;
        p.age = 0;
        p.life = life * (0.6 + rand() * 0.6);
        p.r = color.r;
        p.g = color.g;
        p.b = color.b;
        p.drag = 1.6;
        p.gravity = gravity;
      }
    };
    const shatter = (x: number, y: number, z: number, count: number) => {
      for (let i = 0; i < count && shards.current.length < SHARDS; i++) {
        shards.current.push({
          p: new THREE.Vector3(
            x + (rand() - 0.5) * 2.4,
            y + rand() * 1.2,
            z + (rand() - 0.5) * 0.6,
          ),
          v: new THREE.Vector3((rand() - 0.5) * 7, 2 + rand() * 5, (rand() - 0.5) * 7),
          rot: new THREE.Euler(rand() * 6, rand() * 6, rand() * 6),
          spin: new THREE.Vector3((rand() - 0.5) * 12, (rand() - 0.5) * 12, (rand() - 0.5) * 12),
          age: 0,
          life: 0.9 + rand() * 0.5,
          scale: 0.6 + rand() * 1.1,
        });
      }
    };
    const pulseRadius = DEFAULT_ABILITIES.pulse.radius;
    // Ice plates break and thaw in WaterAndIce (crystal fragments, the pool back), not as stone.
    const icePlates = new Set<number>();
    const guards = new Set<number>();
    return client.events.on((e: GameEvent) => {
      switch (e.type) {
        case 'spawn':
          if (e.kind === 'ice') icePlates.add(e.entity);
          else if (e.kind === 'guard') guards.add(e.entity);
          break;
        case 'cast': {
          const hex = TEAM_COLORS[e.slot];
          if (e.ability === 'pulse') {
            spawnRing(e.p[0], 0.06, e.p[2], hex, 0.4, pulseRadius * 0.55, 0.32, 0.95);
            spawnRing(
              e.p[0],
              0.08,
              e.p[2],
              '#ffffff',
              0.3,
              pulseRadius * 0.35,
              0.18,
              reducedFlashes ? 0.25 : 0.6,
            );
            burst(e.p[0], 1.0, e.p[2], hex, 18, 6, 0.35, 0, 0.2);
          } else if (e.ability === 'guard') {
            // The wall comes up through the floor: a ripple, stone chips shed, a few motes.
            spawnRing(e.p[0], 0.05, e.p[2], hex, 0.6, 3.2, 0.45, 0.6);
            shatter(e.p[0], 0.4, e.p[2], 8);
            burst(e.p[0], 0.3, e.p[2], hex, 10, 2.5, 0.5, 6, 1.0);
          } else if (e.ability === 'sweep') {
            spawnRing(e.p[0], 0.05, e.p[2], hex, 1, DEFAULT_ABILITIES.sweep.radius, 0.45, 0.5);
          } else if (e.ability === 'lift' && e.phase === 'start') {
            spawnRing(e.p[0], 0.05, e.p[2], hex, 0.2, 1.4, 0.4, 0.7);
          } else if (e.ability === 'infuse') {
            spawnRing(
              e.p[0],
              0.05,
              e.p[2],
              e.mag === 1 ? '#ff8a3a' : '#5fc8ff',
              0.3,
              2.4,
              0.35,
              0.7,
            );
          } else if (e.ability === 'freeze') {
            spawnRing(e.p[0], 0.06, e.p[2], '#d8f6ff', 0.3, 2.6, 0.4, 0.8);
          } else if (e.ability === 'charge') {
            spawnRing(e.p[0], 0.07, e.p[2], '#a9dcff', 0.2, 2.6, 0.22, reducedFlashes ? 0.3 : 0.9);
          } else if (e.ability === 'gravity') {
            spawnRing(e.p[0], 0.05, e.p[2], '#b48cff', 7, 0.6, 0.5, 0.8);
          }
          break;
        }
        case 'reaction': {
          const [x, y, z] = e.p;
          switch (e.kind) {
            case 'soak':
              spawnRing(x, 0.04, z, '#4fb6ff', 0.4, 2.6, 0.5, 0.6);
              burst(x, 0.2, z, '#6cc6ff', 26, 4, 0.55, 9, 1.4);
              break;
            case 'ignite':
              burst(x, 0.3, z, '#ff7a22', 34, 3.5, 0.7, -2, 1.6);
              break;
            case 'chill':
              burst(x, 0.4, z, '#e0f8ff', 30, 4, 0.6, 1, 0.8);
              break;
            case 'freeze':
              spawnRing(x, 0.05, z, '#cdf3ff', 0.5, 3.2, 0.6, 0.9);
              burst(x, y, z, '#e8fbff', 46, 5, 0.8, 6, 1.2);
              break;
            case 'melt':
              burst(x, 0.2, z, '#7fd3ff', 30, 3, 0.6, 6, 1.0);
              break;
            // boil, douse and quench throw steam: plumes.tsx draws it.
            case 'shatter':
              spawnRing(x, 0.06, z, '#dff8ff', 0.4, 3.6, 0.4, 0.9);
              burst(x, y, z, '#eafcff', 70, 8, 0.8, 10, 1.4);
              break;
            case 'fracture':
              // Chips and a few hot sparks; the dust is a plume (plumes.tsx).
              shatter(x, y, z, 12);
              burst(x, y, z, '#ffd2a0', 14, 7, 0.4, 12, 1.0);
              break;
            case 'shock':
              spawnRing(x, 0.06, z, '#8fd0ff', 0.3, 2.8, 0.25, reducedFlashes ? 0.25 : 0.8);
              break;
            case 'overload':
              burst(x, y, z, '#bfe6ff', 70, 9, 0.6, 4, 1.4);
              shatter(x, y, z, 10);
              break;
            case 'energize':
              spawnRing(x, 0.05, z, '#5aa8ff', 0.4, 2.2, 0.5, 0.9);
              break;
            case 'well':
              spawnRing(x, 0.05, z, '#9c7dff', 6, 0.4, 0.6, 0.8);
              break;
            default:
              break;
          }
          break;
        }
        case 'impact': {
          const k = Math.min(1, e.impulse / 220);
          const target = frame.current?.entities.get(e.a);
          const hex = target?.kind === 'core' ? PALETTE.arc : '#ffd9b0';
          burst(e.p[0], e.p[1], e.p[2], hex, Math.round(6 + 26 * k), 3 + 7 * k, 0.45, 9, 1);
          if (k > 0.45)
            spawnRing(
              e.p[0],
              Math.max(0.05, e.p[1] - 0.8),
              e.p[2],
              hex,
              0.2,
              1 + 2 * k,
              0.25,
              0.6 * k,
            );
          break;
        }
        case 'goal': {
          // Goal pulse in the colour of the team that conceded (the goal belongs to the defender).
          const end = e.scorer === 0 ? 1 : -1;
          const defender = TEAM_COLORS[e.scorer === 0 ? 1 : 0];
          const gx = end * MERIDIAN_ARENA.halfLength;
          spawnRing(gx, 0.07, 0, TEAM_COLORS[e.scorer], 1, 14, 1.1, 0.9);
          spawnRing(gx, 0.09, 0, '#ffffff', 0.5, 8, 0.6, reducedFlashes ? 0.2 : 0.7);
          burst(e.p[0], e.p[1], e.p[2], defender, 90, 11, 1.1, 3, 1.4);
          burst(e.p[0], e.p[1], e.p[2], TEAM_COLORS[e.scorer], 70, 8, 1.3, 2, 1.6);
          break;
        }
        case 'despawn': {
          const ice =
            icePlates.delete(e.entity) || frame.current?.entities.get(e.entity)?.kind === 'ice';
          if (ice) break;
          if (e.reason === 'broken') {
            shatter(e.p[0], e.p[1], e.p[2], 14);
            burst(e.p[0], e.p[1] + 0.4, e.p[2], '#cdd6e0', 12, 6, 0.5, 8, 1.2);
          } else if (e.reason === 'expired' && guards.delete(e.entity)) {
            // A guard that runs out crumbles back into the floor.
            shatter(e.p[0], e.p[1], e.p[2], 10);
          } else if (e.reason === 'expired') {
            burst(e.p[0], e.p[1], e.p[2], '#9aaab7', 16, 2, 0.6, -1, 0.5);
          }
          break;
        }
        case 'kickoff':
          spawnRing(0, 0.06, 0, PALETTE.riftViolet, 0.5, 6, 0.6, 0.8);
          burst(0, e.p[1], 0, PALETTE.arc, 40, 5, 0.8, 0, 1);
          break;
        default:
          break;
      }
    });
  }, [client, frame, particles, rand, rings, reducedFlashes]);

  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    for (const r of rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const ease = 1 - (1 - t) * (1 - t);
      const s = r.r0 + (r.r1 - r.r0) * ease;
      r.mesh.scale.set(s, s, s);
      r.mat.opacity = (r.mat.userData.base as number) * (1 - t) * (1 - t);
    }

    const pos = pointsGeo.attributes.position as THREE.BufferAttribute;
    const col = pointsGeo.attributes.color as THREE.BufferAttribute;
    const pa = pos.array as Float32Array;
    const ca = col.array as Float32Array;
    for (let i = 0; i < PARTICLES; i++) {
      const p = particles[i]!;
      if (p.age >= p.life) {
        pa[i * 3 + 1] = -100;
        ca[i * 3] = ca[i * 3 + 1] = ca[i * 3 + 2] = 0;
        continue;
      }
      p.age += dt;
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vz *= damp;
      p.vy = p.vy * damp - p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.03, p.y + p.vy * dt);
      p.z += p.vz * dt;
      const fade = Math.max(0, 1 - p.age / p.life);
      pa[i * 3] = p.x;
      pa[i * 3 + 1] = p.y;
      pa[i * 3 + 2] = p.z;
      ca[i * 3] = p.r * fade * 1.6;
      ca[i * 3 + 1] = p.g * fade * 1.6;
      ca[i * 3 + 2] = p.b * fade * 1.6;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    const list = shards.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!;
      s.age += dt;
      if (s.age >= s.life) {
        list.splice(i, 1);
        continue;
      }
      s.v.y -= 14 * dt;
      s.p.addScaledVector(s.v, dt);
      if (s.p.y < 0.1) {
        s.p.y = 0.1;
        s.v.y *= -0.3;
        s.v.x *= 0.6;
        s.v.z *= 0.6;
      }
      s.rot.x += s.spin.x * dt;
      s.rot.y += s.spin.y * dt;
      s.rot.z += s.spin.z * dt;
    }
    shardMesh.count = list.length;
    for (let i = 0; i < list.length; i++) {
      const s = list[i]!;
      const k = s.scale * Math.min(1, (s.life - s.age) / 0.25);
      tmpQuat.setFromEuler(s.rot);
      tmpScale.set(k, k, k);
      tmpMatrix.compose(s.p, tmpQuat, tmpScale);
      shardMesh.setMatrixAt(i, tmpMatrix);
    }
    shardMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <points geometry={pointsGeo} material={pointsMat} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

/** Soft radial sprite (generated, no asset) so particles read as glowing motes, not squares. */
function makeSoftSprite(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, 2.2);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
