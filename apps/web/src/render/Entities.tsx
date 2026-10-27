import { useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_ABILITIES, DEFAULT_RULES } from '@ff/game-data';
import type { EntityKind, PlayerSlot } from '@ff/protocol';
import { useRenderFrame } from './frame-context';
import { useDisposable, useStandardMaterial } from './hooks';
import { createCorePlasmaMaterial, createCoreShellMaterial } from './shaders';
import { LIGHTING, MATERIALS, PALETTE, TEAM_COLORS } from './art-tokens';
import { mulberry32 } from './procedural';

interface EntityKey {
  id: number;
  kind: EntityKind;
  owner: PlayerSlot | -1;
}

/** Mounts one visual per authoritative entity; transforms update per frame without re-render. */
export function Entities() {
  const frame = useRenderFrame();
  const [list, setList] = useState<EntityKey[]>([]);
  const sig = useRef('');
  useFrame(() => {
    const f = frame.current;
    if (!f) return;
    let s = '';
    for (const e of f.entities.values()) s += `${e.id},`;
    if (s !== sig.current) {
      sig.current = s;
      setList([...f.entities.values()].map((e) => ({ id: e.id, kind: e.kind, owner: e.owner })));
    }
  });
  return (
    <group>
      {list.map((e) => {
        switch (e.kind) {
          case 'core':
            return <CoreVisual key={e.id} id={e.id} />;
          case 'boulder':
            return <Boulder key={e.id} id={e.id} />;
          case 'guard':
            return <Guard key={e.id} id={e.id} owner={e.owner} />;
          case 'lodestone':
            return <Lodestone key={e.id} id={e.id} />;
          case 'shard':
            return (
              <Boulder key={e.id} id={e.id} radius={DEFAULT_RULES.elements.fracture.shardRadius} />
            );
          case 'ice':
            return null; // drawn by WaterAndIce from the pool region (same frustum as the collider)
          default:
            return <Boulder key={e.id} id={e.id} />;
        }
      })}
    </group>
  );
}

function useEntityTransform(
  id: number,
  target: React.RefObject<THREE.Object3D | null>,
  applyRotation = true,
) {
  const frame = useRenderFrame();
  useFrame(() => {
    const e = frame.current?.entities.get(id);
    const o = target.current;
    if (!e || !o) return;
    o.position.set(e.px, e.py, e.pz);
    if (applyRotation) o.quaternion.set(e.qx, e.qy, e.qz, e.qw);
  });
}

export function CoreVisual({ id }: { id: number }) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const ringA = useRef<THREE.Mesh>(null);
  const ringB = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const frame = useRenderFrame();
  const plasma = useDisposable(() => createCorePlasmaMaterial(), []);
  const shell = useDisposable(() => createCoreShellMaterial(), []);
  const brass = useStandardMaterial({
    color: PALETTE.brass,
    roughness: 0.3,
    metalness: 1,
    emissive: '#3a2410',
    emissiveIntensity: 0.4,
  });
  const r = DEFAULT_RULES.core.radius;
  useEntityTransform(id, group, false);
  useFrame((_, dt) => {
    const e = frame.current?.entities.get(id);
    plasma.uniforms.uTime.value += dt;
    shell.uniforms.uTime.value += dt;
    const speed = e ? Math.hypot(e.vx, e.vy, e.vz) : 0;
    const energy = Math.min(1, speed / 18);
    plasma.uniforms.uEnergy.value = energy;
    shell.uniforms.uIntensity.value = 0.9 + energy * 0.8;
    if (spin.current && e) spin.current.quaternion.set(e.qx, e.qy, e.qz, e.qw);
    if (ringA.current) ringA.current.rotation.z += dt * (0.6 + energy * 3);
    if (ringB.current) ringB.current.rotation.x += dt * (0.45 + energy * 2.4);
    if (light.current) {
      // Element state reads on the core itself: heat warms the glow, charge crackles blue.
      const heat = e ? Math.max(0, Math.min(1, (e.temp - 40) / 120)) : 0;
      const charged = e ? e.charge : 0;
      const flicker = charged > 0 ? 0.6 + 0.4 * Math.sin(performance.now() * 0.09) : 1;
      light.current.color
        .copy(CORE_VIOLET)
        .lerp(CORE_HEAT, heat)
        .lerp(CORE_ARC, charged * 0.8);
      light.current.intensity =
        LIGHTING.coreLightIntensity * (0.8 + energy * 0.7) * (1 + charged * 0.6) * flicker;
    }
    if (e) shell.uniforms.uIntensity.value *= 1 - e.wet * 0.25;
  });
  return (
    <group ref={group}>
      <group ref={spin}>
        <mesh material={plasma}>
          <icosahedronGeometry args={[r * 0.64, 5]} />
        </mesh>
        <mesh material={shell}>
          <icosahedronGeometry args={[r, 5]} />
        </mesh>
      </group>
      <mesh ref={ringA} rotation-x={Math.PI / 2.3} material={brass} castShadow>
        <torusGeometry args={[r * 1.32, 0.05, 8, 64]} />
      </mesh>
      <mesh ref={ringB} rotation-y={Math.PI / 2.6} material={brass} castShadow>
        <torusGeometry args={[r * 1.5, 0.035, 8, 64]} />
      </mesh>
      <pointLight
        ref={light}
        color={PALETTE.riftViolet}
        intensity={LIGHTING.coreLightIntensity}
        distance={LIGHTING.coreLightDistance}
        decay={2}
      />
    </group>
  );
}

const CORE_VIOLET = new THREE.Color(PALETTE.riftViolet);
const CORE_HEAT = new THREE.Color('#ff7a2a');
const CORE_ARC = new THREE.Color('#9fd8ff');
const STONE_DRY = new THREE.Color(MATERIALS.boulderColor);
const STONE_WET = new THREE.Color(MATERIALS.boulderColor).multiplyScalar(0.55);
const HEAT_GLOW = new THREE.Color('#ff5a1a');
const SHOCK_GLOW = new THREE.Color('#ff2e12');

function Boulder({ id, radius = 0.75 }: { id: number; radius?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const frame = useRenderFrame();
  const geometry = useDisposable(() => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const rand = mulberry32(id * 7919);
    const bumps = Array.from({ length: 7 }, () =>
      new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    );
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      let k = 1;
      for (const b of bumps) k -= Math.max(0, v.dot(b) - 0.55) * 0.55;
      v.multiplyScalar(k * (0.94 + rand() * 0.06));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, [id]);
  const material = useStandardMaterial({
    color: MATERIALS.boulderColor,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });
  useEntityTransform(id, ref);
  // Authoritative element state: wet stone darkens and gleams, hot stone glows, shocked stone
  // shows pulsing cracks (it will break at under half its strength).
  useFrame(() => {
    const e = frame.current?.entities.get(id);
    if (!e) return;
    material.color.copy(STONE_DRY).lerp(STONE_WET, e.wet);
    material.roughness = 0.88 - e.wet * 0.5;
    const heat = Math.max(0, Math.min(1, (e.temp - 60) / 200));
    if (e.shocked) {
      material.emissive.copy(SHOCK_GLOW);
      material.emissiveIntensity = 0.4 + 0.35 * Math.sin(performance.now() * 0.012);
    } else {
      material.emissive.copy(HEAT_GLOW);
      material.emissiveIntensity = heat * 1.4 + e.charge * 0.6;
    }
  });
  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      scale={radius}
      castShadow
      receiveShadow
    />
  );
}

/** Steel lodestone: brass bands light up blue while it is an electromagnet (energized). */
function Lodestone({ id }: { id: number }) {
  const ref = useRef<THREE.Group>(null);
  const frame = useRenderFrame();
  const r = 0.55;
  const steel = useStandardMaterial({ color: '#8d98a4', roughness: 0.26, metalness: 1 });
  const band = useStandardMaterial({
    color: PALETTE.brass,
    roughness: 0.32,
    metalness: 1,
    emissive: '#3d8bff',
    emissiveIntensity: 0,
  });
  useEntityTransform(id, ref);
  useFrame(() => {
    const e = frame.current?.entities.get(id);
    if (!e) return;
    const t = performance.now() * 0.02;
    band.emissiveIntensity = e.energized > 0 ? 2.4 + 0.9 * Math.sin(t) : e.charge > 0 ? 1.2 : 0;
  });
  return (
    <group ref={ref}>
      <mesh material={steel} castShadow receiveShadow>
        <sphereGeometry args={[r, 32, 20]} />
      </mesh>
      <mesh material={band} rotation-x={Math.PI / 2}>
        <torusGeometry args={[r * 1.02, 0.055, 10, 48]} />
      </mesh>
      <mesh material={band}>
        <torusGeometry args={[r * 1.02, 0.035, 10, 48]} />
      </mesh>
    </group>
  );
}

function Guard({ id, owner }: { id: number; owner: PlayerSlot | -1 }) {
  const ref = useRef<THREE.Group>(null);
  const born = useRef(0);
  const frame = useRenderFrame();
  const def = DEFAULT_ABILITIES.guard;
  const color = owner === -1 ? PALETTE.coldSilver : TEAM_COLORS[owner];
  const stone = useStandardMaterial({
    color: MATERIALS.guardColor,
    roughness: 0.55,
    metalness: 0.1,
    flatShading: true,
  });
  const edge = useStandardMaterial({
    color: '#111',
    emissive: color,
    emissiveIntensity: 2.4,
    roughness: 0.4,
  });
  useEntityTransform(id, ref);
  useFrame(() => {
    const g = ref.current;
    const e = frame.current?.entities.get(id);
    if (!g || !e) return;
    // Rise out of the floor over 180 ms (visual only; the collider exists from the accepted tick).
    const now = performance.now();
    if (born.current === 0) born.current = now;
    const rise = Math.min(1, (now - born.current) / 180);
    g.scale.set(1, 0.15 + 0.85 * rise, 1);
    g.position.y = e.py * (0.15 + 0.85 * rise);
    const fade = e.ttl > 0 ? Math.min(1, e.ttl / 20) : 1;
    // A soaked or charged guard telegraphs that a discharge could overload it.
    const crackle = e.charge > 0 ? 1.5 * Math.abs(Math.sin(now * 0.05)) : 0;
    edge.emissiveIntensity = 0.6 + 1.8 * fade + crackle;
    stone.color.copy(GUARD_DRY).lerp(GUARD_WET, e.wet);
  });
  return (
    <group ref={ref}>
      <mesh material={stone} castShadow receiveShadow>
        <boxGeometry args={[def.halfWidth * 2, def.halfHeight * 2, def.halfDepth * 2]} />
      </mesh>
      <mesh position-y={def.halfHeight - 0.04} material={edge}>
        <boxGeometry args={[def.halfWidth * 2 + 0.02, 0.06, def.halfDepth * 2 + 0.02]} />
      </mesh>
    </group>
  );
}

const GUARD_DRY = new THREE.Color(MATERIALS.guardColor);
const GUARD_WET = new THREE.Color(MATERIALS.guardColor).multiplyScalar(0.6);

/** Player manipulator markers (where each player's force originates). */
export function Manipulators() {
  const frame = useRenderFrame();
  const refs = [useRef<THREE.Group>(null), useRef<THREE.Group>(null)] as const;
  const mats = [
    useStandardMaterial({
      color: '#000',
      emissive: TEAM_COLORS[0],
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.9,
    }),
    useStandardMaterial({
      color: '#000',
      emissive: TEAM_COLORS[1],
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.9,
    }),
  ] as const;
  useFrame(({ clock }) => {
    const f = frame.current;
    if (!f) return;
    for (const slot of [0, 1] as const) {
      const g = refs[slot].current;
      if (!g) continue;
      const m = f.manipulators[slot];
      g.position.set(m.x, 0.03, m.z);
      g.rotation.y = clock.elapsedTime * (slot === 0 ? 0.8 : -0.8);
    }
  });
  return (
    <group>
      {([0, 1] as const).map((slot) => (
        <group key={slot} ref={refs[slot]}>
          <mesh rotation-x={-Math.PI / 2} material={mats[slot]}>
            <ringGeometry args={[0.55, 0.68, slot === 0 ? 6 : 4]} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} material={mats[slot]}>
            <ringGeometry args={[1.05, 1.1, 48]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
