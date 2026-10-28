/**
 * The Rift Core (7C / D09): a plasma heart inside a shell of polished crystal plates you see it
 * through, its light leaking from the seams and hairline cracks, a halo round its silhouette and
 * two engraved gyroscope bands turning about it. Everything it does narrates authoritative state:
 * speed energises it, the deliberate spin that curves it parts the plates, lights the cracks and
 * spins the bands, heat warms it, charge whitens it, water dulls it, an impact jolts the plates, a
 * goal collapses it and the next kickoff forms it again. One draw each for the heart, the plates,
 * the aura and the two bands, two sprites (glow and spark).
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_RULES } from '@ff/game-data';
import { useGameClient, useRenderFrame } from '../frame-context';
import { useDisposable } from '../hooks';
import { LIGHTING, PALETTE } from '../art-tokens';
import { runeStripTexture } from '../rune-texture';
import { useSettings } from '../../game/settings';
import { bandGeometry, corePlateGeometry } from './core-geometry';
import { createAuraMaterial, createHeartMaterial, createPlateMaterial } from './core-materials';
import { newCoreLook, stepCoreLook } from './core-look';

const R = DEFAULT_RULES.core.radius;
const HEART_R = R * 0.8;
const CORE_VIOLET = new THREE.Color(PALETTE.riftViolet);
const SEAM_VIOLET = new THREE.Color('#b394ff');
const HEAT = new THREE.Color('#ff7a2a');
const ARC = new THREE.Color('#bfe6ff');
const WHITE = new THREE.Color('#ffffff');
// The plasma's filament colour (linear): violet-white, warmed by heat, whitened by charge.
const PLASMA_HOT = new THREE.Color(0.8, 0.7, 1.0);
const PLASMA_HEAT = new THREE.Color(1.0, 0.58, 0.26);
const PLASMA_ARC = new THREE.Color(0.72, 0.9, 1.0);
/** Impulse of an impact that reads as a full jolt (the event's units). */
const FULL_IMPACT = 220;

/** A soft round glow (`power` sharpens the falloff: higher is a hotter, tighter centre). */
function glowTexture(size = 64, power = 2.2): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, power);
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(a * 255);
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function CoreVisual({
  id,
  tier,
  light,
}: {
  id: number;
  tier: 'low' | 'medium' | 'high';
  /** The scene's core light (always mounted: see Entities); this core drives it. */
  light: React.RefObject<THREE.PointLight | null>;
}) {
  const frame = useRenderFrame();
  const client = useGameClient();
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const viewport = useThree((s) => s.size);
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bandA = useRef<THREE.Mesh>(null);
  const bandB = useRef<THREE.Mesh>(null);
  const sprite = useRef<THREE.Sprite>(null);
  const heartMesh = useRef<THREE.Mesh>(null);
  const spark = useRef<THREE.Sprite>(null);

  const heart = useDisposable(() => createHeartMaterial(tier === 'low' ? 1 : 3), [tier]);
  const plates = useMemo(() => createPlateMaterial(tier !== 'low', HEART_R), [tier]);
  useEffect(() => () => plates.material.dispose(), [plates]);
  const aura = useDisposable(() => createAuraMaterial(), []);
  const plateGeo = useDisposable(() => corePlateGeometry(R * 0.96), []);
  const heartGeo = useDisposable(() => new THREE.IcosahedronGeometry(HEART_R, 4), []);
  const auraGeo = useDisposable(() => new THREE.IcosahedronGeometry(R * 1.14, 3), []);
  const bandGeoA = useDisposable(() => bandGeometry(R * 1.24, 0.045, 0.11, 96, 5), []);
  const bandGeoB = useDisposable(() => bandGeometry(R * 1.4, 0.025, 0.055, 112, 7), []);
  const runes = useDisposable(() => {
    const t = runeStripTexture(29, 24, 32, 48);
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }, []);
  const brass = useDisposable(
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.brass,
        metalness: 1,
        roughness: 0.34,
        emissive: CORE_VIOLET,
        emissiveMap: runes,
        emissiveIntensity: 1.4,
      }),
    [runes],
  );
  const glow = useDisposable(() => glowTexture(), []);
  const sparkTex = useDisposable(() => glowTexture(64, 4.5), []);
  // The rift spark: the heart's hot centre, seen through the shell like light through its cracks.
  const sparkMat = useDisposable(
    () =>
      new THREE.SpriteMaterial({
        map: sparkTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.15,
      }),
    [sparkTex],
  );
  const glowMat = useDisposable(
    () =>
      new THREE.SpriteMaterial({
        map: glow,
        color: SEAM_VIOLET,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.3,
      }),
    [glow],
  );

  // Authoritative events that touch the core, folded into the next frame's look.
  const pending = useRef({ impact: 0, goal: false, kickoff: false });
  useEffect(
    () =>
      client.events.on((e) => {
        const p = pending.current;
        if (e.type === 'impact' && (e.a === id || e.b === id))
          p.impact = Math.max(p.impact, Math.min(1, e.impulse / FULL_IMPACT));
        else if (e.type === 'goal') p.goal = true;
        else if (e.type === 'kickoff') p.kickoff = true;
      }),
    [client, id],
  );

  // Dark again when this core goes (the light itself stays: see Entities).
  useEffect(
    () => () => {
      if (light.current) light.current.intensity = 0;
    },
    [light],
  );

  const look = useMemo(() => newCoreLook(), []);
  const seam = useMemo(() => new THREE.Color(), []);
  const hot = useMemo(() => new THREE.Color(), []);
  const camObj = useMemo(() => new THREE.Vector3(), []);
  const spin = useRef({ a: 0, b: 0, phase: 0, time: 0 });
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const e = frame.current?.entities.get(id);
    const g = group.current;
    if (!e || !g) return;
    g.position.set(e.px, e.py, e.pz);
    if (body.current) body.current.quaternion.set(e.qx, e.qy, e.qz, e.qw);
    const p = pending.current;
    stepCoreLook(look, {
      dt,
      speed: Math.hypot(e.vx, e.vy, e.vz),
      spin: e.spin,
      temp: e.temp,
      charge: e.charge,
      wet: e.wet,
      impact: p.impact,
      goal: p.goal,
      kickoff: p.kickoff,
      reducedMotion,
    });
    p.impact = 0;
    p.goal = false;
    p.kickoff = false;

    g.scale.setScalar(Math.max(1e-3, look.scale));
    g.visible = look.scale > 0.002;
    // Readability: the smaller the core is on screen (a phone, a far camera), the brighter its
    // light — full boost below ~12 px of radius, none above ~48 px. Not a state: a lens on it.
    const dist = Math.max(0.5, camera.position.distanceTo(g.position));
    const pxRadius =
      (R * viewport.height) / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const small = Math.min(1, Math.max(0, (48 - pxRadius) / 36));
    const motion = reducedMotion ? 0.3 : 1;
    const s = spin.current;
    // The plasma churns faster with energy (integrated, so a change of speed never jumps it).
    s.phase += dt * (0.22 + 0.55 * look.energy) * motion;
    hot
      .copy(PLASMA_HOT)
      .lerp(PLASMA_HEAT, look.heat)
      .lerp(PLASMA_ARC, look.charge * 0.7);
    if (body.current) {
      // The heart and the plates share the body's object space: rays start at the camera.
      camObj.copy(camera.position);
      body.current.worldToLocal(camObj);
    }
    // Small on screen, the heart swells into the shell: its light fills the seams and the missing
    // plates, which would otherwise alias into dark speckle.
    heartMesh.current?.scale.setScalar(1 + 0.18 * small);
    const hu = heart.uniforms;
    hu.uPhase.value = s.phase;
    hu.uEnergy.value = look.energy;
    hu.uHot.value.copy(hot);
    hu.uFlash.value = look.flash;
    hu.uBoost.value = 0.9 * small;
    hu.uCamObj.value.copy(camObj);
    const pu = plates.uniforms;
    pu.uPhase.value = s.phase;
    pu.uEnergy.value = look.energy;
    pu.uHot.value.copy(hot);
    pu.uCamObj.value.copy(camObj);
    s.time += dt;
    // Seam light: violet, warmed by heat, whitened (and flickering) with charge.
    const flicker = look.charge > 0 && !reducedMotion ? 0.75 + 0.25 * Math.sin(s.time * 47) : 1;
    seam
      .copy(SEAM_VIOLET)
      .lerp(HEAT, look.heat)
      .lerp(ARC, look.charge * 0.7);
    pu.uCrackColor.value.copy(seam);
    pu.uCrack.value = look.crack * flicker * (1 + look.flash * 2) * (1 + 1.4 * small);
    pu.uExplode.value = look.explode * R;
    pu.uSmall.value = small;
    // Water beads on the crystal: a little glossier, a little less clear.
    plates.material.roughness = 0.1 - look.wet * 0.06;
    pu.uClarity.value = 0.7 - 0.2 * look.wet;
    // Small on screen, the plasma's own violet comes through: a bright ball rather than dark
    // facets that alias into speckle. Close up, dark crystal.
    pu.uDeepGain.value = 0.35 + 0.65 * small;
    aura.uniforms.uColor.value.copy(seam);
    aura.uniforms.uStrength.value =
      (0.45 + 0.35 * look.energy + 0.6 * look.shock + look.flash) * (1 + 1.2 * small);

    // The bands: one turns with the core's energy and spin, the other precesses slowly.
    const rate = 0.5 + 2.6 * look.energy + 5 * look.spinRate * Math.sign(e.spin || 1);
    s.a += dt * rate * motion;
    s.b += dt * (reducedMotion ? 0.1 : 0.32 + 1.2 * look.energy);
    // Order ZXY: each band turns about its own axis first, then is tilted.
    if (bandA.current) bandA.current.rotation.set(0.42, s.a, 0.18, 'ZXY');
    if (bandB.current) bandB.current.rotation.set(1.25, s.b, -0.35, 'ZXY');
    brass.emissive.copy(seam);
    brass.emissiveIntensity = 0.9 + 1.3 * look.energy + 1.5 * look.shock;

    const l = light.current;
    if (l) {
      l.position.copy(g.position);
      l.color
        .copy(CORE_VIOLET)
        .lerp(HEAT, look.heat)
        .lerp(ARC, look.charge * 0.8);
      // Collapsed, the core gives no light (dimmed, never hidden: see Entities).
      l.intensity =
        LIGHTING.coreLightIntensity *
        (0.75 + 0.7 * look.energy + 0.8 * look.shock) *
        (1 + look.charge * 0.6) *
        flicker *
        (1 + look.flash * 2) *
        Math.min(1, look.scale);
    }
    if (spark.current) {
      sparkMat.color.copy(WHITE).lerp(seam, 0.35);
      sparkMat.opacity = Math.min(
        1,
        0.12 + 0.75 * small + 0.25 * look.energy + 0.5 * look.shock + look.flash,
      );
      spark.current.scale.setScalar(R * (1.15 + 0.4 * look.energy + 1.5 * look.flash));
    }
    if (sprite.current) {
      glowMat.color.copy(seam);
      glowMat.opacity =
        (tier === 'low' ? 0.42 : 0.24) * (0.6 + 0.6 * look.energy + look.flash) + 0.35 * small;
      sprite.current.scale.setScalar(
        R * (3 + 1.2 * look.energy + 2 * look.flash) * (1 + 0.8 * small),
      );
    }
  });

  return (
    <group ref={group}>
      <group ref={body}>
        <mesh ref={heartMesh} geometry={heartGeo} material={heart} />
        <mesh geometry={plateGeo} material={plates.material} castShadow />
      </group>
      <mesh geometry={auraGeo} material={aura} renderOrder={2} />
      <mesh ref={bandA} geometry={bandGeoA} material={brass} castShadow />
      <mesh ref={bandB} geometry={bandGeoB} material={brass} castShadow />
      <sprite ref={sprite} material={glowMat} renderOrder={3} />
      <sprite ref={spark} material={sparkMat} renderOrder={5} />
    </group>
  );
}
