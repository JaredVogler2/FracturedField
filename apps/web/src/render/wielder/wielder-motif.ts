import type { AdvancedAbilityId } from '@ff/game-data';
import { PALETTE } from '../art-tokens';
import type { WielderMove } from './wielder-anim';

/**
 * The loadout's motif on a wielder (7D / D10: "the chosen loadout controls small icon motif and
 * emitter particle shape"): each advanced move has a spark shape and a tint. Half of a wielder's
 * motes take each of its two picks' shapes and tints, so the energy about its hands says what it
 * can do; its gauntlet flare takes the shape and tint of the move it casts.
 */

/** Spark shapes, as the motes' shader draws them (see `Wielders.tsx`). */
export const SHAPE = { round: 0, snowflake: 1, spark: 2, bars: 3, ring: 4, diamond: 5 } as const;

export interface Motif {
  readonly shape: number;
  readonly tint: string;
}

export const MOTIF: Readonly<Record<AdvancedAbilityId, Motif>> = {
  freeze: { shape: SHAPE.snowflake, tint: PALETTE.icePale },
  charge: { shape: SHAPE.spark, tint: PALETTE.arc },
  magnetize: { shape: SHAPE.bars, tint: PALETTE.coldSilver },
  gravity: { shape: SHAPE.ring, tint: PALETTE.riftViolet },
  // Focus has no effect of its own on the field: a warm gold.
  focus: { shape: SHAPE.diamond, tint: '#ffd27a' },
};

/** The flare's motif for the move being cast: an advanced move's own, or none (round, the seat's colour). */
export function moveMotif(move: WielderMove | null): Motif | null {
  return move !== null && move in MOTIF ? MOTIF[move as AdvancedAbilityId] : null;
}

/** The motif of mote `m` of `count`: the first half the first pick's, the rest the second's. */
export function moteMotif(
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId],
  m: number,
  count: number,
): Motif {
  return MOTIF[loadout[m < count / 2 ? 0 : 1]];
}
