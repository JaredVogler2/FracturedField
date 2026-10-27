# ADR-0005 — Can a Durable Object run the 30 Hz Rapier authority? Decision: CONDITIONAL YES

- **Status:** Accepted for development; must be confirmed in production (Phase 12).

## Question

Can one Cloudflare Durable Object sustain a real-time 30 Hz Rapier simulation with two connected
players, ~20 dynamic bodies and ~20 element regions, inside platform limits?

## Measurements (executed 2026-10-27)

Host: Linux x64, Intel Xeon @ 2.10 GHz, 4 vCPU, Node v22.22.0, wrangler 4.153.0 (local workerd).

### In the Durable Object runtime (local `wrangler dev`, NOT Cloudflare production)

`pnpm benchmark:worker` → docs/benchmarks/worker-bench-20b-20r-60s.json

| metric | value |
|---|---|
| duration / ticks | 60.0 s wall, 1800 / 1800 ticks |
| mean tick compute | 0.194 ms (aggregate; unbiased) |
| 30-tick batch means | min 0.067 ms · median 0.20 ms · max 0.47 ms |
| per-tick p50 / p95 / p99 / max | 0 / 1 / 1 / 4 ms (quantised to workerd's 1 ms timer) |
| scheduler | 0 dropped ticks, 0 catch-ups, max lateness 17 ms |
| snapshots | 1199 sent per client at 20 Hz, ~2.3 KB JSON each (20 bodies) |
| clients | 2 WebSocket clients, both received all 1199 snapshots |

CPU share ≈ 0.194 ms × 30 / 1000 ≈ **0.6% of one core** per room.

### Offline Node (comparison only — not Worker proof)

`pnpm benchmark:sim` → docs/benchmarks/node-sim-bench-20b-20r.json (same scenario, per room):

| rooms on one thread | per-room tick p50 / p95 | all-rooms tick p95 | share of one core |
|---|---|---|---|
| 1 | 0.10 / 0.46 ms | 0.46 ms | 0.3% |
| 10 | 0.07 / 0.16 ms | 1.45 ms | 2.3% |
| 50 | 0.07 / 0.15 ms | 6.96 ms | 11.8% |

### Platform limits checked (developers.cloudflare.com, fetched 2026-10-27)

Durable Object CPU per invocation 30 s by default (up to 5 min), and **each incoming WebSocket
message resets it**; 128 MB memory per isolate including WASM; Worker bundle 64 MiB uncompressed
(ours 3.8 MB); 1 s global-scope startup; soft limit 1,000 requests/s per object.

## Decision

**CONDITIONAL YES.** The measured compute (~6 ms CPU per wall-clock second of play) is two orders of
magnitude below the per-invocation budget, players' intents/pings continuously reset the CPU
window, and the scheduler held 30 Hz with zero drops for 60 s. Conditions to confirm in production:

1. Real Cloudflare CPU-time metrics for a live room (timers are frozen inside production Workers,
   so in-isolate timing is impossible there; use dashboard/tail CPU metrics).
2. Global-scope WASM instantiation stays under the 1 s startup limit on cold start.
3. Duration billing for resident live rooms is acceptable at expected concurrency.
4. Snapshot bandwidth: ~46 KB/s per client at 20 bodies is acceptable but should be reduced
   (quantised binary / delta encoding) before mobile launch (Phase 03/11).

If any condition fails, apply the ADR-0001 fallback (same RoomAuthority on an always-on Node host).
