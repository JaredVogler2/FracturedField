import * as THREE from 'three';

/**
 * The Rift Core trail's path (7C / D09), newest first: points[0] is the core itself and the rest
 * lie `step` apart along the path it actually took, however far it went in one frame. So the
 * trail is as long at 30 fps as at 120, and a slow core leaves one as surely as a fast one.
 */
export interface TrailPath {
  readonly points: THREE.Vector3[];
  /** Valid points: the core and the samples behind it (0 before the first frame). */
  count: number;
}

export function newTrailPath(n: number): TrailPath {
  return { points: Array.from({ length: n }, () => new THREE.Vector3()), count: 0 };
}

/** Starts the path over at `p`: the core and one sample, both there. */
export function restartTrail(path: TrailPath, p: THREE.Vector3): void {
  for (const v of path.points) v.copy(p);
  path.count = 2;
}

const lay = new THREE.Vector3();

/**
 * Moves the head to the core at `p`. A jump longer than `teleport` (the kickoff reset) starts the
 * path over there; otherwise each `step` the core has come since the newest sample lays another,
 * on the straight line between them.
 */
export function advanceTrail(
  path: TrailPath,
  p: THREE.Vector3,
  step: number,
  teleport: number,
): void {
  const h = path.points;
  if (path.count === 0 || h[0]!.distanceTo(p) > teleport) {
    restartTrail(path, p);
    return;
  }
  let d = h[1]!.distanceTo(p);
  for (let laid = 0; d >= step && laid < h.length - 1; laid++) {
    lay.copy(h[1]!).lerp(p, step / d);
    for (let i = h.length - 1; i > 1; i--) h[i]!.copy(h[i - 1]!);
    h[1]!.copy(lay);
    path.count = Math.min(h.length, path.count + 1);
    d -= step;
  }
  h[0]!.copy(p);
}
