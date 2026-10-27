export * from './rules.js';
export * from './abilities.js';
export * from './materials.js';
export * from './arena.js';

/**
 * Bump whenever simulation behaviour or tuning that affects outcomes changes. Clients and
 * servers exchange this in HELLO/WELCOME so mismatched builds refuse to play together.
 */
export const SIM_VERSION = 1;
