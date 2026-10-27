import * as THREE from 'three';
import type { ArenaLayout } from '@ff/game-data';

export interface CameraPose {
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  readonly fov: number;
}

/**
 * Broadcast framing: an elevated three-quarter view that keeps BOTH goals and the whole floor in
 * frame for any aspect ratio. Landscape views the arena from the side (scoring axis horizontal);
 * portrait views it from behind the local player's goal (scoring axis vertical). `side` mirrors the
 * view so each online player defends the near/left goal.
 */
export function fitBroadcastCamera(
  arena: ArenaLayout,
  aspect: number,
  side: 1 | -1 = 1,
  portraitSlot: 0 | 1 = 0,
  /** Fraction of the viewport height reserved at the bottom for HUD panels (0..0.4). */
  hudBottom = 0,
): CameraPose {
  const portrait = aspect < 0.9;
  const fov = portrait ? 52 : 38;
  const pitch = THREE.MathUtils.degToRad(portrait ? 54 : 49);
  const L = arena.halfLength;
  const W = arena.halfWidth;
  // Points that must remain visible: floor corners, goal mouths and arch tops.
  const pts: THREE.Vector3[] = [];
  for (const x of [-L - 1.5, L + 1.5])
    for (const z of [-W - 0.8, W + 0.8]) pts.push(new THREE.Vector3(x, 0, z));
  for (const x of [-L, L]) {
    pts.push(new THREE.Vector3(x, arena.goal.mouthHeight + 0.6, 0));
    pts.push(
      new THREE.Vector3(x, 0, -arena.goal.mouthHalfWidth),
      new THREE.Vector3(x, 0, arena.goal.mouthHalfWidth),
    );
  }
  // View direction: from camera toward target.
  const dir = new THREE.Vector3();
  if (portrait) {
    const s = portraitSlot === 0 ? 1 : -1; // look from behind own goal toward the enemy goal
    dir.set(s * Math.cos(pitch), -Math.sin(pitch), 0);
  } else {
    dir.set(0, -Math.sin(pitch), -side * Math.cos(pitch));
  }
  const target = new THREE.Vector3(0, 0, portrait ? 0 : side * 1.2);
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.5, 1200);
  // NDC bounds the arena must fit inside; the bottom edge rises to keep clear of HUD panels.
  const margin = { x: 0.95, yTop: 0.84, yBottom: Math.min(-0.5, -0.9 + hudBottom * 2) };
  const fits = (d: number): boolean => {
    cam.position.copy(target).addScaledVector(dir, -d);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const v = new THREE.Vector3();
    for (const p of pts) {
      v.copy(p).project(cam);
      if (v.z > 1 || Math.abs(v.x) > margin.x || v.y > margin.yTop || v.y < margin.yBottom)
        return false;
    }
    return true;
  };
  let lo = 8;
  let hi = 260;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const position = target.clone().addScaledVector(dir, -hi);
  return { position, target, fov };
}
