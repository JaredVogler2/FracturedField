import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MERIDIAN_ARENA, type ArenaLayout } from '@ff/game-data';
import { arenaStaticShapes, type StaticShape } from '@ff/sim/arena';
import { generateFloorTextures } from './floor-texture';
import { LIGHTING, MATERIALS, PALETTE, TEAM_COLORS } from './art-tokens';
import { createMembraneMaterial } from './shaders';
import { mulberry32 } from './procedural';
import { useGameClient } from './frame-context';

const WALL_VISUAL_HEIGHT = 1.25;

/** Memoised standard material keyed by its (plain-data) parameters; disposed on unmount. */
function useStandard(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const key = JSON.stringify(params);
  const m = useMemo(
    () => new THREE.MeshStandardMaterial(JSON.parse(key) as THREE.MeshStandardMaterialParameters),
    [key],
  );
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

const BASALT_WALL: THREE.MeshStandardMaterialParameters = {
  color: MATERIALS.wallColor,
  roughness: MATERIALS.wallRoughness,
  metalness: 0.05,
};
const BRASS: THREE.MeshStandardMaterialParameters = {
  color: PALETTE.brass,
  roughness: MATERIALS.brassRoughness,
  metalness: MATERIALS.brassMetalness,
};
const STEEL: THREE.MeshStandardMaterialParameters = {
  color: MATERIALS.steelColor,
  roughness: MATERIALS.steelRoughness,
  metalness: MATERIALS.steelMetalness,
};
const UNDERSIDE: THREE.MeshStandardMaterialParameters = {
  color: '#151a20',
  roughness: 0.92,
  metalness: 0.05,
};

export function Arena({
  textureSize,
  arena = MERIDIAN_ARENA,
}: {
  textureSize: number;
  arena?: ArenaLayout;
}) {
  const shapes = useMemo(() => arenaStaticShapes(arena), [arena]);
  return (
    <group>
      <Floor arena={arena} textureSize={textureSize} />
      <Walls shapes={shapes} />
      <Pillars shapes={shapes} />
      <Gate end={-1} arena={arena} />
      <Gate end={1} arena={arena} />
      <Plinths arena={arena} />
      <Underside arena={arena} />
      <DistantSpires />
    </group>
  );
}

function Floor({ arena, textureSize }: { arena: ArenaLayout; textureSize: number }) {
  const tex = useMemo(() => generateFloorTextures(arena, textureSize), [arena, textureSize]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        normalScale: new THREE.Vector2(1.2, 1.2),
        roughnessMap: tex.ormMap,
        metalnessMap: tex.ormMap,
        aoMap: tex.ormMap,
        aoMapIntensity: 0.9,
        roughness: 1,
        metalness: 1,
      }),
    [tex],
  );
  useEffect(
    () => () => {
      material.dispose();
      tex.map.dispose();
      tex.normalMap.dispose();
      tex.ormMap.dispose();
    },
    [material, tex],
  );
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow material={material}>
      <planeGeometry args={[tex.halfX * 2, tex.halfZ * 2]} />
    </mesh>
  );
}

function Walls({ shapes }: { shapes: readonly StaticShape[] }) {
  const stone = useStandard(BASALT_WALL);
  const brass = useStandard(BRASS);
  const walls = shapes.filter(
    (s): s is Extract<StaticShape, { kind: 'cuboid' }> => s.kind === 'cuboid' && s.role === 'wall',
  );
  return (
    <group>
      {walls.map((s) => (
        <group key={s.id} position={[s.pos[0], 0, s.pos[2]]} rotation-y={s.yaw}>
          <mesh position-y={WALL_VISUAL_HEIGHT / 2} castShadow receiveShadow material={stone}>
            <boxGeometry args={[s.half[0] * 2, WALL_VISUAL_HEIGHT, s.half[2] * 2 + 0.2]} />
          </mesh>
          <mesh position-y={WALL_VISUAL_HEIGHT + 0.07} castShadow material={brass}>
            <boxGeometry args={[s.half[0] * 2 + 0.04, 0.14, s.half[2] * 2 + 0.34]} />
          </mesh>
          <mesh position-y={0.18} material={brass}>
            <boxGeometry args={[s.half[0] * 2 + 0.02, 0.06, s.half[2] * 2 + 0.26]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Pillars({ shapes }: { shapes: readonly StaticShape[] }) {
  const stone = useStandard({ color: '#2c333b', roughness: 0.68, metalness: 0.06 });
  const brass = useStandard(BRASS);
  const rune = useStandard({
    color: '#1b1630',
    emissive: PALETTE.riftViolet,
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const fluted = useMemo(() => {
    // Fluted column: radial displacement on a high-segment cylinder.
    const g = new THREE.CylinderGeometry(1, 1.06, 1, 48, 1, false);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      if (r < 0.5) continue;
      const k = 1 - 0.045 * Math.max(0, Math.cos(a * 16)) ** 3;
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => fluted.dispose(), [fluted]);
  const pillars = shapes.filter(
    (s): s is Extract<StaticShape, { kind: 'cylinder' }> =>
      s.kind === 'cylinder' && s.role === 'pillar',
  );
  return (
    <group>
      {pillars.map((s) => {
        const h = s.halfHeight * 2;
        return (
          <group key={s.id} position={[s.pos[0], 0, s.pos[2]]}>
            <mesh
              geometry={fluted}
              scale={[s.radius, h, s.radius]}
              position-y={h / 2}
              castShadow
              receiveShadow
              material={stone}
            />
            <mesh position-y={0.2} castShadow material={brass}>
              <cylinderGeometry args={[s.radius * 1.18, s.radius * 1.24, 0.4, 32]} />
            </mesh>
            <mesh position-y={h + 0.12} castShadow material={brass}>
              <cylinderGeometry args={[s.radius * 1.22, s.radius * 1.1, 0.24, 32]} />
            </mesh>
            <mesh position-y={h * 0.68} material={rune}>
              <torusGeometry args={[s.radius * 1.03, 0.035, 8, 48]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Gate({ end, arena }: { end: 1 | -1; arena: ArenaLayout }) {
  const client = useGameClient();
  const g = arena.goal;
  const L = arena.halfLength;
  const stone = useStandard({ color: '#262c33', roughness: 0.75, metalness: 0.05 });
  const brass = useStandard(BRASS);
  const steel = useStandard(STEEL);
  const cavity = useStandard({ color: '#0c1015', roughness: 0.6, metalness: 0.6 });
  // Goal at -X is defended by slot 0 (amber); +X by slot 1 (cyan).
  const team = end < 0 ? TEAM_COLORS[0] : TEAM_COLORS[1];
  const membrane = useMemo(() => createMembraneMaterial(team), [team]);
  const glyph = useStandard({
    color: '#111',
    emissive: team,
    emissiveIntensity: 2.2,
    roughness: 0.5,
  });
  useEffect(() => () => membrane.dispose(), [membrane]);
  const pulse = useRef(0);

  useEffect(
    () =>
      client.events.on((e) => {
        // The scorer attacks the opposite goal: slot 0 scores into +X.
        if (e.type === 'goal' && (e.scorer === 0 ? 1 : -1) === end) pulse.current = 1;
      }),
    [client, end],
  );
  useFrame((_, dt) => {
    membrane.uniforms.uTime.value += dt;
    pulse.current = Math.max(0, pulse.current - dt * 0.8);
    membrane.uniforms.uPulse.value = pulse.current;
  });

  const pylonZ = g.mouthHalfWidth + 1.05;
  const pylonH = 5.4;
  const archR = pylonZ;
  const tall = useRef<THREE.Group>(null);
  useFrame(({ camera }) => {
    // When the camera looks from behind this gate (portrait end view), its tall structure would
    // hide the goal mouth: drop it from view (gameplay readability over set dressing).
    if (tall.current) tall.current.visible = camera.position.x * end < L + 4;
  });
  return (
    <group position-x={end * L}>
      <group ref={tall}>
        {/* Pylons flanking the mouth */}
        {[-1, 1].map((s) => (
          <group key={s} position={[end * 0.35, 0, s * pylonZ]}>
            <mesh position-y={pylonH / 2} castShadow receiveShadow material={stone}>
              <boxGeometry args={[1.5, pylonH, 1.3]} />
            </mesh>
            <mesh position-y={pylonH + 0.15} castShadow material={brass}>
              <boxGeometry args={[1.7, 0.3, 1.5]} />
            </mesh>
            <mesh position-y={0.3} material={brass}>
              <boxGeometry args={[1.62, 0.18, 1.42]} />
            </mesh>
            <mesh
              position={[-end * 0.76, pylonH * 0.55, 0]}
              rotation-y={Math.PI / 2}
              material={glyph}
            >
              <ringGeometry args={[0.28, 0.36, 3, 1]} />
            </mesh>
          </group>
        ))}
        {/* Monumental arch */}
        <mesh
          position={[end * 0.35, pylonH + 0.3, 0]}
          rotation-y={Math.PI / 2}
          castShadow
          material={steel}
        >
          <torusGeometry args={[archR, 0.32, 16, 64, Math.PI]} />
        </mesh>
        <mesh position={[end * 0.35, pylonH + 0.3, 0]} rotation-y={Math.PI / 2} material={brass}>
          <torusGeometry args={[archR - 0.42, 0.09, 8, 64, Math.PI]} />
        </mesh>
        {/* Lintel */}
        <mesh position={[end * 0.35, g.mouthHeight + 0.35, 0]} castShadow material={brass}>
          <boxGeometry args={[0.9, 0.7, g.mouthHalfWidth * 2 + 0.8]} />
        </mesh>
        {/* Cavity back wall and roof would also block an end-on view of the mouth */}
        <mesh position={[end * (g.depth + 0.25), g.mouthHeight / 2, 0]} material={cavity}>
          <boxGeometry args={[0.5, g.mouthHeight, g.mouthHalfWidth * 2 + 1]} />
        </mesh>
        <mesh position={[end * (g.depth / 2), g.mouthHeight + 0.25, 0]} material={cavity}>
          <boxGeometry args={[g.depth + 0.5, 0.5, g.mouthHalfWidth * 2 + 1]} />
        </mesh>
      </group>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[end * (g.depth / 2), g.mouthHeight / 2, s * (g.mouthHalfWidth + 0.25)]}
          material={cavity}
        >
          <boxGeometry args={[g.depth, g.mouthHeight, 0.5]} />
        </mesh>
      ))}
      {/* Posts */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[0, g.mouthHeight / 2, s * g.mouthHalfWidth]}
          castShadow
          material={brass}
        >
          <cylinderGeometry args={[g.postRadius, g.postRadius * 1.1, g.mouthHeight, 24]} />
        </mesh>
      ))}
      {/* Receiver membrane just behind the scoring plane */}
      <mesh
        position={[end * 1.1, g.mouthHeight / 2, 0]}
        rotation-y={Math.PI / 2}
        material={membrane}
      >
        <planeGeometry args={[g.mouthHalfWidth * 2, g.mouthHeight]} />
      </mesh>
      <pointLight
        position={[end * 1.6, 2.2, 0]}
        color={team}
        intensity={6}
        distance={9}
        decay={2}
      />
    </group>
  );
}

/**
 * Dark stone plinths behind the far wall, outside the scoring lane: the wielders' stations
 * (characters arrive in Phase 07D). Distinct engraved shape per team, not just colour.
 */
function Plinths({ arena }: { arena: ArenaLayout }) {
  const stone = useStandard({ color: '#1e242b', roughness: 0.78, metalness: 0.05 });
  const brass = useStandard(BRASS);
  const inlays = [
    useStandard({
      color: '#140a02',
      emissive: TEAM_COLORS[0],
      emissiveIntensity: 2.4,
      roughness: 0.4,
    }),
    useStandard({
      color: '#02100f',
      emissive: TEAM_COLORS[1],
      emissiveIntensity: 2.4,
      roughness: 0.4,
    }),
  ] as const;
  const z = -(arena.halfWidth + 2.4);
  return (
    <group>
      {([0, 1] as const).map((slot) => {
        const x = (slot === 0 ? -1 : 1) * 11.5;
        const sides = slot === 0 ? 6 : 4;
        return (
          <group key={slot} position={[x, 0, z]}>
            <mesh position-y={0.8} castShadow receiveShadow material={stone}>
              <cylinderGeometry args={[1.45, 1.7, 1.6, sides]} />
            </mesh>
            <mesh position-y={1.63} castShadow material={brass}>
              <cylinderGeometry args={[1.55, 1.5, 0.08, sides]} />
            </mesh>
            <mesh position-y={1.68} rotation-x={-Math.PI / 2} material={inlays[slot]}>
              <ringGeometry args={[0.85, 1.0, sides]} />
            </mesh>
            <mesh position-y={0.25} material={brass}>
              <cylinderGeometry args={[1.74, 1.78, 0.12, sides]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Underside({ arena }: { arena: ArenaLayout }) {
  const slab = useStandard(UNDERSIDE);
  const steel = useStandard({ ...STEEL, color: '#56626d' });
  const ember = useStandard({
    color: '#140c08',
    emissive: '#c76d32',
    emissiveIntensity: 0.9,
    roughness: 0.8,
  });
  const hx = arena.halfLength + arena.goal.depth + 0.6;
  const hz = arena.halfWidth + 2;
  return (
    <group>
      {/* Top face sits 3 cm below the floor plane: coplanar faces z-fight. */}
      <mesh position-y={-1.33} receiveShadow material={slab}>
        <boxGeometry args={[hx * 2 + 0.6, 2.6, hz * 2 + 0.6]} />
      </mesh>
      <mesh position-y={-3.6} material={slab}>
        <boxGeometry args={[hx * 1.7, 2.2, hz * 1.55]} />
      </mesh>
      <mesh position-y={-6.2} material={slab}>
        <cylinderGeometry args={[hz * 0.95, hz * 0.35, 4.2, 9]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position-y={-4.6 - i * 1.6}
          rotation-x={Math.PI / 2}
          material={i === 1 ? ember : steel}
        >
          <torusGeometry args={[hz * (1.25 - i * 0.18), 0.22 + (i === 1 ? 0.05 : 0), 8, 72]} />
        </mesh>
      ))}
    </group>
  );
}

function DistantSpires() {
  const count = 46;
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 7, 6);
    const p = g.attributes.position as THREE.BufferAttribute;
    const rand = mulberry32(77);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const j = 0.82 + rand() * 0.36;
      p.setXYZ(i, p.getX(i) * j, y, p.getZ(i) * j);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const material = useStandard({
    color: '#1f2c38',
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = mulberry32(4242);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.2;
      const r = 95 + rand() * 170;
      const h = 30 + rand() * 120;
      const w = 6 + rand() * 16;
      pos.set(Math.cos(a) * r, -40 + h / 2 - rand() * 30, Math.sin(a) * r);
      q.setFromEuler(
        new THREE.Euler((rand() - 0.5) * 0.2, rand() * Math.PI, (rand() - 0.5) * 0.25),
      );
      s.set(w, h, w * (0.7 + rand() * 0.6));
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);
  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />;
}

export { LIGHTING };
