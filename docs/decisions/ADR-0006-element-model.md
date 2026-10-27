# ADR-0006 — Element model: sparse regions, loadouts and the element tick stage

- **Status:** Accepted (Phase 04)
- **Context:** prompts/04-MATTER-ENERGY.md, prompts/deep-dives/D04-ELEMENT-REACTIONS.md

## Decision

### 1. Sparse keyed regions, not a grid or particles

Authoritative element state is a small set of **bounded, keyed regions** plus a per-body element
record, all owned by `GameWorld` and replicated in snapshots:

| State | Shape | Cap | Lifetime |
|---|---|---|---|
| Water pool | disc (x, z, r ≤ 3.4 m), depth 0..1, temperature | 8 | 16 s (refreshed by more water) |
| Ice plate | frustum collider grown from a pool (h 0.62 m, top 0.55·r) | one per pool | until melted / shattered |
| Steam | disc rising to a 5 m ceiling, density | 6 | 4.5 s |
| Flame | disc r 1.7 m, drifts with crosswind | 6 | 3.5 s |
| Gravity well | point at 1.15 m, softened pull radius 7 m | per cast | 1.2 s |
| Magnet hold | force point ↔ steel lodestones in 7.5 m | 1 per seat | hold ≤ 3 s |
| Body element state | wet 0..1, temperature, charge, thermal shock, energized | element-bearing bodies only | decays |

A uniform grid was rejected: almost all of it would be empty, it would dominate snapshot size, and
its resolution would never match the 1–3 m scale at which players read the arena. Sparse regions
keep snapshots at ≈ 3–5.5 KB under worst-case load (measured, `docs/benchmarks/node-elements-worst-case.json`).

### 2. Approximations (no claims of scientific fidelity)

These are game rules inspired by physics, chosen to be legible and counterable:

- **Water:** a pool is a shallow liquid proxy: quadratic drag on bodies whose contact point is in
  the disc (`drag 2.0`), wetting bodies at 3/s. No fluid dynamics, no buoyancy beyond the drag.
- **Temperature:** one scalar per pool / body; mixing toward neighbours and relaxation toward 20 °C
  are first-order exponential approaches (never overshoot). Phase changes use **hysteresis**:
  freeze at ≤ −2 °C, melt at ≥ 3 °C, boil at ≥ 100 °C, so a region cannot flicker frame to frame.
- **Ice:** freezing a pool creates a **static frustum collider** (restitution 0.92, friction 0.02):
  a ramp that lofts rolling shots. Melting removes the collider and returns the water; a hard
  impact (≥ 240 N·s) shatters it (keeping 60 % of the water).
- **Steam:** boiling converts water into a steam region that applies a capped lift on the core
  (`coreLift 1.8`) and an updraft on other bodies below the ceiling, and sets the **veil** flag on
  bodies inside it (the server withholds the aim-preview read; the body stays replicated and
  rendered — counterable by moving, guarding elsewhere, or waiting ≤ 4.5 s).
- **Fire + wind:** flames advect with the sum of active SWEEP crosswinds (`windDrift 0.35`) and
  heat what they overlap (70 °C/s); water douses them (4×).
- **Electricity:** CHARGE runs one deterministic breadth-first discharge over a contact graph of
  conductors within slack 0.35 m: liquid pools, steel, the core, and stone only while wet
  (≥ 0.35 wetness). Charge attenuates ×0.8 per hop, stops below 0.12, visits ≤ 14 nodes; ties
  break by zero-padded id so traversal order is stable. Electrified pools become shock zones
  (22 m/s² for 1.2 s); a wet guard reached with ≥ 0.5 overloads (breaks); a lodestone reached
  with ≥ 0.3 becomes an electromagnet for 2.5 s. Dry basalt blocks the discharge.
- **Gravity and magnets:** Plummer-softened inverse-square pulls `a = k·r / (r² + ε²)^{3/2}`
  (ε 1.5 m for wells, 1.2 m for magnets), clamped (24 / 16 m/s²) and zero at r = 0 — no
  singularity, no escape velocity; all bodies still obey the global speed caps.
- **Earth / fracture:** a basalt boulder struck above its threshold impulse splits into ≤ 3
  rigid shards (only if the 20-body budget allows; otherwise the fragments are cosmetic); the
  striker keeps 70 % of its pre-impact velocity when the rock breaks (brittle pass-through).
  Heated stone (≥ 90 °C) that is suddenly wetted or chilled is **thermally shocked** for 8 s: its
  fracture threshold is scaled by 0.45.

**Energy is injected, not conserved.** Every element change is caused by a player ability that
costs player energy (the game resource) and adds external impulse or heat to the world. The
simulation never claims mechanical or thermal energy conservation across a cast; it only
guarantees finite, capped, deterministic outcomes.

### 3. Loadouts: base kit + two picks

Every seat always has **PULSE, LIFT, SWEEP, GUARD and INFUSE** (INFUSE `modifier 0` = water,
`1` = heat — one ability, two elements, so nobody needs a separate WATER/FIRE key). Each seat
picks **two advanced moves** from FREEZE, CHARGE, GRAVITY and MAGNETIZE (FOCUS/DRAW are defined
but unavailable). Picks are sent with READY, validated by the authority (`setLoadout`: distinct,
available, implemented; refused during live play) and are public in the lobby and HUD. A move
outside the seat's loadout is refused as `not_available` at no cost.

| Move | Kind | Energy | Cooldown | Counter |
|---|---|---|---|---|
| INFUSE (wet / heat) | tap | 18 | 0.8 s | freeze the water, douse the flame, move the shot |
| FREEZE | tap | 22 | 1.2 s | heat melts the ramp; impact shatters it |
| CHARGE | tap | 20 | 1.2 s | keep stone dry, stay off the chain, guard away from water |
| GRAVITY | tap, 1.2 s well | 55 | 6 s | wait it out (short), shoot outside its 7 m radius |
| MAGNETIZE | hold ≤ 3 s | 8 + 9/s | 1 s | lodestones only; interrupt the line, guard, or charge-race |

### 4. Element stage in the fixed tick order (extends ADR-0004)

1. intents (validate → apply casts: pools, flames, freezes, discharges, wells, holds)
2. manipulators move (capped speed)
3. **element stage**: flames drift with wind and heat; pools mix, relax, freeze / melt / boil
   (collider creation and removal happen here); steam spreads and thins; bodies wet, dry, cool
4. sustained fields summed and clamped per body (hover + steam lift, lift, sweep, magnet,
   energized lodestones, gravity wells, pool drag, shock zones, steam updraft) → impulses
5. Rapier step
6. impacts → guard damage, ice shatter, stone fracture (pre-impact velocity kept for
   pass-through)
7. goal test (core centre crossing inside the mouth — element regions never create triggers)
8. timers, cooldowns, energy, clock

Every state transition emits exactly one canonical `reaction` event (`soak, ignite, chill, freeze,
melt, boil, douse, shatter, fracture, quench, shock, overload, energize, well`), tested to fire
once even when both players repeat the cause on consecutive ticks.

## Consequences

- Every reaction changes server-owned state (collider, velocity field, resource or visibility
  rule); R1–R10 fixtures prove each one changes a scoring trajectory versus a control.
- Determinism holds (same seed + intents ⇒ same hash); checkpoints include all regions and body
  element states, so Durable Object rehydration and the Lab's rewind restore them exactly.
- Worst-case cost is small: p99 step ≈ 0.6–0.9 ms (Node, this container) and ≈ 2 ms quantised
  (local workerd) against a 33 ms tick (see PHASE-04 for the exact runs and their limits).
- Renderers must only *read* this state; VFX quality tiers may thin particles but must never hide
  a region that affects play.
