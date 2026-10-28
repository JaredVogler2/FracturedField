import * as THREE from 'three';

/**
 * Motes of energy about a wielder's hands (7D / D10: "idle hovering energy", "ambient particles,
 * energy attachments"): a few sparks orbiting between the hands at rest and gathering at the
 * acting hand as it reaches. Pure layout: camera-facing quads, written into the spectral arms'
 * mesh so the arms and the motes of both wielders are one draw call.
 */

/** Motes per wielder (four vertices each). */
export const MOTES = 10;

const GOLDEN = 2.399963;
const fract = (x: number) => x - Math.floor(x);
const p = new THREE.Vector3();

/**
 * Writes one wielder's MOTES quads into `pos` (4 vertices each, from vertex `first`) and their
 * brightness into `glow` (per vertex): orbits within `spread` (m) of `centre` at time `t`,
 * each `size` (m) across, square to the camera's `right` and `up`, `bright` 0..1 overall.
 */
export function layMotes(
  centre: THREE.Vector3,
  spread: number,
  size: number,
  bright: number,
  t: number,
  right: THREE.Vector3,
  up: THREE.Vector3,
  pos: Float32Array,
  glow: Float32Array,
  first: number,
): void {
  for (let k = 0; k < MOTES; k++) {
    const phase = k * GOLDEN;
    const a = phase + (1.4 + 0.8 * fract(k * 0.618)) * t;
    const r = spread * (0.55 + 0.45 * fract(k * 0.381 + 0.2));
    // An ellipse about the centre with a slow bob (at most 0.985 r from it).
    p.set(Math.cos(a) * r * 0.9, Math.sin(a * 1.7 + phase) * r * 0.4, Math.sin(a) * r * 0.9).add(
      centre,
    );
    const s = (size / 2) * (0.7 + 0.6 * fract(k * 0.27));
    const g = bright * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * (5 + k) + phase * 3)));
    for (let c = 0; c < 4; c++) {
      const sx = c & 1 ? 1 : -1;
      const sy = c & 2 ? 1 : -1;
      const v = first + k * 4 + c;
      pos[v * 3] = p.x + (right.x * sx + up.x * sy) * s;
      pos[v * 3 + 1] = p.y + (right.y * sx + up.y * sy) * s;
      pos[v * 3 + 2] = p.z + (right.z * sx + up.z * sy) * s;
      glow[v] = g;
    }
  }
}

/** Each mote corner's quad coordinates (−1..1 across and up), in layMotes' vertex order. */
export function moteCorner(c: number): [number, number] {
  return [c & 1 ? 1 : -1, c & 2 ? 1 : -1];
}
