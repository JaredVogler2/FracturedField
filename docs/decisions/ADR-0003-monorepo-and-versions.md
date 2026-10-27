# ADR-0003 — Monorepo layout, tooling and pinned version matrix

- **Status:** Accepted (Phase 01, 2026-10-27)

## Decision

pnpm workspaces (single `pnpm-lock.yaml`), strict TypeScript consumed **as source** by every
workspace (`"exports": { ".": "./src/index.ts" }`) — Vite, Vitest, wrangler/esbuild and tsx all
compile TS directly, so there is no package build step to drift.

```
apps/web            Vite + React 19 + React Three Fiber client (Vercel static)
apps/room-worker    Cloudflare Worker router + RoomDurableObject + BenchDurableObject
packages/sim        Rapier GameWorld, match FSM, abilities, bot, harness (no DOM, no Node)
packages/protocol   wire types, valibot schemas, codecs, version checks
packages/room-core  transport-agnostic RoomAuthority, tickets, rate limits, fixed-rate loop
packages/controls   InputController contract + IntentEmitter (adapters land in Phases 02/05/06)
packages/game-data  rules, ability/material tables, arena layouts (all tuning lives here)
packages/ui         design tokens
packages/test-utils intent builders, deterministic network impairment model
```

`packages/room-core` is an addition to the D01 list: it keeps room/session logic out of the
Durable Object so the Node fallback (ADR-0001) is an adapter, not a rewrite.

Environment boundaries are enforced by tsconfig `lib`/`types`: `sim`, `protocol` and `game-data`
compile against `ES2023` only (no DOM, no Node); `room-core` against `ES2023 + WebWorker`
(WebCrypto, timers); the worker against `@cloudflare/workers-types`.

## Version matrix (pinned exactly)

| area | package | version | note |
|---|---|---|---|
| language | typescript | 6.0.3 | 7.x not yet supported by typescript-eslint (`<6.1.0`) |
| physics | @dimforge/rapier3d-compat / rapier3d | 0.21.0 | byte-identical WASM (ADR-0002) |
| render | three | 0.186.1 | postprocessing requires `<0.187` |
| render | @react-three/fiber | 9.8.2 | React `>=19 <19.4` |
| render | @react-three/postprocessing / postprocessing | 3.2.2 / 6.39.5 | |
| UI | react / react-dom | 19.3.1 | |
| state | zustand | 5.0.16 | |
| schema | valibot | 1.5.0 | tree-shakeable runtime validation |
| build | vite / @vitejs/plugin-react | 8.3.5 / 6.1.2 | |
| test | vitest | 5.0.5 | |
| test | @playwright/test | 1.63.0 | matches the pre-installed Chromium build |
| test | fast-check | 4.10.2 | property tests |
| lint | eslint / typescript-eslint | 10.13.0 / 8.72.1 | type-aware rules |
| server | wrangler / @cloudflare/workers-types | 4.153.0 / 5.20261026.1 | |
| runtime | Node | 22 (CI), `.nvmrc` | |

## Root commands

`pnpm dev`, `pnpm dev:worker`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`,
`pnpm test:e2e`, `pnpm test:worker`, `pnpm build`, `pnpm benchmark:sim`, `pnpm benchmark:worker`.
