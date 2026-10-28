# PHASE 03 — Real online two-player game / authoritative rooms (with D03)

**Status: COMPLETE for everything executable without cloud credentials.** Two browsers on two
separate browser contexts (separate storage and sockets) play a full match through the real room
service running in local `workerd` (`wrangler dev`). The **cross-network / physical-device leg of
G04 is NOT TESTED**: it needs a deployed Worker (Cloudflare credentials, Phase 12). Nothing here is
claimed as tested on phones or over the public internet.

## Objective

Two independent people on two browsers/devices play the same match. One Durable Object per room is
the only authority (physics, goals, score, energy, clocks). Clients send intents and render
authoritative snapshots/events. No mocked broadcasting and no client authority.

## What was built

| Area | Implementation |
|---|---|
| Client protocol | `packages/room-core/src/client.ts` — `RoomClient`, transport/runtime agnostic: HELLO/WELCOME, rotated resume ticket, RTT/jitter/clock-offset (PING/PONG EWMA), stall watchdog (4 s live / 15 s idle), connect timeout (8 s) — both count only time the page was awake (a heartbeat counts at most 1 s, so a page frozen by a long task never drops a healthy link; PR #3 round 3, `client-freeze.test.ts`) — exponential backoff reconnect inside the 30 s server grace, fatal close codes (protocol, replaced, bad ticket, closed, rate) never retried. Browser-safe entry `@ff/room-core/client` (no physics engine in the page bundle). |
| Browser session | `apps/web/src/net/remote-session.ts` (`RemoteSession` implements the same `SessionDriver` as local play), `room-api.ts` (create/join/info over CORS "simple" requests, friendly errors, 8 s timeout counted while the page is awake: `awake-deadline.ts`), `seat-store.ts` (seat ticket in `sessionStorage`, rotated on every WELCOME, so a refresh resumes the seat), `room-service.ts` (`VITE_ROOM_SERVICE_URL`, localhost fallback to `wrangler dev`, version/health probe). |
| Lobby / invite UX | Main menu **Online duel** → create a room or join by code; invite link `/?room=CODE` opens the join dialog prefilled; in-room lobby with large code, copy-link / native share, both seats' status (waiting / connecting / not ready / ready), controls choice, Ready toggle, Leave. Match starts only when the server sees both seats connected and ready. |
| In-match online UX | Seat-1 camera mirrored (each player defends the near/left goal; portrait looks from behind your own goal); HUD and deny toasts mirrored to match; "Reconnecting…" toast; "Rival disconnected — they have N s" toast driven by server PAUSE; failure dialog with Retry (or "opened in another tab" for a replaced seat); latency chip when RTT > 220 ms during play; Esc menu that does **not** pause the authoritative match ("Leave match (forfeit)"); result panel with forfeit / rival-left / rival-wants-rematch notes; rematch needs both players. |
| Smoothing | `SnapshotBuffer` adaptive interpolation delay (base 2.5 ticks + 2.5 × arrival jitter, clamped 2.5–9 ticks, grows fast / shrinks slowly), capped extrapolation, teleport snapping (kickoff resets no longer sweep across the arena), full buffer reset on RESYNC; remote **events are released on the render timeline** (when the interpolated view reaches the event tick, ≤ 400 ms hold) so VFX/audio/banners line up with what is on screen. Local reticle and aim preview remain instant (cosmetic only). |
| Reconnect correctness | New connection ⇒ client forgets held abilities without sending stale ENDs, restarts its sequence space at 0, and re-sends only the idempotent aim (casts are never replayed). Server cancels holds on disconnect, pauses the world, and restores the seat (same slot, same score) on a valid rotated ticket; superseded tickets are refused. |
| Dead-link detection | Server closes a seated socket silent for 6 s during a live match (clients ping at 1 Hz while live), so the opponent gets the disconnect pause instead of a frozen rival. Outside live play clients send a fixed keep-alive frame that the Durable Object answers with **WebSocket auto-response**, so idle rooms can hibernate. |
| Host restart (D03) | The room persists a ~14 KB match checkpoint (Rapier snapshot + game state) at every kickoff. A restarted Durable Object rebuilds from storage only (`RoomAuthority.rehydrate`), resumes the live match **paused** at the last kickoff with score/round/clock intact, and waits for both seats. |
| Dev-only rule set | `FAST_RULES` (1 goal per round, short pauses) shared by local practice and online rooms; the Worker honours `POST /api/rooms?rules=fast` only when `ENVIRONMENT=development`. Production rooms always play `standard`. |
| Network dev panel | `apps/web/src/hud/NetPanel.tsx` (developer HUD or `?net=1`, hidden by default): room/seat, link state, RTT + jitter, snapshots/s + arrival jitter, interpolation delay, % extrapolated frames, stale snapshots, teleports snapped, server vs view tick, intents sent vs server-acked seq, force-point lag, reconnects, downlink KiB/s, clock offset, POOR CONNECTION annotation. |

## Deterministic disconnect rules (documented contract)

1. A seat that drops during a live match pauses the world immediately (clock, physics and abilities
   frozen; the tick counter keeps running). Its held LIFT/SWEEP is cancelled at once.
2. Each absent seat has its **own** 30 s grace countdown (broadcast once per second in PAUSE).
3. When a seat's grace runs out while the other seat is present, the absent seat **forfeits**
   (MATCH_END `reason: forfeit`). No goal is ever awarded during a pause.
4. If both seats are absent when the most urgent grace runs out, the match is **abandoned** without
   a result (no winner is invented for an empty room).
5. A returning seat (valid rotated ticket) resumes play only when nobody is missing.
6. After a host restart both seats are treated as absent from the restart instant with full grace;
   play resumes from the last kickoff checkpoint. Progress since that kickoff is lost by design
   (no mid-play rewinds of a few seconds that players could exploit or find confusing).
7. Leaving on purpose (LEAVE) forfeits a live match immediately.

## Bugs found and fixed in this phase (by the new tests)

- **FixedRateLoop zero-delay storm** (production code): at epoch-scale timestamps, float rounding
  could compute "0 ticks due" exactly on schedule, re-arming the timer with a zero delay without
  advancing. Found by the virtual-clock harness (it hung); fixed with a tolerance on the due count.
- **4.3 MB physics chunk on the main menu** (pre-existing since Phase 02): `render/Arena.tsx`
  imported a pure geometry helper from the `@ff/sim` index, which dragged Rapier (base64 WASM) into
  the page's static imports. Now imported from the pure subpath `@ff/sim/arena`; the main route
  payload dropped from ≈ 2.05 MB to ≈ 0.37 MB gzip (Rapier now loads only in the local-authority
  worker and the debug routes).
- Old pause logic awarded the win to whichever seat was present when the first absentee's grace
  expired, even if that seat was also gone; replaced by per-seat grace + abandonment (rule 4).
- Win banner grammar for the local player ("YOU WIN", not "YOU WINS"); keyboard key hints hidden on
  touch devices.

## Evidence

### Commands executed (2026-10-27)

```
pnpm typecheck            # exit 0
pnpm lint                 # 0 problems
pnpm format:check         # clean
pnpm test                 # vitest: 9 files, 99 tests passed
pnpm exec playwright test # 10/10 passed (5.6 min): phase01 ×3, phase02 ×4, phase03 ×3
pnpm test:worker          # live DO room checks against wrangler dev: ALL PASSED (RTT p50 1.84 ms)
```

### In-process integration suite — `packages/room-core/test/client.test.ts` (11 tests)

Real `RoomClient`s ↔ real `RoomAuthority` driven by the production `FixedRateLoop`, over a
TCP-like simulated link (`packages/test-utils/src/network-sim.ts`: loss becomes retransmission
delay with head-of-line blocking, as on a WebSocket) on a virtual clock.

- Create/join, both READY, **opposed pulses on the same tick** (both ACKed, same tick, horizontal
  core speed < 0.5 m/s), two goals, identical goal events, **identical match digests**, identical
  event streams, > 100 byte-identical snapshots, rematch only when both ask.
- 50 / 100 / 200 ms RTT, ±30 % jitter, 2 % loss: every discrete action ACKed; force points converge
  to the last aim within 5 cm; no stuck hold; no reconnects; RTT estimate within range; byte-identical
  snapshots and identical events on both clients.
- Reset mid-hold: opponent paused (not awarded the win), hold cancelled, automatic resume with the
  same slot and score, sequence restarted at 0, play continues to a correct match end; the original
  ticket is refused afterwards (no dual ownership).
- Silent dead link: client watchdog reconnects and resumes; silent seat that never returns is
  reaped after 6 s, the opponent is paused, then wins by forfeit after the 30 s grace.
- Host restart: both clients reconnect by themselves; the match resumes from the last kickoff with
  the score kept and stays fully playable; one-returner ⇒ absent forfeits; nobody returns ⇒ abandoned
  and the checkpoint is cleared.
- Replayed / out-of-order intents are refused as `stale` and cause no cast.

Measured (virtual time, deterministic seeds; 12 s of play + 3 s drain):

| RTT (ms) | jitter ± (ms) | segments / retransmitted | acks | ack median (ms) | ack p95 (ms) | ack max (ms) | RTT estimate A/B (ms) | identical snapshots |
|---|---|---|---|---|---|---|---|---|
| 50 | 7.5 | 1391 / 31 | 32 | 62 | 263 | 265 | 50 / 81 | 361 |
| 100 | 15.0 | 1404 / 32 | 32 | 132 | 289 | 311 | 136 / 125 | 361 |
| 200 | 30.0 | 1415 / 33 | 32 | 232 | 498 | 533 | 225 / 251 | 357 |

(The p95/max columns are the retransmitted segments: 200 ms RTO with exponential backoff.)

Room unit tests (`room.test.ts`, 17) additionally cover tickets, seat issuance (third seat
refused), forged/foreign/superseded tickets, version refusal, forged server messages, NaN /
out-of-range values, intent floods, the silence reaper, and restart rehydration of seats.

### Browser E2E — `e2e/phase03.spec.ts` (two browser contexts, real room service in local workerd)

- **create → invite link → join → both ready → both act → goals → identical result → rematch**:
  host creates via the UI, guest opens `/?room=CODE` and joins with one click; B raises a GUARD
  with its own keyboard and it exists in A's world; B's mouse steers seat 1 as seen on A (mirrored
  camera); A scores with the real mouse until A wins 2–0; both pages receive the **same match
  digest**; A shows YOU WIN, B shows RIVAL WINS; rematch requires both clicks; both restart 0–0.
- **refresh resumes the same seat mid-match**: B reloads; A's world pauses and shows "Rival
  disconnected"; B returns to seat 1 with no clicks (sessionStorage ticket), the pause lifts, no
  forfeit, and B's mouse drives seat 1 again.
- **leaving mid-match forfeits**: B leaves from the menu; A gets YOU WIN with the forfeit note and
  the rematch button disabled (rival gone).

### Screenshots (real renderer; headless Chromium + SwiftShader — visuals only, not performance)

`docs/visual-evidence/phase-03/`: online menu, host lobby (waiting / rival ready), guest invite
dialog and lobby at 390×844 portrait, live play from the host (desktop) and guest (portrait, mirrored
camera from behind TIDE's own goal). Captured with `scripts/capture-online.mjs`.

Critique: lobby and dialogs are legible at phone width; the code is the dominant element; seat
status uses glyph + colour + text. Issues for Phase 06 (mobile controls): the touch buttons cover
the lower-right of the arena in portrait and ability chips truncate at 390 px. The latency chip in
these captures (700–1800 ms) is real *application-level* latency in this environment: two
software-rendered WebGL pages stall the main thread for hundreds of ms per frame and the RTT is
measured on the main thread. It is not a network figure.

## Platform decision (prompt step 9)

Phase 01 measured 0.194 ms mean per 30 Hz tick inside local workerd with zero dropped ticks, so the
Durable Object keeps the authority. The authority (`RoomAuthority`) and client (`RoomClient`) are
both transport-agnostic, so a Node host could replace the Durable Object adapter without protocol
changes. There is no silent downgrade to client authority anywhere.

## Not tested / limitations (honest)

- **Two devices on different networks (G04 remote leg): NOT TESTED.** Requires a deployed Worker.
- No physical phones/tablets; touch exercised only via emulated contexts.
- No real-WAN measurements; the lag/loss numbers above are from the simulated link only.
- Hibernation and eviction are exercised by unit/integration tests and the code paths for the
  Durable Object adapter. A real hibernation/eviction on Cloudflare has not been observed.
- RTT shown to players is application-level (includes main-thread delay), by design.
- The attract demo behind the main menu still starts the local-authority worker (≈ 1.7 MB gzip with
  embedded Rapier WASM). Phase 11 should defer it, or switch the worker to the streaming `.wasm` build.

## Minimum next steps for the remote leg (needs the owner's Cloudflare/Vercel access)

1. Cloudflare: authenticate wrangler (`wrangler login` or a `CLOUDFLARE_API_TOKEN` with Workers +
   Durable Objects edit rights). Never paste secrets into chat or the repo.
2. `wrangler secret put TICKET_SECRET` (≥ 32 random bytes), and set `ENVIRONMENT=production`,
   `ENABLE_SPIKE_ROUTES=false` and `ALLOWED_ORIGINS=https://<vercel-domain>` for the deployed env.
3. `pnpm --filter @ff/room-worker deploy`, then probe `https://<worker>/health`.
4. Vercel: set `VITE_ROOM_SERVICE_URL=https://<worker>` for the web project and deploy.
5. Run the physical checklist: two phones on cellular + Wi-Fi, iPhone + Android, desktop + phone.
   Create on one device, join on the other, play to a result, refresh mid-match, compare results.
   Record actual evidence only.

Same-Wi-Fi LAN test before deployment: run `wrangler dev --ip 0.0.0.0` and `vite --host 0.0.0.0`,
add `http://<lan-ip>:5173` to `ALLOWED_ORIGINS` in a local (uncommitted) override, set
`VITE_ROOM_SERVICE_URL=http://<lan-ip>:8787`, and open the LAN URL on both devices. This proves two
devices but not two networks.

## Reproduction

```
pnpm install
pnpm dev:worker             # room service on 127.0.0.1:8787 (development vars only)
pnpm dev                    # http://127.0.0.1:5173 → Online duel → Create room
# second "device": another browser profile/window → /?room=CODE → Join
# diagnostics: add ?net=1 (network panel) or enable Developer HUD in Settings
pnpm exec playwright test e2e/phase03.spec.ts   # starts both servers itself
pnpm vitest run packages/room-core               # integration + room unit tests
```

## Commit

Implementation commits: `1a7360d` (room client, impaired-network suite, dead-link detection) and
`64a684d` (Phase 03 completion).

## Next instruction

Phase 04 (prompts/04-MATTER-ENERGY.md + D04): element/material reaction engine on the shared
authority, with tests for at least eight physical reactions (gameplay effect + counters).
