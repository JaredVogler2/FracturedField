import * as THREE from 'three';

/**
 * The spectral arm (7D / D10: "a semi-transparent spectral arm extension may connect gesture input
 * to the remote in-world target"): a faint ribbon arcing from a wielder's acting hand to its
 * force point on the field, so each player can see which wielder is acting and roughly where.
 * Pure layout: a camera-facing ribbon along a quadratic Bézier lifted above the chord.
 */

/** Segments along each tether (two vertices per sample). */
export const TETHER_SEGMENTS = 28;
/** Ribbon width at the hand and at the field (m). */
const WIDTH_HAND = 0.14;
const WIDTH_FIELD = 0.09;
/** How high the arc rises above its chord's middle, per metre of chord, and at most (m). */
const LIFT_PER_M = 0.12;
const LIFT_MAX = 2.4;
/**
 * The arm is laid at least this wide on screen (render pixels): on a phone it is thinner than a
 * pixel across the arena and would break into dashes. The shader spreads its light to match.
 */
export const TETHER_MIN_PX = 2;

const ctrl = new THREE.Vector3();
const p = new THREE.Vector3();
const tangent = new THREE.Vector3();
const view = new THREE.Vector3();
const side = new THREE.Vector3();

/** The arc's point at `t` (0 the hand, 1 the field) into `out`. */
export function tetherPoint(
  start: THREE.Vector3,
  end: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  ctrl.addVectors(start, end).multiplyScalar(0.5);
  ctrl.y += Math.min(LIFT_MAX, start.distanceTo(end) * LIFT_PER_M);
  const u = 1 - t;
  return out
    .copy(start)
    .multiplyScalar(u * u)
    .addScaledVector(ctrl, 2 * u * t)
    .addScaledVector(end, t * t);
}

/**
 * Writes one tether's 2·(TETHER_SEGMENTS + 1) vertex positions into `pos`, starting at vertex
 * `first`: each sample of the arc spread across, square to the arc and to the line to `eye`.
 *
 * With `pixel` (the world size of one render pixel per metre from the eye), no sample is laid
 * narrower than TETHER_MIN_PX on screen, and `px` receives each vertex's true width in pixels.
 */
export function layTether(
  start: THREE.Vector3,
  end: THREE.Vector3,
  eye: THREE.Vector3,
  pos: Float32Array,
  first: number,
  pixel = 0,
  px?: Float32Array,
): void {
  ctrl.addVectors(start, end).multiplyScalar(0.5);
  ctrl.y += Math.min(LIFT_MAX, start.distanceTo(end) * LIFT_PER_M);
  for (let i = 0; i <= TETHER_SEGMENTS; i++) {
    const t = i / TETHER_SEGMENTS;
    const u = 1 - t;
    p.copy(start)
      .multiplyScalar(u * u)
      .addScaledVector(ctrl, 2 * u * t)
      .addScaledVector(end, t * t);
    tangent
      .subVectors(ctrl, start)
      .multiplyScalar(2 * u)
      .addScaledVector(view.subVectors(end, ctrl), 2 * t);
    view.subVectors(eye, p);
    side.crossVectors(tangent, view);
    if (!(side.lengthSq() > 1e-12)) side.set(1, 0, 0);
    let width = WIDTH_HAND + (WIDTH_FIELD - WIDTH_HAND) * t;
    if (pixel > 0) {
      const onePx = Math.max(1e-6, view.length() * pixel);
      if (px) px[first + i * 2] = px[first + i * 2 + 1] = width / onePx;
      width = Math.max(width, TETHER_MIN_PX * onePx);
    }
    side.normalize().multiplyScalar(width / 2);
    const k = (first + i * 2) * 3;
    pos[k] = p.x - side.x;
    pos[k + 1] = p.y - side.y;
    pos[k + 2] = p.z - side.z;
    pos[k + 3] = p.x + side.x;
    pos[k + 4] = p.y + side.y;
    pos[k + 5] = p.z + side.z;
  }
}
