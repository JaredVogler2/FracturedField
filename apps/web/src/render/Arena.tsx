/**
 * The Shattered Meridian, rendered (Phase 07A / D07): the field floor inside a ring of bevelled
 * basalt slabs with a broken rim, low walls of stone blocks under forged brass rails, sculpted
 * rift gates, monumental columns, the platform's engineered underside, floating fragments and
 * distant formations behind the storm haze. Geometry comes from seeded generators (arena/geometry)
 * and materials from art-token recipes (arena/materials); nothing here touches physics — every
 * collider is defined in shared data, and decor stays outside the playable volume (tested).
 */
import { createContext, useContext, useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MERIDIAN_ARENA, type ArenaLayout } from '@ff/game-data';
import { arenaStaticShapes, type StaticShape } from '@ff/sim/arena';
import { generateFloorTextures } from './floor-texture';
import { ARENA_ART, GLOW, LIGHTING, PALETTE, TEAM_COLORS } from './art-tokens';
import { createMembraneMaterial, createRiftGlassMaterial } from './shaders';
import { mulberry32 } from './procedural';
import { renders } from './bisect';
import { useGameClient } from './frame-context';
import { SUN_DIR } from './atmosphere';
import { bakeKeyShadowMask, patchKeyLight, setKeyMask, type MaskBounds } from './key-light';
import { runeStripTexture } from './rune-texture';
import { Braziers } from './braziers';
import { FarWorld } from './far-world';
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
import {
  backdropMaterial,
  surfaceMaterial,
  type SurfaceMaterial,
  type SurfaceName,
} from './arena/materials';

const WALL_VISUAL_HEIGHT = 1.25;

type TextureTier = keyof typeof ARENA_ART.surfaceTextureSize;

/** Whether the arena's surfaces use the low-tier shader variant (follows the rendering tier). */
const LowSurfaces = createContext(false);

/**
 * Opaque draw layers. three sorts opaque objects by material before depth, so large background
 * geometry could be shaded first and then painted over: drawn after the near arena, the depth
 * test rejects every pixel the platform hides (most of the underside, much of the far rock).
 */
const BEHIND_PLATFORM = 1;
const FAR_SCENERY = 2;

/** A surface material for the component's lifetime. */
function useSurface(name: SurfaceName, size: number): SurfaceMaterial {
  const low = useContext(LowSurfaces);
  const m = useMemo(() => surfaceMaterial(name, size, low), [name, size, low]);
  useEffect(() => () => m.dispose(), [m]);
  return m;
}

/** Background geometry's material: the full surface, or the cheap backdrop on the low tier. */
function useBackdrop(name: SurfaceName, size: number): THREE.Material {
  const low = useContext(LowSurfaces);
  const m = useMemo(
    () => (low ? backdropMaterial(name) : surfaceMaterial(name, size)),
    [name, size, low],
  );
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

/**
 * The ground the baked key shadows cover: the platform (radius 32 m) and the long shadows the rim
 * columns throw across it, away from the key.
 */
const KEY_MASK_BOUNDS: MaskBounds = { minX: -38, minZ: -36, sizeX: 76, sizeZ: 72 };

export function Arena({
  textureSize,
  arena = MERIDIAN_ARENA,
  tier = 'high',
  gateLights = true,
  lowSurfaces = false,
  bakedShadows = false,
}: {
  textureSize: number;
  arena?: ArenaLayout;
  tier?: TextureTier;
  /** The gates' team point lights (dropped on the low tier: the membranes still glow). */
  gateLights?: boolean;
  /** The low-tier surface shader (dominant-axis sampling, no normal maps). */
  lowSurfaces?: boolean;
  /** No shadow maps on this tier: bake the static structures' key shadows onto the ground once. */
  bakedShadows?: boolean;
}) {
  const shapes = useMemo(() => arenaStaticShapes(arena), [arena]);
  const surfaceSize = ARENA_ART.surfaceTextureSize[tier];
  const lod: Lod = tier === 'low' ? 'low' : 'high';
  const root = useRef<THREE.Group>(null);
  return (
    <LowSurfaces.Provider value={lowSurfaces}>
      <group ref={root}>
        {renders('floor') && <Floor arena={arena} textureSize={textureSize} />}
        {renders('platform') && <PlatformRing arena={arena} size={surfaceSize} lod={lod} />}
        {renders('walls') && <WallRuns shapes={shapes} size={surfaceSize} lod={lod} />}
        {renders('pillars') && <Pillars shapes={shapes} size={surfaceSize} lod={lod} />}
        {renders('gates') && (
          <>
            <Gate end={-1} arena={arena} size={surfaceSize} lod={lod} light={gateLights} />
            <Gate end={1} arena={arena} size={surfaceSize} lod={lod} light={gateLights} />
          </>
        )}
        {renders('plinths') && <Plinths arena={arena} size={surfaceSize} />}
        {renders('braziers') && (
          <Braziers lod={lod} size={surfaceSize} embers={lod === 'low' ? 6 : 14} />
        )}
        {renders('monoliths') && <Monoliths size={surfaceSize} lod={lod} />}
        {renders('underside') && <Underside size={surfaceSize} lod={lod} />}
        {renders('formations') && <DistantFormations size={surfaceSize} lod={lod} />}
        {renders('farworld') && <FarWorld lod={lod} />}
      </group>
      {bakedShadows && renders('bakedshadows') && <BakedKeyShadows root={root} lod={lod} />}
    </LowSurfaces.Provider>
  );
}

/**
 * Bakes the key shadows of everything under `root` that casts one (walls, pillars, gates,
 * plinths, rim columns) into the shared ground mask, once per arena build. The arena's objects
 * are attached during the commit, before any effect runs.
 */
function BakedKeyShadows({ root, lod }: { root: RefObject<THREE.Group | null>; lod: Lod }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const mask = bakeKeyShadowMask(gl, r, SUN_DIR, KEY_MASK_BOUNDS, 768);
    setKeyMask(mask, KEY_MASK_BOUNDS);
    return () => {
      setKeyMask(null);
      mask.dispose();
    };
  }, [gl, root, lod]);
  return null;
}

function Floor({ arena, textureSize }: { arena: ArenaLayout; textureSize: number }) {
  const low = useContext(LowSurfaces);
  const tex = useMemo(() => generateFloorTextures(arena, textureSize), [arena, textureSize]);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      map: tex.map,
      // Low tier: the tile bevels are a pixel wide there; skip the normal-map pass.
      normalMap: low ? null : tex.normalMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: tex.ormMap,
      metalnessMap: tex.ormMap,
      aoMap: tex.ormMap,
      aoMapIntensity: 0.9,
      roughness: 1,
      metalness: 1,
    });
    // Cloud shadows and (low tier) baked static shadows on the key.
    m.onBeforeCompile = patchKeyLight;
    return m;
  }, [tex, low]);
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
function WallRuns({
  shapes,
  size,
  lod,
}: {
  shapes: readonly StaticShape[];
  size: number;
  lod: Lod;
}) {
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
      stone.push(wallBlocks(100 + i, length, thick, WALL_VISUAL_HEIGHT, lod).applyMatrix4(place));
      brass.push(capRail(length, thick, WALL_VISUAL_HEIGHT, lod).applyMatrix4(place));
    });
    const out = { stone: mergeGeometries(stone), brass: mergeGeometries(brass) };
    for (const g of [...stone, ...brass]) g.dispose();
    return out;
  }, [shapes, lod]);
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
  // Carved inscription lit from within: glyph strokes glow, the stone between them stays dark.
  const rune = useMemo(() => {
    const glyphs = runeStripTexture();
    glyphs.repeat.set(2, 1);
    return new THREE.MeshStandardMaterial({
      color: '#15121f',
      roughness: 0.55,
      emissive: PALETTE.riftViolet,
      emissiveMap: glyphs,
      emissiveIntensity: GLOW.pillarRunes,
    });
  }, []);
  useEffect(
    () => () => {
      rune.emissiveMap?.dispose();
      rune.dispose();
    },
    [rune],
  );
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
  light,
}: {
  end: 1 | -1;
  arena: ArenaLayout;
  size: number;
  lod: Lod;
  light: boolean;
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
    emissiveIntensity: GLOW.gateMotif,
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
      {light && (
        <pointLight position={[1.6, 2.2, 0]} color={team} intensity={6} distance={9} decay={2} />
      )}
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
      emissiveIntensity: GLOW.plinthInlay,
      roughness: 0.4,
    }),
    useStandard({
      color: '#02100f',
      emissive: TEAM_COLORS[1],
      emissiveIntensity: GLOW.plinthInlay,
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
  const stone = useBackdrop('basaltFractured', size);
  const brass = useBackdrop('brassAged', size);
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
          <mesh
            geometry={b.geo.stone}
            material={stone}
            castShadow
            receiveShadow
            renderOrder={FAR_SCENERY}
          />
          <mesh geometry={b.geo.brass} material={brass} castShadow renderOrder={FAR_SCENERY} />
        </group>
      ))}
    </group>
  );
}

function Underside({ size, lod }: { size: number; lod: Lod }) {
  const geo = useMemo(() => underside(ARENA_ART.platform.outerRadius * 0.9, lod), [lod]);
  useDisposeAll(useMemo(() => [geo.stone, geo.caps, geo.steel, geo.ember], [geo]));
  const cap = useMemo(() => new THREE.MeshBasicMaterial({ color: ARENA_ART.undersideCap }), []);
  useEffect(() => () => cap.dispose(), [cap]);
  const stone = useBackdrop('basaltDeep', size);
  const steel = useBackdrop('steelCold', size);
  // Bright enough to bloom (medium/high tiers) — the conduits glow, they are not painted lines.
  const ember = useStandard({
    color: '#140c08',
    emissive: PALETTE.earthInterior,
    emissiveIntensity: 3.2,
    roughness: 0.8,
  });
  return (
    <group>
      <mesh geometry={geo.stone} material={stone} renderOrder={BEHIND_PLATFORM} />
      <mesh geometry={geo.caps} material={cap} renderOrder={BEHIND_PLATFORM} />
      <mesh geometry={geo.steel} material={steel} renderOrder={BEHIND_PLATFORM} />
      <mesh geometry={geo.ember} material={ember} renderOrder={BEHIND_PLATFORM} />
    </group>
  );
}

/** Suspended rock formations far out in the storm, faded by the atmospheric fog. */
function DistantFormations({ size, lod }: { size: number; lod: Lod }) {
  const { count, seed, near, far } = ARENA_ART.formations;
  // Lit and hazed rather than black, their facets show: finer on the high detail level.
  const geometry = useMemo(() => rock(seed, lod === 'high' ? 3 : 2, 7), [seed, lod]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useBackdrop('basaltFar', size);
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const rand = mulberry32(seed);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.25;
      const r = near + rand() * (far - near);
      const w = 8 + rand() * 30 * (r / far + 0.4);
      // Spires and mesas more than boulders: they read as rock formations, not balloons.
      const h = w * (1.1 + rand() * 1.6);
      const y = -30 + rand() * 60 - h * 0.2;
      const e = new THREE.Euler((rand() - 0.5) * 0.4, rand() * Math.PI, (rand() - 0.5) * 0.4);
      const depth = 0.6 + rand() * 0.6;
      // The sky toward the storm break (west to north-west) stays open: that is where the menu's
      // camera looks, and where the sky islands stand against the bright break.
      const az = Math.atan2(Math.sin(a), Math.cos(a));
      if (az > ARENA_ART.formations.openSky[0] || az < ARENA_ART.formations.openSky[1]) continue;
      pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
      q.setFromEuler(e);
      s.set(w, h, w * depth);
      m.compose(pos, q, s);
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, seed, near, far]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, count]}
      frustumCulled={false}
      renderOrder={FAR_SCENERY}
    />
  );
}

export { LIGHTING };
