# ADR-0002 — Rapier WASM packaging across Node, browsers and workerd

- **Status:** Accepted (Phase 01, 2026-10-27)

## Context

The shared simulation must run unchanged in Node (tests/benchmarks), browsers (local and practice
play) and the Cloudflare Worker runtime (authority). Rapier ships two npm builds of the same version:

| package | WASM delivery | works in |
|---|---|---|
| `@dimforge/rapier3d-compat@0.21.0` | base64 inlined in JS; `init()` calls `WebAssembly.instantiate(bytes)` | Node, browsers, Vitest |
| `@dimforge/rapier3d@0.21.0` | separate `.wasm` + wasm-bindgen ESM-integration import | bundlers with WASM-module support |

workerd forbids compiling WebAssembly from bytes at runtime ("code generation disallowed"), so the
compat `init()` cannot run in a Worker.

## Evidence

- The WASM inside the compat package and the raw `rapier_wasm3d_bg.wasm` are **byte-identical**
  (3,082,103 bytes, sha256 prefix `17cfa80eebd8de02`), with the same import namespace
  (`./rapier_wasm3d_bg.js`, 29 imports).
- A probe Worker and later the real room Worker produced exactly the Node results
  (`worker == node golden: true`, see docs/progress/PHASE-01.md).

## Decision

- `packages/sim` imports `@dimforge/rapier3d-compat` everywhere (one code path, one type surface).
- `apps/room-worker/wrangler.toml` aliases `@dimforge/rapier3d-compat` to
  `apps/room-worker/src/rapier-shim.js`, which:
  1. imports `@dimforge/rapier3d/rapier_wasm3d_bg.wasm` — wrangler bundles it as a precompiled
     `WebAssembly.Module` (allowed);
  2. instantiates it with the wasm-bindgen glue module as the import object;
  3. calls `__wbg_set_wasm(instance.exports)` and re-exports the high-level API with a no-op `init()`.
- The shim is plain JS (6 statements) because the package's `.wasm.d.ts` describes named exports,
  not the default `WebAssembly.Module` import wrangler produces; it is linted, and covered by the
  live Worker tests.

## Consequences

- Worker bundle: 3.8 MB upload (1.28 MB gzip) — 808 KB JS + the 3.08 MB `.wasm`, no base64 copy.
- Browser bundle currently uses the compat build: a 4.37 MB lazy chunk (1.68 MB gzip). Phase 11
  should switch the browser to the raw `.wasm` (`?url` + streaming instantiation, ~1.17 MB gzip)
  with the same shim pattern, and move local simulation into a Web Worker.
- Determinism guarantee is "same runtime + same version"; cross-runtime equality was additionally
  observed for the harness but is not relied upon (server authority + interpolation).
- Upgrading Rapier requires re-running the harness in all three runtimes and regenerating
  `packages/sim/test/golden/harness-100.json` deliberately (bump `SIM_VERSION`).
