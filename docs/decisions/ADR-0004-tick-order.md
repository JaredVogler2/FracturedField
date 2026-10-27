# ADR-0004 — Fixed tick order and input fairness

- **Status:** Accepted (Phase 01; extended in Phase 04 for element regions)

## Decision

The authority advances in fixed steps of exactly `1 / tickRate` (30 Hz). Wall-clock time only
schedules ticks (`FixedRateLoop`, bounded catch-up of 4 ticks, dropped ticks counted) and never
enters integration. Each `GameWorld.stepFixed()` performs, in this order:

1. **Intents.** Drain each seat's bounded queue (max 8 intents/tick/seat). The seat processed first
   alternates with tick parity so neither player systematically wins same-tick races. Each intent:
   strictly increasing `seq` (anti-replay; duplicates/out-of-order are dropped as `stale`), aim
   clamped to the seat's legal half, then ability validation (available, phase matches kind,
   cooldown, global lockout, energy) and application. Tap abilities apply their impulse / spawn
   immediately (pre-step); holds start a sustained field.
2. **Manipulators** move toward their targets at the capped speed (13 m/s for every input source).
3. **Fields.** Lift holds (with energy drain and auto-release), sweep vortices; per-body field
   accelerations are summed and clamped to `maxFieldAcceleration`, then applied as `m·a·dt`
   impulses. The core's levitation field is applied separately.
4. **Physics:** one Rapier step; speed / angular caps; non-finite bodies are recovered (defensive).
5. **Impacts** (contact-manifold impulse ≥ threshold) become events and damage guards.
6. **Goal test** on the core centre (plane crossing, inward, inside the mouth) — `playing` only.
7. **Timers:** effect/guard lifetimes, cooldowns, lockouts, energy regeneration, match clock and
   phase transitions (countdown → kickoff, goal pause, round end, Golden Rift, match end).

Phase 04 inserts the **element stage** (flames, pools, steam, body wet/heat — including ice
collider creation/removal) between steps 2 and 3, adds element fields to step 3 and ice
shatter / stone fracture to step 5; the full order is in
[ADR-0006](ADR-0006-element-model.md#4-element-stage-in-the-fixed-tick-order-extends-adr-0004).

Snapshots are produced after the step (20 Hz remote, every tick locally). Events carry
monotonically increasing ids so clients can detect gaps.

## Determinism contract

Same seed + same per-tick intent log + same runtime/version ⇒ identical `stateHash()` (tested).
All randomness uses the seeded sfc32 `Rng`; Map iteration order is creation order; impacts are
sorted by entity id before emission. Rapier world snapshots restore bit-identically (tested).
