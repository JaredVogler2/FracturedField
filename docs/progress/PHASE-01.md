# PHASE 01 — Architecture spike & repository contracts (with D01)

**Status: COMPLETE** (all Phase 01 / D01 gates executed locally; cloud deployment is explicitly out of
scope until Phase 12 and is NOT claimed).

## Objective

Create the real TypeScript monorepo and prove — with executed evidence — that one shared Rapier
simulation runs in Node, the browser AND the Cloudflare Worker / Durable Object runtime, that the
room transport works with two real WebSocket clients, and that 30 Hz authority fits the platform.

## Implementation summary

| Deliverable (prompt 01 / D01) | Where | Result |
|---|---|---|
| pnpm monorepo, strict TS, ESLint (type-aware), Prettier, Vitest, Playwright, single lockfile | root, `tsconfig.base.json`, `eslint.config.js` | done |
| Shared contracts: Vec2/3, EntityId, PlayerSlot, AbilityId, InputSource, ActionIntent, GameEvent, WorldSnapshot, RoomPhase, rules, resources | `packages/protocol`, `packages/game-data` | done, runtime-validated with valibot |
| Physics API `createWorld/applyCommand/stepFixed/snapshot/checkpoint/restore/dispose` | `packages/sim/src/game.ts` | done; restore proven bit-identical |
| Seeded PRNG, clock-free sim, NaN clamps, speed/field caps | `packages/sim` | done, tested |
| 100-tick physics harness (sphere + real walls + goal trigger + impulse) | `packages/sim/src/harness.ts` | identical golden output in Node, Chromium and workerd |
| Worker: create/join endpoints, Durable Object WebSocket seat handshake, room isolation, third-seat rejection, origin check, HMAC tickets | `apps/room-worker`, `packages/room-core` | done; the "room" is already the real authority (not a fake echo) |
| ≥60 s 30 Hz benchmark with 2 clients, 20 bodies, 20 regions in the DO runtime | `apps/room-worker/src/bench-do.ts`, `test/live-bench.ts` | done (local workerd) |
| Web app with 3D scene + dev HUD (tick, bodies, frame time, transport) and `/sim-debug` | `apps/web` | done |
| Protocol version integrity check | `packages/protocol/src/version.ts`, room HELLO | done, tested both locally and live |
| ADRs | `docs/decisions/ADR-0001…0005` | done |
| CI (typecheck, lint, format, unit, builds, e2e, live worker) | `.github/workflows/check.yml` | written; runs on push (first remote run pending) |
| `.env.example`, `.dev.vars.example`, no secrets committed | root, `apps/room-worker` | done |

Beyond the spike requirements (to avoid throwaway work), the authoritative RIFTBALL match logic was
built directly into `GameWorld`: match FSM (lobby → countdown → playing → goal → roundEnd →
matchEnd, Golden Rift, finite tiebreak), PULSE / LIFT / SWEEP / GUARD as real impulses/fields,
energy, cooldowns, lockouts, kickoff shield, and a snapshot-only bot. Phase 02 verifies and tunes
them; they are not claimed as Phase 02-complete here.

## Key technical decisions

- Default authority: one SQLite-backed Durable Object per invite code; Vercel hosts only the
  static client (ADR-0001). Feasibility: **CONDITIONAL YES** (ADR-0005).
- Rapier in workerd via an aliased loader shim over the byte-identical raw `.wasm` (ADR-0002).
- Transport-agnostic `RoomAuthority` so a Node fallback is an adapter, not a rewrite.
- Seat tickets: HMAC-SHA256, bound to room + slot + generation + expiry, rotated on every HELLO;
  invite code only locates the room. Origin header is a CSRF guard, not a credential.
- Fixed tick order with alternating seat priority (ADR-0004).

## Commands actually executed (this session, 2026-10-27, Linux x64 4 vCPU, Node 22.22.0)

```
pnpm install                                  # 244 packages, lockfile written
pnpm typecheck                                # all 9 workspaces + root: exit 0
pnpm lint                                     # eslint . --max-warnings=0 -> 0 problems
pnpm format:check                             # all files Prettier-clean
pnpm test                                     # vitest: 6 files, 56 tests passed
pnpm test:e2e                                 # playwright: 3 passed (30.1 s)
WORKER_URL=http://127.0.0.1:8787 npx tsx apps/room-worker/test/live-room.ts   # 21/21 live checks PASS
pnpm benchmark:sim                            # Node 1/10/50 rooms -> docs/benchmarks/node-sim-bench-20b-20r.json
BENCH_SECONDS=60 npx tsx apps/room-worker/test/live-bench.ts   # DO runtime -> docs/benchmarks/worker-bench-20b-20r-60s.json
pnpm --filter @ff/web build                   # vite: index 222 KB (69.6 KB gz), arena 1.04 MB (279 KB gz), sim 4.37 MB (1.68 MB gz, lazy)
pnpm --filter @ff/room-worker build           # wrangler dry run: 3798.84 KiB upload / 1275.10 KiB gzip
curl http://127.0.0.1:8787/spike/physics      # in-Worker harness == Node golden: true
```

## Result matrix

| Gate / scenario | Evidence | Result |
|---|---|---|
| G01 clean build | typecheck, lint, format, unit, web build, worker dry-run all exit 0 | PASS |
| G02 real simulated world (spike) | fixed-tick Rapier core collides with arena walls (impulse 167 N·s at tick 15) and crosses goal plane (slot 0, tick 86) — `packages/sim/test/harness.test.ts` | PASS |
| Shared code in browser runtime | `e2e/phase01.spec.ts` compares `/spike` output to golden JSON | PASS (exact) |
| Shared code in Worker runtime | `/spike/physics` inside workerd == golden | PASS (exact) |
| Seed reproducibility / restore | `world.test.ts`: same seed+log ⇒ same hash; different seed diverges; checkpoint→restore continues bit-identically for 90 ticks | PASS |
| NaN rejection | schema rejects NaN/∞/out-of-range/extra fields; sim neutralises non-finite intents (`world.test.ts`, `protocol.test.ts`, `room.test.ts`, live test §5) | PASS |
| Auth ticket handling | forged / wrong-room / superseded / expired tickets rejected (`room.test.ts`, live §4, §8) | PASS |
| Protocol mismatch | refused with `protocol_mismatch` / `sim_mismatch` (unit + live) | PASS |
| Two real WS clients, unique seats, isolation, third seat rejected | live-room.ts §1–§4 over TCP to workerd | PASS (local) |
| Identical authoritative state on both clients | live-room.ts §6: identical snapshots for 120 common ticks | PASS (local) |
| G04 true remote multiplayer (partial) | real WebSockets to a real DO, same machine | PARTIAL — cross-network/devices is Phase 03/12 |
| Worker 30 Hz benchmark ≥60 s | 1800/1800 ticks, mean 0.194 ms, 0 dropped, 2 clients | PASS (local workerd, not production) |

## Benchmarks (measured; conditions stated)

- **DO runtime (local workerd):** mean tick compute 0.194 ms; 30-tick batch means min 0.067 / median 0.20 / max 0.47 ms; per-tick p95 ≤ 1 ms (1 ms timer resolution); 0 dropped ticks; max lateness 17 ms; 20 Hz snapshots ≈ 2.3 KB JSON (20 bodies) to 2 clients.
- **Node offline:** per-room tick p50 0.07–0.10 ms, p95 0.15–0.46 ms; 50 rooms on one thread p95 6.96 ms per 30 Hz frame (≈12% of a core).
- **Loopback RTT** (live test, ping/pong through the DO): p50 1.74 ms, max 2.02 ms.
- **Client rendering:** measured only under SwiftShader (CPU) in headless Chromium — 1–5 fps at
  844×390…1920×1080 with shadows+bloom. This is NOT device performance; no GPU/phone FPS is claimed.

## Screenshots (real renderer, headless Chromium + SwiftShader)

`docs/visual-evidence/phase-01/`: `arena-desktop-1080.jpg`, `arena-phone-landscape.jpg`,
`arena-phone-portrait.jpg`, `sim-debug-1080.jpg`.

Critique against docs/CREATIVE_TARGET.md (spike quality, deliberately not final art):
1. Architecture reads as a 3D arena (flagstones, inlays, fluted pillars, gate arches, shadows) but
   walls are plain boxes and the platform edge/underside lacks sculpted silhouette.
2. The Rift Core is too small on screen and lacks a trail; the floor dominates the frame.
3. Sky/horizon depth is weak (distant spires barely read); no storm-break light shafts.
4. In portrait the near gate arch occludes the near goal area.
5. A bug found and fixed during capture: z-fighting between floor and underside slab; renderer
   counters under the post-processing composer were also fixed.

## Manual device checks

NOT TESTED — no physical phones or second network were available in this environment.

## Risks / technical debt

- Local simulation runs on the main thread; under heavy rendering it starves (seen under
  SwiftShader). Move LocalSession into a Web Worker (Phase 02/11).
- Browser ships the compat (base64) Rapier chunk (1.68 MB gz) — switch to raw `.wasm` (Phase 11).
- Snapshot JSON ≈ 2.3 KB at 20 bodies — quantised binary/delta encoding before mobile launch.
- DO restart mid-match falls back to lobby (no match checkpoint persisted yet).
- No per-IP rate limiting on room creation/join yet (Phase 11).
- Boulder render radius is client-side constant (entity size table belongs in WELCOME/RESYNC).

## Reproduction

```
pnpm install
pnpm check                       # typecheck + lint + unit + build
pnpm test:e2e                    # builds the web app and runs Playwright
pnpm test:worker                 # spawns wrangler dev, runs the live two-client checks
pnpm benchmark:worker            # 60 s in-DO benchmark (local workerd)
pnpm dev:worker & pnpm dev       # http://127.0.0.1:5173 (/, /sim-debug, /spike)
```

## Commit

Implementation commit: `4c8fe27` (branch `claude/practical-cannon-43r4af`).

## Next instruction

Phase 02 (prompts/02-VERTICAL-SLICE.md + deep-dives/D02-CORE-ARENA-CAMERA.md): full local playable
match with two independent input adapters, onboarding/HUD, six seeded physics shots, rematch,
cinematic starter arena improvements, desktop + phone screenshots.
