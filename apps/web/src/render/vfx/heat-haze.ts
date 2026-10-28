import * as THREE from 'three';
import type { EffectSnapshot } from '@ff/protocol';

/**
 * Heat refraction above flames (7C / D09: "restrained heat refraction"), high tier only: a
 * screen-space shimmer in a plume rising from each authoritative flame. This module finds the
 * plumes; `HeatHaze.tsx` bends the frame with them. Cosmetic; it decides nothing.
 */

/** Plumes the shader takes at once (the strongest flames in view). */
export const MAX_HEAT_SOURCES = 4;
/** The plume's base above the flame's ground point, and its radius, as fractions of the flame's. */
const BASE_LIFT = 0.25;
const PLUME_RADIUS = 0.6;

const at = new THREE.Vector3();
const side = new THREE.Vector3();

/**
 * Writes one vec4 per plume into `out` (screen uv of its base, its radius in screen-height
 * units, its strength 0..1), the strongest first; unused slots get strength 0. A flame behind the
 * camera or far off screen draws no plume. Returns the number written.
 */
export function heatSources(
  effects: readonly EffectSnapshot[],
  camera: THREE.PerspectiveCamera,
  out: THREE.Vector4[],
): number {
  let n = 0;
  for (const v of out) v.set(0, 0, 0, 0);
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  for (const e of effects) {
    if (e.kind !== 'flame') continue;
    const strength = Math.min(1, Math.max(0, e.m ?? 1));
    if (strength <= 0) continue;
    at.set(e.p[0], e.p[1] + e.r * BASE_LIFT, e.p[2]);
    const dist = side.copy(at).sub(camera.position).length();
    at.project(camera);
    if (at.z < -1 || at.z > 1 || Math.abs(at.x) > 1.5 || Math.abs(at.y) > 1.5) continue;
    const radius = (e.r * PLUME_RADIUS) / Math.max(1e-3, dist * 2 * tanHalf);
    // Keep the strongest: insert in order, dropping the weakest past the last slot.
    let i = Math.min(n, out.length - 1);
    if (n === out.length && strength <= out[i]!.w) continue;
    while (i > 0 && out[i - 1]!.w < strength) {
      out[i]!.copy(out[i - 1]!);
      i--;
    }
    out[i]!.set(at.x * 0.5 + 0.5, at.y * 0.5 + 0.5, radius, strength);
    n = Math.min(out.length, n + 1);
  }
  return n;
}
