import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { view } from '../render/view';

/**
 * Screen-space aim ([-1, 1]², x right, y up) → a point on the seat's legal half of the arena, using
 * the current camera's ground axes so "right" and "up" match what the player sees (including the
 * mirrored view of seat 1). The seat clamps it to the legal region like every other input. Shared
 * by every adapter whose aim is relative rather than a point on the screen (camera, motion).
 */
export function screenAimToArena(
  slot: PlayerSlot,
  sx: number,
  sy: number,
): { x: number; z: number } {
  const m = DEFAULT_RULES.manipulator;
  const L = MERIDIAN_ARENA.halfLength - m.wallMargin;
  const W = MERIDIAN_ARENA.halfWidth - m.wallMargin;
  const minX = slot === 0 ? -L : -m.midlineReach;
  const maxX = slot === 0 ? m.midlineReach : L;
  const cx = (minX + maxX) / 2;
  const hx = (maxX - minX) / 2;
  const { right, up } = view.groundAxes();
  const er = hx * Math.abs(right.x) + W * Math.abs(right.z);
  const eu = hx * Math.abs(up.x) + W * Math.abs(up.z);
  return {
    x: cx + right.x * sx * er + up.x * sy * eu,
    z: right.z * sx * er + up.z * sy * eu,
  };
}
