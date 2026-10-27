// Workerd-safe Rapier loader (see docs/decisions/ADR-0002-rapier-wasm-packaging.md).
//
// workerd forbids compiling WebAssembly from bytes at runtime, which is how
// @dimforge/rapier3d-compat initialises. wrangler.toml aliases that package to this module:
// wrangler bundles the raw .wasm (byte-identical to the compat build) as a precompiled
// WebAssembly.Module, we instantiate it with the wasm-bindgen glue, and re-export the same API.
import wasmModule from '@dimforge/rapier3d/rapier_wasm3d_bg.wasm';
import * as bg from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

export * from '@dimforge/rapier3d/rapier.js';

const instance = new WebAssembly.Instance(wasmModule, { './rapier_wasm3d_bg.js': bg });
bg.__wbg_set_wasm(instance.exports);

/** Already initialised at module load; kept for API parity with the compat package. */
export async function init() {}
