import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import { detectGoalCrossing, scoringPlaneX } from '../src/index.js';

const core = DEFAULT_RULES.core;
const arena = MERIDIAN_ARENA;
const plane = scoringPlaneX(arena, core);
const y = core.hoverHeight;

describe('goal crossing (S09)', () => {
  it('scores for slot 0 when the core crosses the +X plane inward inside the mouth', () => {
    expect(
      detectGoalCrossing({ x: plane - 0.2, y, z: 0 }, { x: plane + 0.1, y, z: 0 }, arena, core),
    ).toBe(0);
  });

  it('scores for slot 1 at the -X goal', () => {
    expect(
      detectGoalCrossing({ x: -plane + 0.2, y, z: 1 }, { x: -plane - 0.1, y, z: 1 }, arena, core),
    ).toBe(1);
  });

  it('does not score on partial overlap of the goal line', () => {
    const line = arena.halfLength;
    expect(
      detectGoalCrossing({ x: line - 0.5, y, z: 0 }, { x: line + 0.3, y, z: 0 }, arena, core),
    ).toBeNull();
  });

  it('does not score when moving outward through the plane (wrong direction)', () => {
    expect(
      detectGoalCrossing({ x: plane + 0.3, y, z: 0 }, { x: plane - 0.3, y, z: 0 }, arena, core),
    ).toBeNull();
  });

  it('does not score while resting inside the cavity', () => {
    expect(
      detectGoalCrossing({ x: plane + 0.5, y, z: 0 }, { x: plane + 0.6, y, z: 0 }, arena, core),
    ).toBeNull();
  });

  it('does not score outside the mouth width or above the crossbar', () => {
    const wide = arena.goal.mouthHalfWidth + 0.1;
    expect(
      detectGoalCrossing(
        { x: plane - 0.2, y, z: wide },
        { x: plane + 0.1, y, z: wide },
        arena,
        core,
      ),
    ).toBeNull();
    const high = arena.goal.mouthHeight + 0.1;
    expect(
      detectGoalCrossing(
        { x: plane - 0.2, y: high, z: 0 },
        { x: plane + 0.1, y: high, z: 0 },
        arena,
        core,
      ),
    ).toBeNull();
  });

  it('catches a very fast crossing between two ticks', () => {
    expect(
      detectGoalCrossing({ x: plane - 0.9, y, z: 0 }, { x: plane + 0.05, y, z: 0 }, arena, core),
    ).toBe(0);
  });
});
