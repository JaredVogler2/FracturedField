import type { ArenaLayout, CoreRules } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Authoritative goal test, evaluated once per fixed tick on the core centre.
 *
 * A goal requires the centre to CROSS the scoring plane (goal line + penetration × radius) in the
 * inward direction during this tick, while inside the mouth. Resting inside the cavity, partial
 * overlap of the line, or moving outward never scores. The cavity is closed on every other side,
 * so the core cannot enter it from behind.
 *
 * The goal at +X is defended by slot 1, so crossing it scores for slot 0 (and vice versa).
 */
export function detectGoalCrossing(
  prev: Point3,
  curr: Point3,
  arena: ArenaLayout,
  core: CoreRules,
): PlayerSlot | null {
  const plane = arena.halfLength + core.goalPenetration * core.radius;
  const g = arena.goal;
  const inMouth = Math.abs(curr.z) < g.mouthHalfWidth && curr.y < g.mouthHeight;
  if (!inMouth) return null;
  if (prev.x < plane && curr.x >= plane) return 0;
  if (prev.x > -plane && curr.x <= -plane) return 1;
  return null;
}

/** Signed distance of the core centre past the scoring plane toward the given goal end (+1 / -1). */
export function scoringPlaneX(arena: ArenaLayout, core: CoreRules): number {
  return arena.halfLength + core.goalPenetration * core.radius;
}
