# PROMPT 01 — PROVE THE FOUNDATION BEFORE BUILDING EVERYTHING

## Mission
Create an actual maintainable TypeScript monorepo and PROVE that the intended simulation and multiplayer transport can operate in the targeted environments. Not a conceptual plan. Read global instructions first.

## Deliverables
1. Choose an npm workspaces or pnpm workspaces setup: apps/web Vite React/TypeScript; apps/room-worker Cloudflare Worker + Durable Object; packages/sim pure simulation with Rapier; packages/protocol with runtime validation and TypeScript types; packages/controls with normalized ActionIntent and adapters; packages/game-data for balance/config; packages/test-utils. Document choices and version matrix.
2. Bootstrapped install/build/typecheck/lint/test scripts, strict TS (no blanket any, no suppression), formatting, reusable environmental configs, lockfile, .gitignore, .env.example, appropriate sample deployment configs and README instructions. No secrets.
3. Architectural decision records under docs/decisions/, including why authority matters, why Vercel web + single-room Durable Object is default, how to migrate authoritative server if limits prove unacceptable.
4. Small runnable physics harness: initialize Rapier WASM, create world + dynamic sphere + static walls + trigger, apply fixed impulse, advance exactly 100 ticks; output deterministic positions, test collisions and goal crossing. Must be runnable in browser and Worker runtime, not Node only. Investigate Rollup/WASM bundling and initialization.
5. Worker spike: provide create/join endpoint and Durable Object WebSocket echo + session seat assign on two real WebSocket clients, across separate browser windows. A minimal fake room is allowed HERE only to test transport; must be replaced during phase 03.
6. Bench Worker memory/cpu at target 30Hz with at least 2 clients and representative 20 bodies / 20 regions for >=60 seconds; record how benchmark was run and actual p50/p95 tick cost, CPU/resource assumptions. No invented benchmarks. If not externally deployable, use local Wrangler and label it. Include explicit fallback architecture if sustained authoritative WASM physics is impossible on the selected plan.
7. Basic web app with 3D scene and dev diagnostic HUD showing sim tick, bodies, frame time and transport status. Make it attractive even in spike but do not spend phase budget on final polish.
8. Add CI workflows for typecheck, tests and build with attention to free minutes; use reasonably lightweight jobs.
9. Add integrity checks to refuse incompatible client/server protocol versions.

## Mechanical requirements
- Shared simulation package must be importable without DOM, window, document, canvas, WebGL or MediaPipe. No React in sim. Initialization async managed explicitly.
- Align physics timestep to game configuration, never real frame delta. Test against NaN states and clamp force.
- Clock abstraction and seeded random implementation; avoid Math.random in sim.
- Worker state must have room ID, TTL, player seat info, and ready state; persist only what must survive idle resets.
- Origin check for WebSocket upgrade plus strong join ticket separate from public invite code; avoid using Origin header as sole credential.
- Hibernation for idle rooms should be future-friendly; active ticking gameplay will keep object awake and cost money.

## Verification
Run local workspaces install, typecheck, lint, unit tests and build. Include a two WebSocket-client dev test, physics 100-tick golden output, and (if possible) local Wrangler simulation. Show measured CPU. Produce a written decision: YES workable / CONDITIONAL / NO for Durable Object simulation, based on evidence.

## Acceptance
G01; G02 as spike; partial G04. Phase 02 must not start without an executable shared simulation and web build. If a runtime incompatibility occurs, fix or implement the justified stateful Node alternative *before* claiming ready.
