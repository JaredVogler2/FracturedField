import { DEFAULT_RULES, MERIDIAN_ARENA } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { initPhysics, physicsVersion } from './rapier.js';
import { PhysicsWorld } from './physics.js';
import { detectGoalCrossing } from './goal.js';
import { StateHasher } from './hash.js';

export const HARNESS_TICKS = 100;

export interface HarnessResult {
  readonly rapier: string;
  readonly ticks: number;
  /** Final core state, rounded to 1e-6 so the JSON is stable to print. */
  readonly core: { readonly p: readonly number[]; readonly v: readonly number[] };
  readonly impactCount: number;
  readonly firstImpacts: readonly { tick: number; b: number; impulse: number }[];
  readonly goal: { readonly scorer: PlayerSlot; readonly tick: number } | null;
  readonly hash: string;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Phase 01 feasibility harness: real arena colliders + dynamic sphere + goal trigger test, one
 * fixed impulse, exactly HARNESS_TICKS fixed steps. Runs unchanged in Node, the browser and the
 * Cloudflare Worker runtime; all three must produce the same golden JSON.
 */
export async function runPhysicsHarness(): Promise<HarnessResult> {
  await initPhysics();
  const rules = DEFAULT_RULES;
  const world = new PhysicsWorld(rules, MERIDIAN_ARENA);
  try {
    const coreId = world.createCore(rules.core, 6.1, rules.core.radius, 5.0);
    const body = world.body(coreId);
    if (!body) throw new Error('core missing');
    // Bank shot: off the south side wall and into the +X goal mouth.
    body.applyImpulse({ x: 92, y: 0, z: 118 }, true);

    let prev = { ...body.translation() };
    let impactCount = 0;
    const firstImpacts: { tick: number; b: number; impulse: number }[] = [];
    let goal: HarnessResult['goal'] = null;
    const hasher = new StateHasher();
    for (let tick = 0; tick < HARNESS_TICKS; tick++) {
      const { impacts } = world.step();
      for (const imp of impacts) {
        impactCount++;
        if (firstImpacts.length < 4)
          firstImpacts.push({ tick, b: imp.b, impulse: r6(imp.impulse) });
      }
      const t = body.translation();
      if (!goal) {
        const scorer = detectGoalCrossing(prev, t, MERIDIAN_ARENA, rules.core);
        if (scorer !== null) goal = { scorer, tick };
      }
      prev = { x: t.x, y: t.y, z: t.z };
      hasher.num(t.x).num(t.y).num(t.z);
    }
    const t = body.translation();
    const v = body.linvel();
    return {
      rapier: physicsVersion(),
      ticks: HARNESS_TICKS,
      core: { p: [r6(t.x), r6(t.y), r6(t.z)], v: [r6(v.x), r6(v.y), r6(v.z)] },
      impactCount,
      firstImpacts,
      goal,
      hash: hasher.digest(),
    };
  } finally {
    world.dispose();
  }
}
