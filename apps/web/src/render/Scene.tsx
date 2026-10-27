import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { MERIDIAN_ARENA } from '@ff/game-data';
import { Arena } from './Arena';
import { Entities, Manipulators } from './Entities';
import { FrameDriver, useGameClient } from './frame-context';
import { view } from './view';
import { useSettings } from '../game/settings';
import { EventEffects } from './vfx/EventEffects';
import { AimPreview, CoreTrail, LiftTethers, Reticles, SweepFields } from './vfx/FieldEffects';
import { ChargeBolts, ElementRegions, MagnetFields, WaterAndIce } from './vfx/ElementEffects';
import type { PlayerSlot } from '@ff/protocol';
import {
  LIGHT_VARIANTS,
  POST,
  QUALITY,
  SKY,
  type LightingVariant,
  type LightVariantName,
  type QualityTier,
} from './art-tokens';
import { fitBroadcastCamera } from './camera';
import { createSkyMaterial } from './shaders';
import { renderStats } from './render-stats';
import { installAtmosphericFog, SUN_DIR } from './atmosphere';
import { CloudSheets, DustMotes, LightShafts } from './storm';
import { ContactShadows } from './contact-shadows';
import { AdaptiveQuality, type TierName } from './adaptive-quality';
import { renders } from './bisect';

// Aerial-perspective fog for every material: must precede the first shader compile.
installAtmosphericFog();

export interface SceneProps {
  readonly quality?: QualityTier['name'];
  readonly side?: 1 | -1;
  readonly portraitSlot?: 0 | 1;
  /** Seats controlled on this device (aim previews / reticles). */
  readonly localSlots?: readonly PlayerSlot[];
  /** Fixed camera instead of the fitted broadcast view (Physics Lab close-ups). */
  readonly camera?: CameraOverride;
  /**
   * Where on-screen thumb controls sit, if any: the arena is framed into the rest of the screen
   * so controls never cover a goal (a side strip in landscape, a bottom band in portrait).
   */
  readonly controlsSide?: 'left' | 'right' | null;
  /** Lighting variant (D08 comparison captures); the selected lighting by default. */
  readonly light?: LightVariantName;
  /** Tier whose texture sizes the arena keeps when the quality adapts (no regeneration hitch). */
  readonly textureTier?: QualityTier['name'];
  /** Adapt the tier to the measured frame rate, starting at (and never above) `quality`. */
  readonly onAdapt?: (tier: TierName) => void;
  readonly children?: ReactNode;
}

export interface CameraOverride {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

/** The 3D arena canvas: lighting, atmosphere, arena, authoritative entities and post. */
export function GameScene({
  quality = 'high',
  side = 1,
  portraitSlot = 0,
  localSlots = [],
  camera,
  controlsSide = null,
  light = 'final',
  textureTier,
  onAdapt,
  children,
}: SceneProps) {
  const tier = QUALITY[quality];
  const textures = QUALITY[textureTier ?? quality];
  const variant: LightingVariant = LIGHT_VARIANTS[light];
  return (
    <Canvas
      shadows={tier.shadows ? { type: THREE.PCFSoftShadowMap } : false}
      dpr={[1, tier.dpr]}
      gl={{
        antialias: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
        stencil: false,
      }}
      camera={{ fov: 38, near: 1, far: 900, position: [0, 30, 30] }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.setClearColor('#050d16');
        view.element = gl.domElement;
      }}
    >
      <FrameDriver />
      <CameraRig
        side={side}
        portraitSlot={portraitSlot}
        override={camera}
        controlsSide={controlsSide}
      />
      <Atmosphere variant={variant} sky={tier.sky} />
      <Lights tier={tier} variant={variant} />
      {renders('arena') && (
        <Arena
          textureSize={textures.textureSize}
          tier={textures.name}
          gateLights={tier.pointLights >= 3}
          lowSurfaces={tier.name === 'low'}
        />
      )}
      {renders('clouds') && <CloudSheets count={tier.cloudLayers} />}
      {tier.shafts && renders('shafts') && <LightShafts />}
      {tier.dust > 0 && renders('dust') && <DustMotes count={tier.dust} />}
      {renders('contact') && <ContactShadows strength={tier.shadows ? 0.38 : 0.62} />}
      {renders('entities') && <Entities />}
      <Manipulators />
      {renders('vfx') && (
        <>
          <WaterAndIce />
          <CoreTrail />
          <SweepFields />
          <ElementRegions density={tier.particles} />
          <MagnetFields />
          <ChargeBolts />
          <LiftTethers />
        </>
      )}
      <AimPreview slots={localSlots} />
      <Reticles slots={localSlots} />
      {renders('vfx') && <EventEffects />}
      {children}
      <StatsProbe tier={tier.name} adaptive={!!onAdapt} />
      {onAdapt && <AdaptiveProbe start={textureTier ?? quality} onAdapt={onAdapt} />}
      {!renders('post') ? null : tier.bloom ? (
        <EffectComposer multisampling={0}>
          <Bloom
            luminanceThreshold={POST.bloomThreshold}
            intensity={POST.bloomIntensity}
            radius={POST.bloomRadius}
            mipmapBlur
          />
          <Vignette darkness={POST.vignette} offset={0.32} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={0}>
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  );
}

/** Screen space the thumb controls take (CSS px): one column + margins / cluster + element row. */
const CONTROLS_STRIP_PX = 196;
const CONTROLS_BAND_PX = 236;

function CameraRig({
  side,
  portraitSlot,
  override,
  controlsSide,
}: {
  side: 1 | -1;
  portraitSlot: 0 | 1;
  override?: CameraOverride | undefined;
  controlsSide: 'left' | 'right' | null;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const client = useGameClient();
  const reducedMotion = useSettings((s) => s.reducedMotion);
  const base = useRef(new THREE.Vector3());
  const shake = useRef(0);
  useEffect(() => {
    const w = Math.max(1, size.width);
    const h = Math.max(1, size.height);
    const aspect = w / h;
    const landscape = aspect >= 0.9;
    // Thumb controls: a side strip in landscape, a bottom band in portrait.
    const strip =
      controlsSide && landscape && !override ? Math.min(0.32, CONTROLS_STRIP_PX / w) : 0;
    const band = controlsSide && !landscape && !override ? Math.min(0.4, CONTROLS_BAND_PX / h) : 0;
    // Short landscape screens: reserve the band the bottom HUD panels occupy (~78 px).
    const hudBottom = aspect > 1.2 && h < 560 && !strip ? Math.min(0.22, 78 / h) : 0;
    // We size the frustum ourselves (the view offset below needs the full virtual width), so
    // R3F must not reset the aspect on resize.
    (camera as THREE.PerspectiveCamera & { manual?: boolean }).manual = true;
    // Fit the arena into the free part of the screen, then shift the image so it is centred
    // there: setViewOffset moves the projection without changing perspective, and raycasts
    // (aiming) use the same projection, so pointer → arena stays exact. The virtual image is
    // the screen grown by the reserved strip (landscape: width; portrait: height) so that its
    // centre falls in the middle of the free part.
    const shiftX = (strip * w) / 2;
    const shiftY = (band * h) / 2;
    const freeW = w - 2 * shiftX;
    const freeH = h - 2 * shiftY;
    if (override) {
      camera.fov = override.fov;
      camera.position.set(...override.position);
      camera.lookAt(...override.target);
    } else {
      const pose = fitBroadcastCamera(
        MERIDIAN_ARENA,
        freeW / freeH,
        side,
        portraitSlot,
        hudBottom,
        landscape ? 'landscape' : 'portrait',
      );
      // The fitted (vertical) field of view spans the free height; the virtual image is taller.
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(pose.fov / 2)) * ((h + 2 * shiftY) / freeH);
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanHalf));
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
    }
    const fullW = w + 2 * shiftX;
    const fullH = h + 2 * shiftY;
    camera.aspect = fullW / fullH;
    if (shiftX > 0 || shiftY > 0)
      camera.setViewOffset(
        fullW,
        fullH,
        controlsSide === 'right' ? 2 * shiftX : 0,
        2 * shiftY,
        w,
        h,
      );
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    base.current.copy(camera.position);
    view.camera = camera;
  }, [camera, size.width, size.height, side, portraitSlot, override, controlsSide]);
  useEffect(
    () =>
      client.events.on((e) => {
        if (e.type === 'goal') shake.current = Math.max(shake.current, 0.45);
        else if (e.type === 'impact' && e.impulse > 260)
          shake.current = Math.max(shake.current, 0.12);
      }),
    [client],
  );
  useFrame(({ clock }, dt) => {
    if (shake.current <= 0) return;
    shake.current = Math.max(0, shake.current - dt * 0.9);
    const amp = reducedMotion ? 0 : shake.current * shake.current;
    const t = clock.elapsedTime * 38;
    camera.position.set(
      base.current.x + Math.sin(t * 1.3) * amp,
      base.current.y + Math.sin(t * 1.7 + 1) * amp * 0.6,
      base.current.z + Math.sin(t * 0.9 + 2) * amp,
    );
    if (shake.current === 0) camera.position.copy(base.current);
  });
  return null;
}

function Atmosphere({ variant, sky: mode }: { variant: LightingVariant; sky: QualityTier['sky'] }) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const sky = useMemo(() => createSkyMaterial(mode === 'high' ? 'high' : 'low'), [mode]);
  useEffect(() => () => sky.dispose(), [sky]);
  // Baked sky: the storm rendered once into a cube map and shown as the background.
  useEffect(() => {
    if (mode !== 'baked' || !renders('sky')) return;
    const baked = bakeSky(gl, sky);
    scene.background = baked.texture;
    return () => {
      scene.background = null;
      baked.dispose();
    };
  }, [mode, gl, scene, sky]);
  useEffect(() => {
    scene.fog = !renders('fog') ? null : new THREE.FogExp2(SKY.horizon, variant.fogDensity);
    gl.toneMappingExposure = variant.exposure;
    return () => {
      scene.fog = null;
    };
  }, [scene, gl, variant]);
  // Image-based lighting: prefilter the storm sky (with the storm break where the key light is)
  // once, so metals reflect the sky and the break instead of rendering black.
  useEffect(() => {
    const env = buildStormEnvironment(gl);
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  useEffect(() => {
    scene.environmentIntensity = variant.environmentIntensity;
  }, [scene, variant]);
  useFrame((_, dt) => {
    (sky.uniforms.uTime as { value: number }).value += dt;
  });
  // Drawn after the opaque scene, at the far plane: covered pixels skip the sky's noise.
  if (!renders('sky') || mode === 'baked') return null;
  return (
    <mesh material={sky} frustumCulled={false} renderOrder={1000}>
      <sphereGeometry args={[600, 48, 24]} />
    </mesh>
  );
}

function Lights({ tier, variant }: { tier: QualityTier; variant: LightingVariant }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.target = target;
    // Constrained shadow area: the field, walls, pillars and gates seen from the raking key.
    const cam = l.shadow.camera;
    cam.left = -34;
    cam.right = 34;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 8;
    cam.far = 110;
    cam.updateProjectionMatrix();
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.035;
  }, [target]);
  return (
    <>
      <hemisphereLight args={[variant.hemiSky, variant.hemiGround, variant.hemiIntensity]} />
      <primitive object={target} position={[0, 0, 0]} />
      <directionalLight
        ref={key}
        position={[...variant.keyPosition]}
        color={variant.keyColor}
        intensity={variant.keyIntensity}
        castShadow={tier.shadows}
        shadow-mapSize-width={tier.shadowMapSize}
        shadow-mapSize-height={tier.shadowMapSize}
      />
      {variant.fillIntensity > 0 && (
        <directionalLight
          position={[...variant.fillPosition]}
          color={variant.fillColor}
          intensity={variant.fillIntensity}
        />
      )}
    </>
  );
}

/** Cube face size of the baked sky (half float: ~3 MB for all six faces). */
const SKY_BAKE_SIZE = 256;

/**
 * Renders the sky once into a cube map (the low tier's sky: a single texture read per pixel, where
 * the procedural storm costs several noise octaves per pixel — and a software rasteriser shades
 * the whole dome, covered or not).
 */
function bakeSky(gl: THREE.WebGLRenderer, material: THREE.Material): THREE.WebGLCubeRenderTarget {
  const target = new THREE.WebGLCubeRenderTarget(SKY_BAKE_SIZE, { type: THREE.HalfFloatType });
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material);
  scene.add(dome);
  new THREE.CubeCamera(1, 1000, target).update(gl, scene);
  dome.geometry.dispose();
  return target;
}

/**
 * Builds a prefiltered (PMREM) environment map from the storm sky plus emissive panels: the storm
 * break exactly where the key light is (so brass catches a warm rim), the overcast zenith and a
 * cool horizon on the fill side.
 */
function buildStormEnvironment(gl: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const skyMat = createSkyMaterial('low');
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat);
  envScene.add(dome);
  const panels: THREE.Mesh[] = [];
  const addPanel = (
    color: string,
    intensity: number,
    pos: THREE.Vector3,
    size: [number, number],
  ) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0], size[1]),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
        fog: false,
      }),
    );
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    envScene.add(m);
    panels.push(m);
  };
  addPanel(SKY.glow, 6, SUN_DIR.clone().multiplyScalar(32), [18, 9]); // storm break (key)
  addPanel('#7fb0d8', 1.4, new THREE.Vector3(0, 40, 0), [60, 60]); // overcast zenith
  addPanel('#3b6f93', 1.2, new THREE.Vector3(30, 6, 22), [34, 10]); // cool horizon (fill side)
  const pmrem = new THREE.PMREMGenerator(gl);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  dome.geometry.dispose();
  skyMat.dispose();
  for (const p of panels) {
    p.geometry.dispose();
    (p.material as THREE.Material).dispose();
  }
  return rt.texture;
}

/**
 * Feeds frame times to the adaptive-quality controller; reports a tier change (rare) upward.
 * The controller lives as long as its starting tier.
 */
function AdaptiveProbe({ start, onAdapt }: { start: TierName; onAdapt: (t: TierName) => void }) {
  const controller = useMemo(() => new AdaptiveQuality(start), [start]);
  useFrame((_, dt) => {
    const changed = controller.sample(dt * 1000, performance.now());
    if (changed) onAdapt(changed);
  });
  return null;
}

/** Publishes frame time and renderer counters for the dev HUD (no React updates per frame). */
function StatsProbe({ tier, adaptive }: { tier: TierName; adaptive: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    renderStats.tier = tier;
    renderStats.adaptive = adaptive;
  }, [tier, adaptive]);
  useEffect(() => {
    // The composer renders several passes per frame; count them all and reset once per frame.
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame((_, dt) => {
    // Runs before this frame renders: read the previous frame's totals, then reset the counters.
    renderStats.frameMs = renderStats.frameMs * 0.92 + dt * 1000 * 0.08;
    renderStats.drawCalls = gl.info.render.calls;
    renderStats.triangles = gl.info.render.triangles;
    renderStats.geometries = gl.info.memory.geometries;
    renderStats.textures = gl.info.memory.textures;
    renderStats.programs = gl.info.programs?.length ?? 0;
    gl.info.reset();
  }, -3);
  return null;
}
