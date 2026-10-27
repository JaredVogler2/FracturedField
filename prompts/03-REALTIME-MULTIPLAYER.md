# PROMPT 03 — REAL ONLINE TWO-PLAYER GAME / AUTHORITATIVE ROOMS

## Mission
Make two independent people on two browsers / networks play the same match. Use Vercel-hosted static client + Cloudflare Worker Durable Object game rooms by default, using the proven phase 01 benchmark result. No mocked broadcasting.

## Implementation sequence
1. Implement versioned protocol in packages/protocol with runtime schemas, max sizes, bounded numeric fields, explicit discriminated message types; WebSocket message codec and parse failure handling.
2. Room management with createRoom, joinRoom, optional room info, random nonenumerable IDs, short human invite code, time-limited server-issued guest tokens, 2 authenticated seats (third cannot impersonate). Separate public code from private credential, reconnect ticket.
3. Match lifecycle FSM: created -> lobby -> ready -> countdown -> playing -> goal pause -> round over -> playing -> match complete / aborted. All clock and outcomes owned by server. Build lobby UX and input selection.
4. Implement server authoritative Rapier GameWorld: one instance per room, fixed timestep scheduled appropriately to platform semantics, verified resource consumption, validated command queue. Cancel stale held gestures on disconnect. Do NOT trust client force, hit, cost, score, player world position, action cooldown or goal.
5. Dispatch low-frequency command stream (start/hold/end and 10–20Hz updates), sequence/ACK, tick-indexed accepted actions, snapshots and ordered GameEvents. Snapshot at adjustable 10–20Hz, delta where helpful. WebSocket compression only after profiling.
6. Smooth renderer: client authoritative snapshot ring buffer, configurable interpolation lag (~100ms), bounded extrapolation, state reconciliation on resync/goal, cosmetic local reticle and force preview instantly.
7. Implement ping RTT / clock drift estimate, error/reconnect toast, resend pending safe intents, auto-pause on transient disconnect, verified resumed seat. Resync from full snapshot. No improper dual-ownership on refresh.
8. Room idle, timeout and cleanup: persist minimal status, announce leave, close sockets, handle hibernation/resume for idle. Carefully manage tick scheduling and CPU; no expensive idle polling.
9. Decide how to handle platform Worker limitations based on measured phase 01/03 load tests. If CF Durable Object physics is not sustainable, run the shared authority in a documented stateful service and keep Cloudflare room gateway or replace via transport interface. Never silently downgrade to clients authoritative.
10. Network dev panel: room ID, RTT, jitter, incoming snapshots/sec, prediction error, stale tick count, last sequence, authenticated seat; hides in release.

## Automated integration suite
- Two independent in-process network clients can create/join, send opposed pulses and observe shared core transforms and exactly identical scores after round.
- Third join is rejected without valid token; forged goal message ignored; invalid move/energy/NaN angle rejected; duplicate/out-of-order input ignored.
- Inject lag 50/100/200ms, jitter and 2% loss in network simulator; no divergent authority and no infinite frozen controls.
- Force disconnect player 2, rejoin with valid resume ticket; player 2 regains same seat and score; opponent receives pause not free win.
- Repeated identical goal sensor frames score once; timeout across lifecycle boundaries deterministic.
- Browser E2E for create->invite->join->both ready->two-player ability->goal->score->rematch.

## Physical device checklist
Two iPhones, iPhone + Android, desktop + phone, both over distinct networks (cellular/Wi-Fi) if accessible. Explain how to reproduce if no devices available. Cross-network test must not be marked passed without execution.

## Acceptance
G04 G05 G12 and phase 02 functionality. Neither player is a bot during multiplayer validation. Production deployment integration comes phase 12, but remote network test against a reachable staging Worker should happen NOW if permitted.
