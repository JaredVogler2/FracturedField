# PHASE 04 — Matter / energy interaction engine (with D04)

**Status: COMPLETE (local).** Every element reaction R1–R10 is simulated by the server-authoritative
`GameWorld`, changes server-owned state, and is proven by a control/reaction fixture pair to change
a scoring trajectory. Loadouts, HUD, touch and keyboard controls, sounds and element visuals are
wired end to end in local and online play; a development Physics Lab replays the fixtures through
the real renderer. Not claimed: physical-device testing, Cloudflare production performance, or
final production art (element VFX get their art pass in Phase 07C).

## What was built

| Area | Implementation |
|---|---|
| Element rules (data) | `packages/game-data/src/elements.ts` — all coefficients in one `ElementRules` table (pool, ice, steam, flame, infuse, freeze, charge, magnet, gravity, body, fracture) referenced by `GameRules.elements`; `abilities.ts` — INFUSE in the base kit, FREEZE / CHARGE / GRAVITY / MAGNETIZE advanced, `LOADOUT_SIZE = 2`. `SIM_VERSION 2`, `PROTOCOL_VERSION 2`. |
| Authority | `packages/sim/src/game.ts` — sparse regions (pools, ice plates as static frustum colliders, steam, flames), per-body element state, deterministic discharge BFS (`elements.ts`), Plummer-softened magnet / gravity fields, boulder fracture into budgeted rigid shards, thermal shock, brittle pass-through, lodestones. Element stage inserted into the fixed tick order (ADR-0006 §4). Each transition emits exactly one canonical `reaction` event. |
| Loadouts | Picks travel with READY (`ReadySchema.loadout`, strict tuple of advanced ids) to the room (applied in `maybeStartMatch`) or the local worker (applied before `startMatch`, buffered if physics is still loading). `setLoadout` refuses invalid picks and any change during live play; casting a move outside the loadout is refused `not_available` at no cost. Picks are public (`LobbySeat.loadout`). |
| UI | `ui/Loadout.tsx` picker (ready gate, both seats in a local duel; online lobby, locked once ready); rival picks in the lobby seat row and HUD panel; HUD 8 chips (base kit, WET/HEAT coloured by element, two picks) with key hints; controls panel rows + element rules; touch row WET/HEAT + picks (MAGNET is press-and-hold); action-specific refusal texts ("Nothing conductive in reach", "No lodestone in range", "Not in your loadout"). |
| Input | Keyboard: P1 `1`/`R` wet, `2`/`T` heat, `3`/`C` and `4`/`V` picks; P2 `7`–`0` / numpad; hold picks send start/end edges. All map to the same `ActionIntent` stream as every other device. |
| Visuals (non-authoritative) | `render/vfx/ElementEffects.tsx` — water (ripple normals, fresnel sky, glints, meniscus; violet-blue arcs when electrified), ice plates (lit material + Voronoi cracks + frost + rim), steam volumes, flame tongues with glowing beds and smoke, gravity wells, magnet field lines, discharge bolts; boulder/core/guard looks for wet, hot, charged, shocked; reaction bursts and cast rings. Quality tiers thin particles only. |
| Audio | Procedural cues for every reaction family (soak, ignite, chill, freeze, melt, boil, douse, shatter, fracture, quench, overload, energize, well) plus magnet and discharge; driven by authoritative events only. |
| Physics Lab | `/lab` (dev tool, lazy route): `lab/lab-controller.ts` + `routes/LabPage.tsx` + `lab/LabOverlays.tsx`. Fixture/variant picker, play/pause, single step, rewind/seek (world checkpoint every 15 ticks + deterministic replay), 0.1–1× speed, timeline scrubber, velocity vectors, true-radius field outlines, impulse markers, event sequence, live expectation checks, close-up camera, material toggles (soak/dry/heat/chill/shock via `debugSetBodyElement`; the timeline is marked MODIFIED until rewound). URL-reproducible: `/lab?fx=R3&v=control&t=120&cam=close`. |
| Shared scenario runner | `packages/sim/src/scenario.ts` (`@ff/sim/scenario`): fixture validation, `ScenarioRun` (step, runToEnd, mark/rewind). Used by both the regression suite and the Lab, so the Lab shows exactly what the tests assert. Fixtures moved to `packages/sim/fixtures/reactions/*.json`. |
| Benchmarks | `ElementStress` worst-case driver (`bench-scenario.ts`), `pnpm benchmark:elements` (Node) and `BENCH_SCENARIO=elements pnpm benchmark:worker` (local workerd). |

## D04 reaction matrix — fixture outcomes (control vs reaction)

From `pnpm test` (`packages/sim/test/fixtures.test.ts`); hashes pinned in `test/fixtures/golden.json`.

| Id | Reaction | Control | Reaction | Reaction events |
|---|---|---|---|---|
| R1 | water + cold → ice-ramp plate lofts the shot over a guard | GOAL P2 @204 · peak 1.3 m | **GOAL P1 @164** · peak 7.8 m | chill, freeze |
| R2 | ice + heat → melted pool slows the core instead of launching it | GOAL P1 @205 · peak 7.8 m | **no goal** · peak 1.3 m | chill, freeze, ignite, melt, douse |
| R3 | water + heat → steam floats (and veils) the core over a guard | GOAL P2 @187 | **GOAL P1 @101** · peak 3.5 m | ignite, boil |
| R4 | metal + charge → energized lodestone bends a passing shot | GOAL P1 @55 | **no goal** | energize |
| R5 | wet chain + charge → soaked guard overloads, shot goes through | no goal | **GOAL P1 @111** | shock ×3, overload |
| R6 | crosswind + flame → heat carried downwind melts an ice ramp | GOAL P1 @225 · peak 7.8 m | **no goal** · peak 3.4 m | chill, freeze, ignite, melt, douse |
| R7 | gravity well curves a shot aimed wide into the goal | no goal | **GOAL P1 @87** | well |
| R8 | earth impact → struck cover fractures, the lane opens | no goal | **GOAL P1 @102** | fracture ×2 |
| R9 | a crosswind bends a wide shot in; an opposing wind cancels it | GOAL P1 @49 | **no goal** (fields superpose, no runaway) | — |
| R10 | heated then quenched stone is weakened and smashes | no goal | **GOAL P1 @162** | ignite, quench, douse, soak, fracture |

D04 gameplay checks: *bank off ice but not off wet floor* — R2 control (ice ramp) scores, the melted
(wet floor) variant does not. *Steam never uncounterable* — new test: the core stays replicated
every tick inside steam, steam count ≤ cap, the longest veil ≤ steam lifetime. *Reactions never
create triggers* — the 1,000-sequence test asserts every goal is the core centre past the scoring
plane inside the mouth. *Energy is injected, not conserved* — documented in ADR-0006 §2.

## Evidence

### Commands executed (2026-10-27, this container)

```
pnpm typecheck && pnpm lint && pnpm format:check   # clean
pnpm test                                          # vitest: 11 files, 126 tests passed
pnpm build                                         # web + worker dry-run bundle OK
pnpm exec playwright test                          # 13/13 (phase01 ×3, phase02 ×4, phase03 ×3, phase04 ×3)
pnpm test:worker                                   # live room checks vs local workerd: ALL PASSED (protocol v2)
pnpm benchmark:elements                            # docs/benchmarks/node-elements-worst-case.json
BENCH_SCENARIO=elements pnpm benchmark:worker      # docs/benchmarks/worker-bench-elements-20b-60s.json
pnpm benchmark:worker                              # docs/benchmarks/worker-bench-20b-20r-60s.json (re-measured)
```

Unit tests added this phase: `packages/sim/test/elements.test.ts` (14: Δv = J/m within 2 %, wet vs
dry conduction, freeze/melt collider hysteresis, fracture threshold + exactly-once + shard budget,
gravity finite at r ≈ 0 and speed caps held, exactly-once events under repeated causes,
determinism, 1,000 random sequences with finite transforms / bounded counts / legal goals,
loadout refusal, checkpoint/restore of regions, steam counterplay) and
`packages/sim/test/fixtures.test.ts` (13: R1–R10, fixture validation, deterministic Lab rewind).

Browser E2E `e2e/phase04.spec.ts` (3): a vs-bot player picks GRAVITY + MAGNET in the ready gate,
the HUD shows exactly the 8 chips, key `1` puts a seat-0 pool into the authoritative snapshot and
key `3` casts GRAVITY (FREEZE never cools down); the Lab steps, rewinds and replays R7 (reaction
and control) with every expectation passing and `WELL` in the event log; online, the host's READY
loadout appears in the guest's lobby and the room applies it (the guest's view shows the host's
GRAVITY cooldown).

### Worst-case element benchmark

Node, single thread, Intel Xeon @ 2.10 GHz (4 vCPU container), Rapier 0.21, 20 dynamic bodies,
3,600 measured ticks per scenario (`ElementStress`: both seats casting overlapping elements,
energy topped up, a boulder slammed every 1.5 s, rounds reset every 30 s):

| Scenario | step mean | p95 | p99 | max | snapshot encode p99 | snapshot bytes mean / max | load reached (max) |
|---|---|---|---|---|---|---|---|
| rules (real cooldowns) | 0.19 ms | 0.43 ms | 0.88 ms | 4.25 ms | 0.19 ms | 3,043 / 4,202 | pools 5, steam 4, flames 6, 20 bodies (17 shards peak) |
| saturated (no cooldowns, staged pools) | 0.11 ms | 0.32 ms | 0.58 ms | 2.32 ms | 0.19 ms | 3,765 / 5,612 | pools 8, steam 6, flames 6, 20 bodies, 19 element bodies |

p99 is 1.7–2.6 % of the 33.3 ms tick. In local **workerd** (wrangler dev, not Cloudflare
production; 1 ms timer resolution) the element scenario ran 60 s real time at 30 Hz with two
WebSocket clients: mean 0.76 ms/tick, p50 1 ms, p99 2 ms, max 93 ms (a single stall; 2 catch-ups,
0 dropped ticks), 1,199 snapshots to each client (mean 3,111 B), peak 13 simultaneous regions.

**Benchmark bug found and fixed:** the in-Worker benchmark's synthetic generator and its socket
clients numbered intents independently, so after ~1 s the clients' faster sequence made the
generator's casts *stale* — the Phase 01 base run (`4c8fe27`) therefore under-loaded the room. The
DO now re-stamps sequence numbers per seat and reports accepted/refused counts. Re-measured base
scenario (20 bodies + region stand-in, Phase 04 sim): mean 0.57 ms/tick (was 0.19 ms), p99 1 ms,
max 69 ms (single stall), 0 dropped ticks.

Not measured: production Workers CPU time, client GPU cost of the element VFX on real phones
(Phase 11 / D15 with real devices). Headless SwiftShader numbers are never used as performance.

### Visual critique (actual renders, `docs/visual-evidence/phase-04/`)

Captured with `node scripts/capture-elements.mjs <baseUrl> <outDir>` from the production build
(headless Chromium + SwiftShader, Lab close-ups plus one live vs-bot match).

- **Iteration 1** (`before-iter1-*`): water read as a cartoon cell pattern (the electric veins were
  noise contours); flames were round yellow blobs (read as glowing smoke); ice was a milky frisbee.
- **Iteration 2**: water rewritten (ripple-normal glints, fresnel sky, darker wet-stone tint,
  meniscus); flames became tapered tongues with a glowing bed and smoke; ice got Voronoi cracks and
  frost. Flames and water now read correctly; ice reads as cracked ice.
- **Iteration 3**: electrified water was too close to plain glints — arcs re-coloured violet-blue
  with a halo and a faint tint between arcs (`lab-r5-electrified-water.jpg`).
- Remaining (Phase 07C art pass): ice is still too opaque/white, wells need lensing, steam lacks
  self-shadowing, discharge bolts are only visible in live play (silent Lab seeks skip events),
  and smoke is faint.

## Approximations and honest limits

- Element physics is a legible rule set (ADR-0006 §2), not fluid / thermal / electromagnetic
  simulation. Energy is injected by abilities and not conserved.
- The bot (Phase 10) does not use element moves yet; vs-bot rival panels show its (default) picks.
- With real cooldowns two players reach ≈ 5 pools / 4 steam / 6 flames at most; the caps
  (8 / 6 / 6) were only reached in the saturated stress run.
- Remote/device validation of online play (Phase 03 note) still requires a deployed Worker.

## Commits

- `ed8b98f` Phase 04 (1/3): authoritative matter/energy engine and reaction fixtures
- `2b9aaee` Phase 04 (2/3): element client, loadouts end to end, Physics Lab, worst-case benchmarks
- Phase 04 (3/3): reports, ADR-0006, counterplay/goal-legality tests (this commit)

## Next instruction

Phase 05 — camera gestures (prompts/05 + D05): local-only camera inference producing the same
`ActionIntent` stream, gesture state machines for the base kit and both picks, calibration and
privacy UX, with the Camera Stand / handheld / desktop configurations kept distinct.
