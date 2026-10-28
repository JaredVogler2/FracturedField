import type { HandState, PlayerSlot } from '@ff/protocol';

/**
 * Locally predicted reticles for seats controlled on this device (cosmetic only). Written by the
 * InputManager each frame, read by the renderer; never sent anywhere except as normalized aim.
 */
export const localAim = new Map<PlayerSlot, { x: number; z: number }>();

/**
 * The hand each hands-on local seat describes right now (ADR-0009): the reticle shows it (a
 * closing hand tightens it, a push widens it). Cosmetic, like the reticle itself.
 */
export const localHand = new Map<PlayerSlot, HandState>();
