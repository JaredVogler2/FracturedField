# SYSTEM ARCHITECTURE AND NETWORK CONTRACT

## Decisions and boundaries
- Frontend: TypeScript + Vite + React + React Three Fiber + Three.js + zustand (state), @react-three/drei where useful; host built client through Vercel. Choose Next.js only if actually needed; static Vite avoids unnecessary server complexity.
- Physics: @dimforge/rapier3d-compat or verified compatible Rapier WASM version. Actual package/version to be pinned after phase 01 runtime spike. Dedicated pure simulation package shared between browser and server.
- Real-time authoritative rooms: Cloudflare Workers with one SQLite-backed Durable Object per room, WebSocket command transport. The Durable Object owns game state, scoring, action validation, physics stepping and snapshots; external Worker routes join/create. Alternative server implementation allowed only after measured constraints prove the default unsuitable.
- Visual layer never mutates the authoritative physics world; interpolate snapshot transforms, VFX respond to server events.
- MediaPipe tasks-vision browser inference only. Browser MediaDevices and DeviceMotion/Orientation optional. No camera frames, voice samples or personal biofeatures leave the device.
- Single pnpm or npm workspace monorepo: apps/web, apps/room-worker, packages/sim, packages/protocol, packages/controls, packages/game-data, packages/ui, packages/test-utils. Prefer a maintainable choice and document it.

## Timing and budget targets (targets, NOT guarantees)
- Server: fixed step 1/30 s initially; 20 Hz snapshots (increase only with evidence); each client sends 10–20 Hz compressed intents with sequence number plus event messages on edge transitions.
- Client: interpolated rendering toward 60 FPS on desktop / 30–60 on mid-range mobile; dynamic resolution and effects quality.
- Sensor inference: adaptive 15–30 FPS as possible, ideally off main render thread; throttle without slowing render.
- Responsiveness: input-to-visible local visual feedback under 100 ms where feasible, median end-to-end impact under 150 ms at good network; test at RTT 50/100/200 ms and packet loss.
- World state: 1 core, 2 player proxies, ≤20 dynamic hard-collision bodies, ≤30 simulated effects, particles mostly GPU/local. Instrument CPU, memory, tick overruns, message sizes and bandwidth.
- Explicit fallback: if Worker CPU, WASM, sustained 30 Hz or platform limits fail, preserve common simulation and move authoritative process to dedicated always-on Node/WebSocket host. Do not pretend Vercel Function affinity is guaranteed.

## Canonical simulation
Pure-ish GameWorld state builder creates identical seeded world and force map. Define tick(n) = apply validated time-stamped/sequence-ordered player inputs, step physics fixed dt, resolve interactions and triggers, produce deterministic GameEvent list, emit snapshot.
- Wall-clock used only for delivery and session timeouts, never movement integration.
- Use seeded PRNG for hazards, spawns, breaks, and kickoffs.
- Quantize derived event thresholds, minimize expensive fields, cap impulses/forces/masses/velocities.
- State has rigid bodies/collider sets, element state grids/regions, energy, score, round, timer, cooldowns and match lifecycle.
- Reset state at round transitions. Snapshots include tickId, simTimeMs, version, serverTime, entity transforms, velocities, element region deltas, player meters, round/score and an event sequence cursor.
- Version protocol and simulation parameters. Preserve exact same physics package initialization/version per authoritative deployment; don't rely on client lockstep determinism across arbitrary updates.

## Multiplayer message examples (formalize in TypeScript + runtime schema)
Client -> server:
- HELLO {protocolVersion, roomCode, joinToken, clientBuildId, resumeToken?}
- READY {calibrated, inputMode}
- INTENT {seq, clientTime, intentType, aimUnitVec2, targetId?, phase: start|hold|end|tap, intensity, modifier?, inputSource}
- PING {seq, t0}
- REMATCH {wantsRematch}
- LEAVE {}

Server -> client:
- WELCOME {playerSlot, roomRules, serverTick, sessionId, reconnectTicket, seed, role}
- LOBBY {players, presence, ready, startCountdown}
- SNAPSHOT {tick, serverTimeMs, entities, regions, energy, score, matchState, lastAcceptedSeqByPlayer}
- EVENT {id, tick, type, bodyIds?, position?, magnitude?, sourcePlayer?, reason?}
- ACTION_RESULT {seq, accepted, reason?, cooldownRemaining?}
- PONG {seq, t0, t1}
- RESYNC {fullSnapshot, reason}
- MATCH_END {winner, scores, seed, replayDigest}

All messages schema-validated at boundary using a lightweight runtime library, bounded size, bounded command-rate, anti-replay seq; never trust player position, scoring claims, object collision claims, self-reported cost/energy, or target visibility. Aiming normalized to camera/world via signed initial calibration mapping and server-enforced side rules. Restore via expiring signed tokens, not trusting simple room code as identity.

## Shared session lifecycle
1. Create room through Worker endpoint; return opaque roomId / short invite code, expiring host ticket and public join URL (no authorization token in public link).
2. Player 1 connects; player 2 enters link, gets one of two authenticated seats. Third user rejected or optional spectator read-only.
3. Both finish controls setup and indicate READY, server launches synchronized countdown.
4. During game server owns current tick, physics, goals, locks, and rounds. Inputs validated & integrated. Send delta/full snapshots as needed.
5. Lost heartbeat => grace period 30 sec, show pause/rejoin UI; don't immediately award goal. Later surrender/forfeit by deterministic rules.
6. Room TTL and cleanup after end + idle. When live sim isn't running, Durable Object may hibernate. Serialize essential session data explicitly to storage; rehydrate after eviction; never assume in-memory interval is durable.
7. Server log records anonymous room metrics and errors, never raw video.

## Prediction, interpolation and reconnection
- Locally predict only cosmetic hand effect, reticle and safe local core approximation; authoritative snapping must be smooth.
- Render 80–130 ms behind latest server tick where network demands, interpolate bodies, short extrapolation capped and disabled during collisions/goals.
- Duplicate/out-of-order packets dropped; seq-based action acknowledgement. Reliable WebSocket order is per connection, not across disconnect and reconnection.
- Full snapshot on reconnect, resume ticket revalidated, state reconciled, force-lingering actions canceled on disconnect.
- High latency indicator + interpolation quality reduction or queue safeguards.

## Simulation tech details
Rigid bodies: dynamic Rapier world; broadphase, collision groups, trigger goal sensor; collision event queue.  
Water: bounded zone patches with drag/buoyancy and wetness scalar.  
Air: server computes distance-weighted force vectors against qualifying bodies.  
Heat/ice: thermal scalar changes state thresholds, swaps colliders/material coefficients on a server event.  
Charge: small dynamic conductive adjacency graph recomputed at a capped rate; insulated edges exclude connection.  
Gravity: distance falloff toward/away center with hard max force and concurrency limits.  
Fracture: impact > impulse threshold spawns a limited small number of predetermined shard colliders; decorative shrapnel handled on client only.

## Testing / deploy
- Unit tests shared physics and gesture interpretation; property tests for bounded finite transforms, mass and force limits.
- Local two-client test runner plus browser E2E Playwright, Vitest for protocol/schema, benchmark harness.
- Vercel frontend must use HTTPS; Cloudflare Worker wss:// URL via environment variable; protect CORS/origins as appropriate (Origin not authentication); no hard-coded credentials.
- Staging and production deployments independent; record live URLs and test outcomes, reserve operational configuration secrets for CI or platform dashboard.
- Client tracks WebGL context loss, tab backgrounding, mobile Safari camera pause, screen rotate and sensor permissions.

## Source of truth
This document supersedes temporary prototypes. If implementation reveals a false assumption, update ADR with reproducible evidence and revised trade-offs rather than quietly substituting mock functionality.
