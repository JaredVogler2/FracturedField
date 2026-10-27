/**
 * Hands Lab markers in the arena (06M-M3): the ring to set the core down in, and the lane the
 * boulder must leave — flat, glowing lines on the floor that never collide with anything.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { HANDS_TASKS } from './hands-tasks';
import { useLabTask } from './lab-store';

const COLOR = '#7fe6ff';

export function LabMarkers() {
  const id = useLabTask();
  const task = HANDS_TASKS.find((t) => t.id === id) ?? null;
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLOR).multiplyScalar(2.2),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  if (!task) return null;
  return (
    <group>
      {task.ring ? (
        <mesh
          position={[task.ring.x, 0.03, task.ring.z]}
          rotation-x={-Math.PI / 2}
          material={material}
          renderOrder={5}
        >
          <ringGeometry args={[task.ring.r - 0.12, task.ring.r, 64]} />
        </mesh>
      ) : null}
      {task.lane
        ? ([-1, 1] as const).map((side) => (
            <mesh
              key={side}
              position={[(task.lane!.x0 + task.lane!.x1) / 2, 0.03, side * task.lane!.halfWidth]}
              rotation-x={-Math.PI / 2}
              material={material}
              renderOrder={5}
            >
              <planeGeometry args={[task.lane!.x1 - task.lane!.x0, 0.12]} />
            </mesh>
          ))
        : null}
    </group>
  );
}
