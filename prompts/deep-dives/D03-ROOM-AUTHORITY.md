# DEEP DIVE D03 — TWO PHONES, SAME CANONICAL WORLD

**Execute during Phase 03.** The system must be fully authoritative and resist divergent scoring/position/energy.

## Physical topology
The Vercel static web game establishes WSS connection to a region-appropriate Cloudflare Worker. The Worker routes room ID to one Durable Object that exclusively simulates match state. Two independent clients never call one another directly for scoring. Keep host transport abstract in case a persistent Node process proves a better 30Hz economics/performance fit.

## Wire schema, explicitly implement
- join(create, public invite code, expiring ticket), authenticate seat, resume with rekey.
- HELLO and WELCOME with protocol version, player slot, server tick, full state and capabilities.
- READY, COUNTDOWN, MATCH_START, INTENT(seq, action, phase, aim, targetHint, clientTime), ACTION_ACK, SNAPSHOT(tick,state,ack), EVENT(id,tick,type,magnitude,position), PING/PONG, PAUSE, RESYNC, MATCH_END, REMATCH, ERROR.
- Validate each message using a strict runtime schema, max length, number bounds, permitted enum, per-seat rate limit. Signed/opaque tickets must not be guessable.

## Authoritative ordering
At each tick: drain bounded input queues per seat, reject stale/rate-limited intents, compute resource cost/cooldown/valid side and targeting, apply fields/forces, step Rapier, resolve goals/reactions, emit deduped events and snapshot. Inputs only specify intentions; clients NEVER specify impulse strength beyond clamped input intensity, entity transform, score or cooldown.

## Smoothness
Render 1–3 snapshots behind latest as budget demands, interpolate on quaternion+translation with event-aware reconciliation. Instant local visual anticipation of ability is allowed, but hit/score effects only after server event. Gracefully cancel predicted ability if rejected.
Report RTT, p95 jitter, old snapshot count, updates/sec, prediction correction magnitude; annotate poor connection.

## Reconnect correctness
Pause or safe-continuation based on documented deterministic rules. A disconnect cancels ongoing held LIFT/SWEEP and prevents invisible extra force. Resume ticket restores same player slot and original score, full snapshot, pending move ACK. Refresh cannot make ghost third player.
Persistent state: seats/tickets/room expiry/ready-state and enough match checkpoint if object restarts. Test restart/hibernation explicitly; don't rely on memory surviving.

## Two-client test script
1. Start Worker and web clients; create invite, second joins with separate credential.
2. Both READY; opposite Pulse commands at nearly same time. Assert same physics tick and world server state, no double ownership.
3. Score a goal and compare official result both clients.
4. Attack by sending forged EVENT(score), INTENT(NaN), 2000 packets/sec, wrong seat ticket: reject safely.
5. Inject 100ms RTT + jitter; verify visual smoothness; disconnect one browser tab mid-hold and reconnect in less than grace period.
6. Complete match/rematch and inspect Worker logs and room resource cleanup.
7. On cloud staging run two devices on different networks; record evidence only if actually executed.

## Gate
No world-wide local authority duplicates during remote duel. Logs of chat WebSocket messages alone are not multiplayer proof; gameplay state must be synchronized and scored by server.
