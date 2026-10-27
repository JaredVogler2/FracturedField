# FRACTURE FIELD — IMPLEMENTATION STATUS

Single source of truth for phase state. Each row links to its evidence report in docs/progress/.
Nothing here is advertised as deployed or device-tested unless the evidence column says so.

| Phase | State | Commit | Evidence |
|---|---|---|---|
| 01 Architecture/feasibility | COMPLETE | `4c8fe27` | [PHASE-01](progress/PHASE-01.md): golden physics identical in Node/Chromium/workerd; 21/21 live two-client DO checks; 60 s in-DO 30 Hz benchmark (local workerd); 56 unit + 3 e2e tests |
| 02 Local vertical slice | COMPLETE | `60d901f` | [PHASE-02](progress/PHASE-02.md): full local match loop with real input (E2E: score → win → rematch), 2 simultaneous keyboard adapters, bot, 6 D02 shots, 87 unit + 7 e2e tests, desktop + phone captures |
| 03 Online multiplayer | COMPLETE (local) — remote leg NOT TESTED | (this commit) | [PHASE-03](progress/PHASE-03.md): two browser contexts play create → invite → join → ready → goals → identical match digest → rematch through local workerd; refresh resume; forfeit on leave; 11 in-process two-client tests (50/100/200 ms RTT + jitter + 2 % TCP loss, reset/silent-link/restart recovery); 99 unit + 10 e2e tests. Cross-network / physical devices need a deployed Worker (Phase 12 credentials) |
| 04 Matter/energy physics | NOT STARTED | — | — |
| 05 Camera gestures | NOT STARTED | — | — |
| 06 Mobile sensors/control | NOT STARTED | — | — |
| 07 Visual production | NOT STARTED | — | — |
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
| 7A Environment art | NOT STARTED | — |
| 7B Lighting and atmosphere | NOT STARTED | — |
| 7C Rift Core and elemental VFX | NOT STARTED | — |
| 7D Wielder characters and IK | NOT STARTED | — |
| 7E Golden screenshots and art critique | NOT STARTED | — |

## Resume notes (for the next session)

- Run `pnpm install && pnpm check` first; `pnpm test:e2e` and `pnpm test:worker` need no secrets.
- Local dev: `pnpm dev:worker` (port 8787) and `pnpm dev` (port 5173). `apps/room-worker/.dev.vars`
  is copied from `.dev.vars.example` (development-only secret).
- Earliest incomplete phase: **04** — see the "Next instruction" in docs/progress/PHASE-03.md.
- Online play locally: `pnpm dev:worker` + `pnpm dev`, then Online duel → Create room; open
  `/?room=CODE` in a second browser profile. `pnpm exec playwright test` starts both servers itself.
- Remote/device validation of Phase 03 is still owed once a Worker is deployed (PHASE-03 lists the
  minimum steps; it needs the owner's Cloudflare and Vercel access).
