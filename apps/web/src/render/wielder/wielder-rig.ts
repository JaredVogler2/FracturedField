import type { TwoBoneLimb } from './wielder-ik';

/**
 * The wielders' proportions (7D / D10), in metres at scale 1, in a wielder's own frame: origin
 * between the feet on the plinth, +Y up, +Z forward (toward the field), +X to the wielder's left.
 * Shared by the animation (reach, shoulder height) and the body's geometry and skeleton.
 */
export const RIG = {
  /** Height of the pelvis (the hips bone) and of the hip joints below it. */
  hipY: 0.98,
  hipJointY: 0.92,
  /** Half the distance between the hip joints. */
  hipHalf: 0.1,
  /** Height of the spine joint (lower back), the chest joint and the neck base. */
  spineY: 1.12,
  chestY: 1.32,
  neckY: 1.53,
  /** The head's pivot and the crown. */
  headY: 1.63,
  crownY: 1.86,
  /** Shoulder joints: half their spread and height (at rest). */
  shoulderHalf: 0.21,
  shoulderY: 1.45,
  /** Ankle height above the sole. */
  ankleY: 0.08,
  arm: { upper: 0.3, lower: 0.27, minBend: 0.12, maxBend: 2.5 } satisfies TwoBoneLimb,
  /** Hip joint to knee to ankle: 0.92 → 0.47 → 0.08 m standing. */
  leg: { upper: 0.45, lower: 0.39, minBend: 0.04, maxBend: 2.2 } satisfies TwoBoneLimb,
  /** Palm length from the wrist (to the knuckles). */
  hand: 0.09,
} as const;

/** Full arm reach, shoulder to wrist, at its least bend. */
export const ARM_REACH = Math.sqrt(
  RIG.arm.upper ** 2 +
    RIG.arm.lower ** 2 +
    2 * RIG.arm.upper * RIG.arm.lower * Math.cos(RIG.arm.minBend),
);
