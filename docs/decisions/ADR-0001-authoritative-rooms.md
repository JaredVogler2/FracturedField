# ADR-0001 — One authoritative room per match: Vercel static client + Cloudflare Durable Object

- **Status:** Accepted (Phase 01, 2026-10-27). Re-open on production evidence (see "Revisit when").
- **Deciders:** implementation agent, per prompts/00-ORCHESTRATOR.md and docs/ARCHITECTURE.md.

## Context

FRACTURE FIELD is a competitive two-player physics sport. Scores, collisions, energy, cooldowns and
material state decide the winner, so exactly one process must own the simulation for each match.
Players are on different devices and networks; neither can be trusted.

## Decision

1. **Authority:** every match runs in exactly one `RoomAuthority` (packages/room-core) that owns the
   seeded `GameWorld` (packages/sim, Rapier 3D), validates every `ActionIntent`, steps a fixed
   1/30 s tick, and broadcasts snapshots (20 Hz) plus ordered `GameEvent`s. Clients send intentions
   only — never positions, forces, scores, energy or cooldowns (enforced by strict schemas in
   packages/protocol and by the simulation itself).
2. **Default host:** one SQLite-backed Cloudflare Durable Object per invite code
   (apps/room-worker). The Worker routes `POST /api/rooms`, `POST /api/rooms/:code/join` and
   `GET /ws/:code` to `ROOMS.idFromName("room:" + code)`. The Durable Object gives single-threaded,
   globally unique ownership of a room without any coordination service.
3. **Client:** static Vite/React/R3F build hosted on Vercel. It connects to the room service over
   `wss://` using `VITE_ROOM_SERVICE_URL`.
4. **Credentials:** the public invite code only locates a room. Seats require an HMAC-SHA256 ticket
   (`TICKET_SECRET`) bound to room id + slot + generation + expiry, rotated on every HELLO (resume
   with rekey). The Origin header is checked as a browser CSRF guard only, never as a credential.

## Why not Vercel Functions as the room host

Vercel's WebSocket support (GA October 2026, docs/REFERENCES.md) lets a Function hold sockets, but
it does not guarantee that two players' connections land on the same instance or that an instance
keeps in-memory state for the match duration. Two instances each running "their" copy of the world
would be two authorities — divergent scores. Making it safe would need an external coordinator
(pub/sub + a lock), which recreates a Durable Object badly. Vercel therefore hosts only the static
client.

## Evidence gathered in Phase 01 (local, labelled honestly)

- Rapier 0.21.0 runs inside workerd via the documented loader shim (ADR-0002) and produces the same
  100-tick golden output as Node and Chromium (bit-identical).
- 60 s real-time benchmark inside the Durable Object runtime (local `wrangler dev`, NOT Cloudflare
  production): 20 dynamic bodies + 20 regions + 2 WebSocket clients, 1800/1800 ticks in 60.0 s,
  mean tick compute 0.19 ms, 0 dropped ticks, max lateness 17 ms. See ADR-0005 and
  docs/benchmarks/worker-bench-20b-20r-60s.json.
- Platform limits (developers.cloudflare.com, fetched 2026-10-27): Durable Object CPU 30 s per
  invocation, reset by every incoming WebSocket message (configurable to 5 min); 128 MB per isolate
  including WASM; Worker bundle 64 MiB uncompressed (ours: 3.8 MB); global-scope startup 1 s.

## Consequences

- Live matches keep their object resident (a 30 Hz timer prevents hibernation) and are billed for
  duration while live. Idle lobbies use the WebSocket Hibernation API plus a 30 s housekeeping alarm.
- A Durable Object restart mid-match currently falls back to the lobby with seats intact (seat state
  is persisted; a match checkpoint is not yet). Rapier snapshot restore is proven bit-identical
  (packages/sim/test/world.test.ts), so periodic checkpoints can be added in Phase 03/11.

## Fallback / migration path (kept cheap by design)

`RoomAuthority` depends only on an injected `RoomEnv` (clock, secret, persistence, logging) and a
`RoomConnection` (send/close). The Durable Object adapter is ~200 lines. If production shows Durable
Objects cannot sustain 30 Hz Rapier (CPU, cost, or regional latency), the same `RoomAuthority` runs
under a Node `ws` server on an always-on host (Fly.io / Railway / a VM) with sticky routing by room
code. The protocol, client, simulation and tests do not change; only the adapter and the
`VITE_ROOM_SERVICE_URL` target do. Clients are never made authoritative as a fallback.

## Revisit when

- Production Cloudflare CPU-time metrics for a live room exceed ~25% of the per-invocation budget.
- p95 tick lateness in production exceeds one tick (33 ms) under normal load.
- Durable Object duration cost per match-hour exceeds the documented budget (Phase 12).
