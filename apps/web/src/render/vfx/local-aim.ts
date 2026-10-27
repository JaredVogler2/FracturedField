import type { PlayerSlot } from '@ff/protocol';

/**
 * Locally predicted reticles for seats controlled on this device (cosmetic only). Written by the
 * InputManager each frame, read by the renderer; never sent anywhere except as normalized aim.
 */
export const localAim = new Map<PlayerSlot, { x: number; z: number }>();
