import * as RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier is the only physics engine in the project and is loaded exclusively by this package.
 *
 * Node, browsers and Vitest use the `-compat` build (WASM inlined as base64). The Cloudflare
 * Worker build aliases `@dimforge/rapier3d-compat` to a shim that instantiates the byte-identical
 * raw `.wasm` as a precompiled module, because workerd forbids compiling WASM from bytes.
 * See docs/decisions/ADR-0002-rapier-wasm-packaging.md.
 */
export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/** Initialise the physics WASM once per runtime. Safe to call repeatedly. */
export function initPhysics(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export function physicsVersion(): string {
  return RAPIER.version();
}

export { RAPIER };
