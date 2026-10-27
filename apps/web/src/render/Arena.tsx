/**
 * The Shattered Meridian, rendered (Phase 07A / D07): the field floor inside a ring of bevelled
 * basalt slabs with a broken rim, low walls of stone blocks under forged brass rails, sculpted
 * rift gates, monumental columns, the platform's engineered underside, floating fragments and
 * distant formations behind the storm haze. Geometry comes from seeded generators (arena/geometry)
 * and materials from art-token recipes (arena/materials); nothing here touches physics — every
 * collider is defined in shared data, and decor stays outside the playable volume (tested).
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MERIDIAN_ARENA, type ArenaLayout } from '@ff/game-data';
import { arenaStaticShapes, type StaticShape } from '@ff/sim/arena';
import { generateFloorTextures } from './floor-texture';
import { ARENA_ART, LIGHTING, PALETTE, TEAM_COLORS } from './art-tokens';
import { createMembraneMaterial, createRiftGlassMaterial } from './shaders';
import { mulberry32 } from './procedural';
import { useGameClient } from './frame-context';
import {
  capRail,
  crystalCluster,
  fieldPillar,
  gate,
  gateCavity,
  gateRingHeight,
  goalPosts,
  monolith,
  plinth,
  platform,
  rock,
  underside,
  wallBlocks,
  type Lod,
} from './arena/geometry';
import { surfaceMaterial, type SurfaceMaterial, type SurfaceName } from './arena/materials';

const WALL_VISUAL_HEIGHT = 1.25;

type TextureTier = keyof typeof ARENA_ART.surfaceTextureSize;

/** A surface material for the component's lifetime. */
function useSurface(name: SurfaceName, size: number): SurfaceMaterial {
  const m = useMemo(() => surfaceMaterial(name, size), [name, size]);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

/** A plain standard material keyed by its (plain-data) parameters; disposed on unmount. */
function useStandard(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const key = JSON.stringify(params);
  const m = useMemo(
    () => new THREE.MeshStandardMaterial(JSON.parse(key) as THREE.MeshStandardMaterialParameters),
    [key],
  );
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

/** Disposes every geometry in a memoised bundle when it is replaced or unmounted. */
function useDisposeAll(geometries: readonly THREE.BufferGeometry[]): void {
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
}

export function Arena({
  textureSize,
  arena = MERIDIAN_ARENA,
  tier = 'high',
}: {
  textureSize: number;
  arena?: ArenaLayout;
  tier?: TextureTier;
}) {
  const shapes = useMemo(() => arenaStaticShapes(arena), [arena]);
  const surfaceSize = ARENA_ART.surfaceTextureSize[tier];
  const lod: Lod = tier === 'low' ? 'low' : 'high';
  return (
    <group>
      <Floor arena={arena} textureSize={textureSize} />
      <PlatformRing arena={arena} size={surfaceSize} lod={lod} />
      <WallRuns shapes={shapes} size={surfaceSize} />
      <Pillars shapes={shapes} size={surfaceSize} lod={lod} />
      <Gate end={-1} arena={arena} size={surfaceSize} lod={lod} />
      <Gate end={1} arena={arena} size={surfaceSize} lod={lod} />
      <Plinths arena={arena} size={surfaceSize} />
      <Monoliths size={surfaceSize} lod={lod} />
      <Underside size={surfaceSize} lod={lod} />
      <DistantFormations size={surfaceSize} />
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

/** The basal platform around the field, plus the fragments that broke off its rim. */
function PlatformRing({ arena, size, lod }: { arena: ArenaLayout; size: number; lod: Lod }) {
  const plat = useMemo(
    () =>
      platform({
        ...ARENA_ART.platform,
        // The slabs wrap the field floor plane exactly (its rectangle, see floor-texture).
        inner: {
          halfX: arena.halfLength + arena.goal.depth + 0.6,
          halfZ: arena.halfWidth + 2,
          chamfer: 0,
        },
      }),
    [arena],
  );
  const shards = useMemo(() => {
    const rand = mulberry32(ARENA_ART.shards.seed);
    const geometry = rock(ARENA_ART.shards.seed, lod === 'high' ? 2 : 1);
    const items: { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3; bob: number }[] = [];
    // Bigger fragments hang below the bites in the rim; smaller ones drift all around.
    for (const b of plat.bites) {
      for (let i = 0; i < 4; i++) {
        const t = b.theta + (rand() - 0.5) * 0.18;
        const r = plat.outerAt(t) + 1.5 + rand() * 4;
        const s = 0.8 + rand() * 1.6 * (b.depth / 3);
        items.push({
          pos: new THREE.Vector3(Math.cos(t) * r, -1.5 - rand() * 6, Math.sin(t) * r),
          rot: new THREE.Euler(rand() * 6, rand() * 6, rand() * 6),
          scale: new THREE.Vector3(s, s * (0.5 + rand() * 0.6), s * (0.7 + rand() * 0.5)),
          bob: rand() * Math.PI * 2,
        });
      }
    }
    while (items.length < ARENA_ART.shards.count) {
      const t = rand() * Math.PI * 2;
      const r = plat.outerAt(t) + 0.8 + rand() * 9;
      const s = 0.25 + rand() * 0.9;
      items.push({
        pos: new THREE.Vector3(Math.cos(t) * r, -3 + rand() * 5, Math.sin(t) * r),
        rot: new THREE.Euler(rand() * 6, rand() * 6, rand() * 6),
        scale: new THREE.Vector3(s, s * (0.5 + rand() * 0.7), s),
        bob: rand() * Math.PI * 2,
      });
    }
    return { geometry, items };
  }, [plat, lod]);
  const rubble = useMemo(() => {
    const rand = mulberry32(ARENA_ART.shards.seed + 1);
    const geometry = rock(ARENA_ART.shards.seed + 2, 1, 4);
    const m = new THREE.Matrix4();
    const matrices = plat.rubble.map(([x, y, z]) => {
      const s = 0.35 + rand() * 0.55;
      // Partly sunk into the slab it rests on.
      return m
        .compose(
          new THREE.Vector3(x, y + s * 0.3, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)),
          new THREE.Vector3(s, s * (0.55 + rand() * 0.35), s * (0.7 + rand() * 0.4)),
        )
        .clone();
    });
    return { geometry, matrices };
  }, [plat]);
  // Rift crystals growing out of the cracked slabs (translucent rift glass).
  const crystals = useMemo(() => {
    const rand = mulberry32(ARENA_ART.shards.seed + 3);
    const geometry = crystalCluster(ARENA_ART.shards.seed + 4);
    const m = new THREE.Matrix4();
    const matrices = plat.crystals.map(([x, y, z]) => {
      const s = 0.8 + rand() * 0.9;
      return m
        .compose(
          new THREE.Vector3(x, y - 0.04, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand() * Math.PI * 2, 0)),
          new THREE.Vector3(s, s * (0.8 + rand() * 0.5), s),
        )
        .clone();
    });
    return { geometry, matrices };
  }, [plat]);
  useDisposeAll(
    useMemo(
      () => [
        plat.geometry,
        plat.cracked,
        plat.inlays,
        shards.geometry,
        rubble.geometry,
        crystals.geometry,
      ],
      [plat, shards, rubble, crystals],
    ),
  );
  const slabStone = useSurface('basaltPolished', size);
  const crackedStone = useSurface('riftCracked', size);
  const shardStone = useSurface('basaltRubble', size);
  const inlayBrass = useSurface('brassAged', size);
  const glass = useMemo(() => createRiftGlassMaterial(PALETTE.riftViolet, 2.2), []);
  useEffect(() => () => glass.dispose(), [glass]);
  const crystalRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = crystalRef.current;
    if (!mesh) return;
    crystals.matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [crystals]);
  const rubbleRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = rubbleRef.current;
    if (!mesh) return;
    rubble.matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [rubble]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    glass.uniforms.uTime.value += dt;
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    shards.items.forEach((it, i) => {
      // A slow drift in the updraft: cosmetic only.
      p.copy(it.pos).setY(it.pos.y + Math.sin(t * 0.35 + it.bob) * 0.25);
      q.setFromEuler(it.rot);
      m.compose(p, q, it.scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <mesh geometry={plat.geometry} material={slabStone} receiveShadow />
      <mesh geometry={plat.cracked} material={crackedStone} receiveShadow />
      {plat.inlays.hasAttribute('position') && (
        <mesh geometry={plat.inlays} material={inlayBrass} receiveShadow />
      )}
      {crystals.matrices.length > 0 && (
        <instancedMesh
          ref={crystalRef}
          args={[crystals.geometry, glass, crystals.matrices.length]}
          renderOrder={2}
        />
      )}
      <instancedMesh
        ref={rubbleRef}
        args={[rubble.geometry, shardStone, rubble.matrices.length]}
        castShadow
        receiveShadow
      />
      <instancedMesh
        ref={ref}
        args={[shards.geometry, shardStone, shards.items.length]}
        castShadow
        frustumCulled={false}
      />
    </group>
  );
}

/** Low perimeter walls: stone blocks under capstones edged in riveted brass, merged per material. */
function WallRuns({ shapes, size }: { shapes: readonly StaticShape[]; size: number }) {
  const merged = useMemo(() => {
    const walls = shapes.filter(
      (s): s is Extract<StaticShape, { kind: 'cuboid' }> =>
        s.kind === 'cuboid' && s.role === 'wall',
    );
    const stone: THREE.BufferGeometry[] = [];
    const brass: THREE.BufferGeometry[] = [];
    walls.forEach((s, i) => {
      const length = s.half[0] * 2;
      const thick = s.half[2] * 2 + 0.2;
      const place = new THREE.Matrix4().compose(
        new THREE.Vector3(s.pos[0], 0, s.pos[2]),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw),
        new THREE.Vector3(1, 1, 1),
      );
      stone.push(wallBlocks(100 + i, length, thick, WALL_VISUAL_HEIGHT).applyMatrix4(place));
      brass.push(capRail(length, thick, WALL_VISUAL_HEIGHT).applyMatrix4(place));
    });
    const out = { stone: mergeGeometries(stone), brass: mergeGeometries(brass) };
    for (const g of [...stone, ...brass]) g.dispose();
    return out;
  }, [shapes]);
  useDisposeAll(useMemo(() => [merged.stone, merged.brass], [merged]));
  const stone = useSurface('basaltPolished', size);
  const brass = useSurface('brassAged', size);
  return (
    <group>
      <mesh geometry={merged.stone} material={stone} castShadow receiveShadow />
      <mesh geometry={merged.brass} material={brass} castShadow />
    </group>
  );
}

/** The field pillars on their colliders, merged into one draw per material. */
function Pillars({
  shapes,
  size,
  lod,
}: {
  shapes: readonly StaticShape[];
  size: number;
  lod: Lod;
}) {
  const merged = useMemo(() => {
    const parts = { stone: [], brass: [], rune: [] } as Record<
      'stone' | 'brass' | 'rune',
      THREE.BufferGeometry[]
    >;
    for (const s of shapes) {
      if (s.kind !== 'cylinder' || s.role !== 'pillar') continue;
      const p = fieldPillar(s.radius, s.halfHeight * 2, lod);
      for (const k of ['stone', 'brass', 'rune'] as const) {
        parts[k].push(p[k].translate(s.pos[0], 0, s.pos[2]));
      }
    }
    const out = {
      stone: mergeGeometries(parts.stone),
      brass: mergeGeometries(parts.brass),
      rune: mergeGeometries(parts.rune),
    };
    for (const g of [...parts.stone, ...parts.brass, ...parts.rune]) g.dispose();
    return out;
  }, [shapes, lod]);
  useDisposeAll(useMemo(() => [merged.stone, merged.brass, merged.rune], [merged]));
  const stone = useSurface('basaltFractured', size);
  const brass = useSurface('brassAged', size);
  const rune = useStandard({
    color: '#1b1630',
    emissive: PALETTE.riftViolet,
    emissiveIntensity: 2.2,
    roughness: 0.4,
  });
  return (
    <group>
      <mesh geometry={merged.stone} material={stone} castShadow receiveShadow />
      <mesh geometry={merged.brass} material={brass} castShadow />
      <mesh geometry={merged.rune} material={rune} />
    </group>
  );
}

function Gate({
  end,
  arena,
  size,
  lod,
}: {
  end: 1 | -1;
  arena: ArenaLayout;
  size: number;
  lod: Lod;
}) {
  const client = useGameClient();
  const g = arena.goal;
  const L = arena.halfLength;
  // Goal at -X is defended by slot 0 (amber, hexagon); +X by slot 1 (cyan, diamond).
  const team = end < 0 ? TEAM_COLORS[0] : TEAM_COLORS[1];
  const geo = useMemo(
    () =>
      gate({
        mouthHalfWidth: g.mouthHalfWidth,
        mouthHeight: g.mouthHeight,
        depth: g.depth,
        motifSides: end < 0 ? 6 : 4,
        lod,
      }),
    [g.mouthHalfWidth, g.mouthHeight, g.depth, end, lod],
  );
  const fixed = useMemo(
    () => ({
      posts: goalPosts(g.mouthHalfWidth, g.mouthHeight, g.postRadius, lod),
      ...gateCavity(g),
    }),
    [g, lod],
  );
  useDisposeAll(
    useMemo(
      () => [geo.stone, geo.brass, geo.steel, geo.motif, geo.rings, ...Object.values(fixed)],
      [geo, fixed],
    ),
  );
  const ringY = useMemo(() => gateRingHeight(g), [g]);
  const stone = useSurface('basaltFractured', size);
  const brass = useSurface('brassAged', size);
  const steel = useSurface('steelCold', size);
  const cavity = useSurface('basaltDeep', size);
  const membrane = useMemo(() => createMembraneMaterial(team), [team]);
  const glyph = useStandard({
    color: '#111',
    emissive: team,
    emissiveIntensity: 2.4,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  useEffect(() => () => membrane.dispose(), [membrane]);
  const pulse = useRef(0);
  const rings = useRef<THREE.Mesh>(null);
  const tall = useRef<THREE.Group>(null);

  useEffect(
    () =>
      client.events.on((e) => {
        // The scorer attacks the opposite goal: slot 0 scores into +X.
        if (e.type === 'goal' && (e.scorer === 0 ? 1 : -1) === end) pulse.current = 1;
      }),
    [client, end],
  );
  useFrame(({ camera }, dt) => {
    membrane.uniforms.uTime.value += dt;
    pulse.current = Math.max(0, pulse.current - dt * 0.8);
    membrane.uniforms.uPulse.value = pulse.current;
    if (rings.current) rings.current.rotation.x += dt * (0.35 + pulse.current * 3);
    // When the camera looks from behind this gate (portrait end view), its tall structure would
    // hide the goal mouth: drop it from view (gameplay readability over set dressing).
    if (tall.current) tall.current.visible = camera.position.x * end < L + 4;
  });

  return (
    // Built for the +X end; the -X gate is its mirror image (scale -1 keeps winding correct).
    <group position-x={end * L} scale-x={end}>
      <group ref={tall}>
        <group position-x={0.35}>
          <mesh geometry={geo.stone} material={stone} castShadow receiveShadow />
          <mesh geometry={geo.brass} material={brass} castShadow />
          <mesh geometry={geo.motif} material={glyph} />
          <mesh ref={rings} geometry={geo.rings} material={steel} position-y={ringY} />
        </group>
        <mesh geometry={geo.steel} material={steel} castShadow />
        {/* Cavity back wall and roof would also block an end-on view of the mouth */}
        <mesh geometry={fixed.back} material={cavity} receiveShadow />
      </group>
      <mesh geometry={fixed.sides} material={cavity} castShadow receiveShadow />
      {/* Posts (match the colliders) */}
      <mesh geometry={fixed.posts} material={brass} castShadow />
      {/* Receiver membrane just behind the scoring plane */}
      <mesh position={[1.1, g.mouthHeight / 2, 0]} rotation-y={Math.PI / 2} material={membrane}>
        <planeGeometry args={[g.mouthHalfWidth * 2, g.mouthHeight]} />
      </mesh>
      <pointLight position={[1.6, 2.2, 0]} color={team} intensity={6} distance={9} decay={2} />
    </group>
  );
}

/**
 * Dark stone plinths behind the far wall, outside the scoring lane: the wielders' stations
 * (characters arrive in Phase 07D). Distinct engraved shape per team, not just colour.
 */
function Plinths({ arena, size }: { arena: ArenaLayout; size: number }) {
  const built = useMemo(() => [plinth(6), plinth(4)] as const, []);
  useDisposeAll(useMemo(() => built.flatMap((b) => [b.stone, b.brass, b.inlay]), [built]));
  const stone = useSurface('basaltFractured', size);
  const brass = useSurface('brassAged', size);
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
      {([0, 1] as const).map((slot) => (
        <group key={slot} position={[(slot === 0 ? -1 : 1) * 11.5, 0, z]}>
          <mesh geometry={built[slot].stone} material={stone} castShadow receiveShadow />
          <mesh geometry={built[slot].brass} material={brass} castShadow />
          <mesh geometry={built[slot].inlay} material={inlays[slot]} />
        </group>
      ))}
    </group>
  );
}

/**
 * Monumental broken columns on the rim. Any column on the camera's side of the arena would stand
 * between the player and the field, so only those behind the action are shown.
 */
function Monoliths({ size, lod }: { size: number; lod: Lod }) {
  const built = useMemo(
    () =>
      ARENA_ART.monoliths.map((m) => ({
        ...m,
        geo: monolith(m.seed, m.height, m.shaft, lod),
        x: Math.cos(m.angle) * m.radius,
        z: Math.sin(m.angle) * m.radius,
      })),
    [lod],
  );
  useDisposeAll(useMemo(() => built.flatMap((b) => [b.geo.stone, b.geo.brass]), [built]));
  const stone = useSurface('basaltFractured', size);
  const brass = useSurface('brassAged', size);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ camera }) => {
    const cx = camera.position.x;
    const cz = camera.position.z;
    const cl = Math.hypot(cx, cz) || 1;
    built.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      const dot = (b.x * cx + b.z * cz) / (Math.hypot(b.x, b.z) * cl);
      g.visible = dot < 0.25;
    });
  });
  return (
    <group>
      {built.map((b, i) => (
        <group
          key={b.seed}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={[b.x, 0, b.z]}
        >
          <mesh geometry={b.geo.stone} material={stone} castShadow receiveShadow />
          <mesh geometry={b.geo.brass} material={brass} castShadow />
        </group>
      ))}
    </group>
  );
}

function Underside({ size, lod }: { size: number; lod: Lod }) {
  const geo = useMemo(() => underside(ARENA_ART.platform.outerRadius * 0.9, lod), [lod]);
  useDisposeAll(useMemo(() => [geo.stone, geo.steel, geo.ember], [geo]));
  const stone = useSurface('basaltDeep', size);
  const steel = useSurface('steelCold', size);
  // Bright enough to bloom (medium/high tiers) — the conduits glow, they are not painted lines.
  const ember = useStandard({
    color: '#140c08',
    emissive: PALETTE.earthInterior,
    emissiveIntensity: 3.2,
    roughness: 0.8,
  });
  return (
    <group>
      <mesh geometry={geo.stone} material={stone} />
      <mesh geometry={geo.steel} material={steel} />
      <mesh geometry={geo.ember} material={ember} />
    </group>
  );
}

/** Suspended rock formations far out in the storm, faded by the atmospheric fog. */
function DistantFormations({ size }: { size: number }) {
  const { count, seed, near, far } = ARENA_ART.formations;
  const geometry = useMemo(() => rock(seed, 2, 5), [seed]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useSurface('basaltFar', size);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = mulberry32(seed);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.25;
      const r = near + rand() * (far - near);
      const w = 8 + rand() * 30 * (r / far + 0.4);
      const h = w * (0.5 + rand() * 1.6);
      pos.set(Math.cos(a) * r, -30 + rand() * 60 - h * 0.2, Math.sin(a) * r);
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.4));
      s.set(w, h, w * (0.6 + rand() * 0.6));
      m.compose(pos, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, seed, near, far]);
  return <instancedMesh ref={ref} args={[geometry, material, count]} frustumCulled={false} />;
}

export { LIGHTING };
