import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { MERIDIAN_ARENA } from '@ff/game-data';
import { Arena } from './Arena';
import { Entities, Manipulators } from './Entities';
import { FrameDriver } from './frame-context';
import { LIGHTING, POST, QUALITY, type QualityTier } from './art-tokens';
import { fitBroadcastCamera } from './camera';
import { createSkyMaterial } from './shaders';
import { useDisposable } from './hooks';
import { renderStats } from './render-stats';

export interface SceneProps {
  readonly quality?: QualityTier['name'];
  readonly side?: 1 | -1;
  readonly portraitSlot?: 0 | 1;
  readonly children?: ReactNode;
}

/** The 3D arena canvas: lighting, atmosphere, arena, authoritative entities and post. */
export function GameScene({ quality = 'high', side = 1, portraitSlot = 0, children }: SceneProps) {
  const tier = QUALITY[quality];
  return (
    <Canvas
      shadows={tier.shadows ? { type: THREE.PCFSoftShadowMap } : false}
      dpr={[1, tier.dpr]}
      gl={{
        antialias: !tier.bloom,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
        stencil: false,
      }}
      camera={{ fov: 38, near: 1, far: 900, position: [0, 30, 30] }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.setClearColor('#050d16');
      }}
    >
      <FrameDriver />
      <CameraRig side={side} portraitSlot={portraitSlot} />
      <Atmosphere />
      <Lights tier={tier} />
      <Arena textureSize={tier.textureSize} />
      <Entities />
      <Manipulators />
      {children}
      <StatsProbe />
      {tier.bloom ? (
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

function CameraRig({ side, portraitSlot }: { side: 1 | -1; portraitSlot: 0 | 1 }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const pose = fitBroadcastCamera(MERIDIAN_ARENA, aspect, side, portraitSlot);
    camera.fov = pose.fov;
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, side, portraitSlot]);
  return null;
}

function Atmosphere() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const sky = useDisposable(() => createSkyMaterial(), []);
  useEffect(() => {
    scene.fog = new THREE.FogExp2(LIGHTING.fogColor, LIGHTING.fogDensity);
    return () => {
      scene.fog = null;
    };
  }, [scene]);
  // Image-based lighting: prefilter a procedural storm environment once so metals reflect sky
  // and storm-break highlights instead of rendering black.
  useEffect(() => {
    const env = buildStormEnvironment(gl);
    scene.environment = env;
    scene.environmentIntensity = LIGHTING.environmentIntensity;
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  useFrame((_, dt) => {
    (sky.uniforms.uTime as { value: number }).value += dt;
  });
  return (
    <mesh material={sky} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[600, 48, 24]} />
    </mesh>
  );
}

function Lights({ tier }: { tier: QualityTier }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useEffect(() => {
    const l = key.current;
    if (!l) return;
    l.target = target;
    const cam = l.shadow.camera;
    cam.left = -30;
    cam.right = 30;
    cam.top = 22;
    cam.bottom = -22;
    cam.near = 5;
    cam.far = 90;
    cam.updateProjectionMatrix();
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.03;
  }, [target]);
  return (
    <>
      <hemisphereLight args={[LIGHTING.hemiSky, LIGHTING.hemiGround, LIGHTING.hemiIntensity]} />
      <primitive object={target} position={[0, 0, 0]} />
      <directionalLight
        ref={key}
        position={[...LIGHTING.keyPosition]}
        color={LIGHTING.keyColor}
        intensity={LIGHTING.keyIntensity}
        castShadow={tier.shadows}
        shadow-mapSize-width={tier.shadowMapSize}
        shadow-mapSize-height={tier.shadowMapSize}
      />
      <directionalLight
        position={[...LIGHTING.fillPosition]}
        color={LIGHTING.fillColor}
        intensity={LIGHTING.fillIntensity}
      />
    </>
  );
}

/** Builds a prefiltered (PMREM) environment map from the storm sky plus emissive break panels. */
function buildStormEnvironment(gl: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const skyMat = createSkyMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat);
  envScene.add(dome);
  const panels: THREE.Mesh[] = [];
  const addPanel = (
    color: string,
    intensity: number,
    pos: [number, number, number],
    size: [number, number],
  ) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0], size[1]),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    envScene.add(m);
    panels.push(m);
  };
  addPanel('#ffd9a8', 6, [-18, 26, 20], [16, 9]); // storm break (key)
  addPanel('#7fb8e6', 1.6, [0, 40, 0], [60, 60]); // overcast zenith
  addPanel('#3b6f93', 1.2, [30, 8, -20], [30, 10]); // cool horizon fill
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

/** Publishes frame time and renderer counters for the dev HUD (no React updates per frame). */
function StatsProbe() {
  const gl = useThree((s) => s.gl);
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
    gl.info.reset();
  }, -3);
  return null;
}
