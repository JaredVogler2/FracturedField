# FRACTURE FIELD — IMPLEMENTATION STATUS

Single source of truth for phase state. Each row links to its evidence report in docs/progress/.
Nothing here is advertised as deployed or device-tested unless the evidence column says so.

| Phase | State | Commit | Evidence |
|---|---|---|---|
| 01 Architecture/feasibility | COMPLETE | `4c8fe27` | [PHASE-01](progress/PHASE-01.md): golden physics identical in Node/Chromium/workerd; 21/21 live two-client DO checks; 60 s in-DO 30 Hz benchmark (local workerd); 56 unit + 3 e2e tests |
| 02 Local vertical slice | COMPLETE | `60d901f` | [PHASE-02](progress/PHASE-02.md): full local match loop with real input (E2E: score → win → rematch), 2 simultaneous keyboard adapters, bot, 6 D02 shots, 87 unit + 7 e2e tests, desktop + phone captures |
| 03 Online multiplayer | COMPLETE (local) — remote leg NOT TESTED | `64a684d` | [PHASE-03](progress/PHASE-03.md): two browser contexts play create → invite → join → ready → goals → identical match digest → rematch through local workerd; refresh resume; forfeit on leave; 11 in-process two-client tests (50/100/200 ms RTT + jitter + 2 % TCP loss, reset/silent-link/restart recovery); 99 unit + 10 e2e tests. Cross-network / physical devices need a deployed Worker (Phase 12 credentials) |
| 04 Matter/energy physics | COMPLETE (local) | `2b9aaee` | [PHASE-04](progress/PHASE-04.md): R1–R10 each change a scoring trajectory vs a control (golden-hashed fixtures); 14 element tests (Δv, conduction, ice hysteresis, fracture budget, finite gravity, exactly-once events, determinism, 1,000 random sequences, steam counterplay); loadouts end to end (local + online E2E); `/lab` Physics Lab (step/rewind/overlays/material toggles); worst-case element benchmark p99 ≤ 0.9 ms (Node) / 2 ms (local workerd) per 33 ms tick; 126 unit + 13 e2e tests. VFX art pass deferred to 7C |
| 05 Camera gestures | COMPLETE (local) — physical devices / live people NOT TESTED | `24fbd69` | [PHASE-05](progress/PHASE-05.md): on-device MediaPipe hand (+ stand-mode pose) landmarks in a module worker → pure gesture engine → the same `ActionIntent`s as keyboard/touch; real model on real hand photos (fake camera) → authoritative casts; gesture suite at 30 → 4 fps (PULSE 80/80 per rate, 0 false casts in 10 min of doubled-noise idle at 30/15/8 fps); a camera-only stand-in scores and rematches; dropout releases holds on the server; online with both seats on camera and no media uplink; denied/blocked → one-tap fallback; 180 unit + 20 e2e tests. Device/lighting/bystander tests and the animated gesture-tutorial silhouettes are owed (Phase 11/D15, Phase 09) |
| 06 Mobile sensors/control | COMPLETE (local) — physical phones / controllers NOT TESTED | `0f87754` | [PHASE-06](progress/PHASE-06.md): five control modes from a capability matrix (keyboard/controller, touch, handheld motion, camera, simplified), switchable mid-match without losing a hold or the intent stream; D06 gate passed (a phone with no camera and no sensors completes three online rounds with touch alone); motion from synthetic orientation readings through the authority (rotation, background → recenter, stall → touch; measured filter: 2° correction 63 % in 100 ms, 15° turn 63 % in 33 ms); iOS permission inside the tap; standard-mapping controller; multi-touch; rebinding; six screen sizes and safe-area insets; an independent review's 7 findings fixed; 217 unit + 38 e2e tests. Device checklist owed (Phase 11/D15) |
| 07 Visual production | IN PROGRESS — 7A COMPLETE (local) | `99fad61` (7A) | [PHASE-07](progress/PHASE-07.md): five art gates; 7A done in five capture/critique rounds of the running game (headless SwiftShader frames only — no GPU, no phone) |
| 08 Game depth/balance | NOT STARTED | — | — |
| 09 UX/audio | NOT STARTED | — | — |
| 10 Solo bot | NOT STARTED | — | snapshot-only bot (easy/normal/hard) used by vs-bot mode and attract demo |
| 11 QA/security/performance | NOT STARTED | — | — |
| 12 Production deployment | NOT STARTED — NOT DEPLOYED | — | no Cloudflare/Vercel deployment has been executed |
| 13 Adversarial audit | NOT STARTED | — | — |

Status values: NOT STARTED / IN PROGRESS / BLOCKED / COMPLETE. Complete only when phase tests AND
acceptance gates are documented. Update after every phase; preserve a truthful audit trail across
Claude Code sessions.

## Expanded delivery gates

For every numbered phase, also complete the matching specialist prompt(s) in
[docs/BUILD_ORDER.md](BUILD_ORDER.md). Phase **07** consists of five independently recorded art
gates: 7A geometry/materials, 7B lighting/atmosphere, 7C core/VFX, 7D character rigs/animation and 7E
screenshot-driven visual review.

| Visual gate | State | Evidence |
|---|---|---|
| 7A Environment art | COMPLETE (local) | `99fad61` — [PHASE-07 §7A](progress/PHASE-07.md): seeded generators (19 large slabs, rift-cracked slabs with crystals, carved scoring-axis channels, gates with mounted gyroscopes, columns, underside, props on their colliders), five periodic procedural PBR surface families in one triplanar program with runtime recipe swaps, translucent rift glass; round 1 → 5 frames and comparisons in docs/visual-evidence/phase-07; render counters (low tier 68–78 draws / 74–80k triangles); 243 unit + 13 e2e tests; deviations (gate 12.4 m vs D07 5–8 m) recorded |
| 7B Lighting and atmosphere | NOT STARTED | — |
| 7C Rift Core and elemental VFX | NOT STARTED | — |
| 7D Wielder characters and IK | NOT STARTED | — |
| 7E Golden screenshots and art critique | NOT STARTED | — |

## Resume notes (for the next session)

- Run `pnpm install && pnpm check` first; `pnpm test:e2e` and `pnpm test:worker` need no secrets.
- Local dev: `pnpm dev:worker` (port 8787) and `pnpm dev` (port 5173). `apps/room-worker/.dev.vars`
  is copied from `.dev.vars.example` (development-only secret).
- Earliest incomplete phase: **07**, art stage **7B** (lighting and atmosphere, D08) — see the
  "Next instruction" in docs/progress/PHASE-07.md.
- Arena art: `node scripts/capture-arena.mjs <url> <dir> <round>` captures golden frames and render
  counters from the preview build (`VISION_TESTDATA=1 pnpm --filter @ff/web build && … preview`);
  review cameras via `?test=1&shot=hero|gate|rim|wide|stone|brass|under|channel`;
  `pnpm preview:surfaces <png>` renders the procedural texture sheet. docs/ART_DIRECTION.md holds
  the recipes, budgets and open problems.
- Camera control: `pnpm dev`/`build` first run `scripts/prepare-vision-assets.mjs` (copies the
  MediaPipe WASM, downloads the two pinned models once, ~14 MB, into the git-ignored
  `apps/web/public/vision/`). Camera play needs HTTPS or localhost. `pnpm benchmark:gestures`
  prints the synthetic detection table; `node scripts/capture-camera-ui.mjs <url> <dir> <y4m>`
  captures the camera UI with the photo-hand fake camera (`scripts/make-hand-video.mjs`).
- Phone controls: `node scripts/capture-controls-ui.mjs <url> <dir>` captures the control UI on
  emulated phones; ADR-0008 records the input design; the manual iOS/Android checklist is in
  docs/progress/PHASE-06.md.
- Physics Lab: `pnpm dev` then open `/lab` (e.g. `/lab?fx=R5&t=13&cam=close`); element benchmarks:
  `pnpm benchmark:elements` and `BENCH_SCENARIO=elements pnpm benchmark:worker`.
- Online play locally: `pnpm dev:worker` + `pnpm dev`, then Online duel → Create room; open
  `/?room=CODE` in a second browser profile. `pnpm exec playwright test` starts both servers itself.
- Remote/device validation of Phase 03 is still owed once a Worker is deployed (PHASE-03 lists the
  minimum steps; it needs the owner's Cloudflare and Vercel access).
