import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import { arenaStaticShapes } from '@ff/sim';
import { useRenderFrame } from './frame-context';

/**
 * Wireframe view of the exact collider set used by the authority (same `arenaStaticShapes` data
 * the physics world is built from) plus live dynamic body bounds from snapshots.
 */
export function SimDebugOverlay() {
  const shapes = useMemo(() => arenaStaticShapes(MERIDIAN_ARENA), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#7dffb2',
        wireframe: true,
        transparent: true,
        opacity: 0.55,
      }),
    [],
  );
  const dyn = useMemo(() => new THREE.MeshBasicMaterial({ color: '#ff5d8f', wireframe: true }), []);
  const frame = useRenderFrame();
  const group = useRef<THREE.Group>(null);
  const spheres = useRef<THREE.Mesh[]>([]);
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 8), []);

  useFrame(() => {
    const f = frame.current;
    const g = group.current;
    if (!f || !g) return;
    let i = 0;
    for (const e of f.entities.values()) {
      let m = spheres.current[i];
      if (!m) {
        m = new THREE.Mesh(sphereGeo, dyn);
        spheres.current[i] = m;
        g.add(m);
      }
      const r = e.kind === 'core' ? DEFAULT_RULES.core.radius : e.kind === 'guard' ? 1.7 : 0.75;
      m.visible = true;
      m.position.set(e.px, e.py, e.pz);
      m.scale.setScalar(r);
      i++;
    }
    for (; i < spheres.current.length; i++) spheres.current[i]!.visible = false;
  });

  return (
    <group>
      {shapes
        .filter((s) => s.role !== 'floor' && s.role !== 'ceiling')
        .map((s) => (
          <mesh
            key={s.id}
            position={[s.pos[0], s.pos[1], s.pos[2]]}
            rotation-y={s.yaw}
            material={material}
          >
            {s.kind === 'cuboid' ? (
              <boxGeometry args={[s.half[0] * 2, s.half[1] * 2, s.half[2] * 2]} />
            ) : (
              <cylinderGeometry args={[s.radius, s.radius, s.halfHeight * 2, 16]} />
            )}
          </mesh>
        ))}
      <group ref={group} />
    </group>
  );
}
