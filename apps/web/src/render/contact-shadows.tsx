/**
 * Contact shadows (Phase 07B / D08): a soft dark disc on the floor under every dynamic body,
 * fading and widening as the body rises — the height cue that tells a player whether the core is
 * rolling, hovering or lifted, on every tier (on low, where there are no shadow maps, it is the
 * only grounding; with shadow maps it adds the ambient occlusion they lack). One instanced draw;
 * positions come from the interpolated render frame, nothing feeds back to the simulation.
 */
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import { useRenderFrame } from './frame-context';

const MAX = 48;
const RADIUS: Partial<Record<string, number>> = {
  core: DEFAULT_RULES.core.radius,
  boulder: 0.75,
  shard: DEFAULT_RULES.elements.fracture.shardRadius,
  lodestone: 0.55,
};

export function ContactShadows({ strength }: { strength: number }) {
  const frame = useRenderFrame();
  const ref = useRef<THREE.InstancedMesh>(null);
  const opacity = useMemo(() => new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1), []);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    g.setAttribute('aOpacity', opacity);
    return g;
  }, [opacity]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        vertexShader: /* glsl */ `
          attribute float aOpacity;
          varying vec2 vUv;
          varying float vOpacity;
          void main() {
            vUv = uv;
            vOpacity = aOpacity;
            gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying float vOpacity;
          void main() {
            float d = length(vUv - 0.5) * 2.0;
            float a = 1.0 - smoothstep(0.0, 1.0, d);
            gl_FragColor = vec4(0.0, 0.0, 0.0, a * a * vOpacity);
          }
        `,
      }),
    [],
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  const m = useMemo(() => new THREE.Matrix4(), []);
  const limitX = MERIDIAN_ARENA.halfLength + MERIDIAN_ARENA.goal.depth;
  const limitZ = MERIDIAN_ARENA.halfWidth;
  useFrame(() => {
    const mesh = ref.current;
    const f = frame.current;
    if (!mesh || !f) return;
    let n = 0;
    for (const e of f.entities.values()) {
      const r = RADIUS[e.kind];
      if (r === undefined || n >= MAX) continue;
      if (Math.abs(e.px) > limitX || Math.abs(e.pz) > limitZ) continue;
      const lift = Math.max(0, e.py - r);
      if (lift > 6) continue;
      const k = Math.min(1, lift / 4.5);
      const size = r * (2.3 + lift * 0.5);
      m.makeScale(size, 1, size).setPosition(e.px, 0.015, e.pz);
      mesh.setMatrixAt(n, m);
      opacity.setX(n, strength * (1 - k * k * (3 - 2 * k)));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    opacity.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, MAX]}
      frustumCulled={false}
      renderOrder={1}
    />
  );
}
