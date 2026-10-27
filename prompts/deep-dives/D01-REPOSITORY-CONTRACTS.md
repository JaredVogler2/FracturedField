# DEEP DIVE D01 — REPOSITORY, CORE CONTRACTS, PHYSICS/WORKER PROOF

**Execute during Phase 01.** Deliver runnable tested source, not proposals. Inputs: game design + architecture docs.

## Exact work packages
1. Create workspace tree with apps/web, apps/room-worker; packages/sim, protocol, controls, game-data, ui, test-utils. Use a single lockfile, strict TS, Vitest and Playwright, ESLint, Prettier or equivalent; root commands dev, dev:worker, test, test:e2e, typecheck, lint, build, benchmark:sim.
2. Define shared types: Vec2, Vec3, EntityId, PlayerSlot, AbilityId, InputSource, ActionIntent, GameEvent, WorldSnapshot, RoomLifecycle, GameRules, PlayerResources. Runtime validation for wire messages; all numeric fields finite and capped; no direct physics classes serialized.
3. Physics package API: await createWorld(seed, rules), applyCommand(player, intent), stepFixed(), snapshot(), restore(snapshot) if viable (or periodic command-log replay documented), dispose(). Rapier loaded only in sim package, no DOM dependency. Use spawn/despawn safe handles and id map.
4. Configure authoritatively replicated core entity plus 2 world players + goal sensors, collision groups, low fixed body budget. Use /sim-debug as a rendered visual view of same physics package, not independent physics.
5. Test Worker compatibility: from Worker runtime initialize Rapier WASM; if import errors, try compatible package supported by current bundler; record bundle increase; prevent choosing an architecture without proven WASM import.
6. Create two-client WebSocket echo+seat handshake in Cloudflare Durable Object. Explicitly verify actual network WSS messages, unique seats, room isolation, third seat rejection. Simulated authority for phase 01 only, no fake multiplayer accepted afterward.
7. Benchmark a representative 30Hz sim with ~20 bodies and zones in the Worker environment and record mean/p95 tick, memory approximations and actual platform limits; an offline Node benchmark alone is not Worker proof.
8. Compose cross-workspace dev script and top-level test script; configure client/worker protocol version consistency test.
9. Add Architecture Decision Record for stateful room ownership, exact reason to avoid multi-Function in-memory room on Vercel, and rollback path to persistent Node server.

## Deliverable artifacts
- apps/web/src/app shell + test route; apps/room-worker/src/room.ts; packages/sim/src/world.ts; packages/protocol/src/messages.ts; packages/controls/src/types.ts; data configs; .env.example; .github/workflows/check.yml; docs/decisions/ADR-0001.md; docs/progress.
- Test files for seed reproducibility, NaN rejection, auth ticket handling and protocol mismatch.
- Example commands **actually run** with exact shell and results; record if Cloudflare credentials unavailable.

## Gate
Shared Rapier code must genuinely run in both browser and intended server runtime, with no CPU overload. A test sketch that imports successfully but never steps a world is NOT sufficient.
