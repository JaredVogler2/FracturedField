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
  /**
   * Force a framing. The caller fits into the free part of a screen (beside or above thumb
   * controls), whose aspect can differ from the screen's: a portrait phone keeps the portrait
   * framing even when the area above its controls is nearly square.
   */
  layout?: 'portrait' | 'landscape',
): CameraPose {
  const portrait = layout ? layout === 'portrait' : aspect < 0.9;
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
  const margin = {
    x: 0.95,
    yTop: 0.84,
    yBottom: Math.min(-0.5, -0.9 + hudBottom * 2),
  };
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

/** One slow cycle of the menu's cinematic camera (s). */
export const ATTRACT_PERIOD_S = 80;

/**
 * The menu's cinematic camera (attract mode): the first impression, composed instead of the
 * gameplay framing. It looks from the TIDE (+X) end down the length of the field toward the storm
 * break: the arena backlit, the EMBER gate and the rim columns dark against the bright sky, the
 * sky islands' towers in the haze beyond, long shadows reaching toward the viewer.
 *
 * - Landscape: a slow drift beyond the TIDE gate, a little to the near side, with the break in
 *   the upper right — the menu on the left covers the near wall and sky, not the action.
 * - Portrait: higher and straighter down the axis — the field recedes up the screen to the far
 *   gate and the break above it, clear of the menu docked at the bottom: a vertical composition,
 *   not a crop of the landscape one.
 *
 * The aim leans toward `focus` (the core), so the camera follows the play without chasing it.
 * Pure: a pose for a time; reduced motion holds t = 0.
 */
export function attractPose(
  t: number,
  aspect: number,
  focus?: { readonly x: number; readonly z: number },
  /** Written in place when given (the per-frame caller allocates nothing). */
  out: { position: THREE.Vector3; target: THREE.Vector3; fov: number } = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    fov: 0,
  },
): CameraPose {
  const phi = (2 * Math.PI * t) / ATTRACT_PERIOD_S;
  const fx = THREE.MathUtils.clamp(focus?.x ?? 0, -16, 16);
  const fz = THREE.MathUtils.clamp(focus?.z ?? 0, -9, 9);
  if (aspect < 0.9) {
    out.position.set(
      36 + 2 * Math.sin(phi),
      11 + 0.8 * Math.sin(2 * phi + 0.7),
      3 + 4 * Math.sin(phi),
    );
    // Pitched down ~22°: the far gate sits a third of the way up from the centre, the storm above.
    out.target.set(8 + 0.2 * fx, -0.5, -1 + 0.3 * fz);
    out.fov = 66;
    return out;
  }
  const z = 8 + 5 * Math.sin(phi);
  out.position.set(33 + 2 * Math.cos(phi), 9.5 + 0.8 * Math.sin(2 * phi + 0.7), z);
  // The aim pans with the dolly (half as far): the far gate and the centre stay framed.
  out.target.set(-8 + 0.3 * fx, 2.4, -2 + 0.5 * (z - 8) + 0.2 * fz);
  // Narrower screens need a wider lens.
  out.fov = 52 + 22 * (1.7 - Math.min(1.7, Math.max(0.9, aspect)));
  return out;
}
