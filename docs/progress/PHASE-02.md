# PHASE 02 — Playable local RIFTBALL vertical slice (with D02)

**Status: COMPLETE** for the local (single-device) game. Online play is Phase 03; nothing here is
claimed as tested on physical phones.

## Objective

A human can finish a fun RIFTBALL match in a browser: start → input → physics → score → win →
rematch, with two independent input adapters and a scripted bot, driven by the same authoritative
`GameWorld` the server runs (only the session driver will change in Phase 03).

## What was built

| Area | Implementation |
|---|---|
| Local authority | `apps/web/src/net/sim.worker.ts` + `worker-session.ts`: the shared `GameWorld` (+ snapshot bots) runs at a fixed 30 Hz in a dedicated Web Worker and streams the same snapshot/event/ack messages a remote room sends. Fixes the Phase 01 main-thread starvation. |
| Match rules | Lobby → countdown (3 s) → playing → goal pause → round end → match end; 90 s rounds, first to 3 goals, best of 3, Golden Rift (45 s sudden death), deterministic finite tiebreak (territory → draw rounds → total goals); seeded kickoff; kickoff ability shield. |
| Abilities (all real physics) | PULSE radial impulse with falloff (Δv = J/m); LIFT spring field, energy drain, auto-release; **SWEEP crosswind** (see decisions); GUARD fixed barrier collider with lifetime, durability, placement rules; energy 100 / 10 per s with post-spend regen delay; per-ability cooldowns + global lockout. |
| Input | `apps/web/src/input/manager.ts`: per-seat `IntentEmitter` (one sequence space), screen-relative keyboard steering with local reticle prediction, absolute mouse aim via raycast, touch drag aim + thumb buttons, focus/visibility release of held abilities. Bindings: solo, duel P1 (WASD/Space/LShift/Q/E/F), duel P2 (arrows or IJKL / Enter / RShift / , . /). |
| Bot | `packages/sim/src/bot.ts`: snapshot-only opponent (easy/normal/hard) using legal intents only. |
| Product UI | Live attract match behind the main menu; Quick match vs bot (difficulty), Local duel (2 players, 1 keyboard), Controls and Settings (sound, volume, quality, reduced motion/flashes, dev HUD); ready gate; HUD (scoreboard, clock, round pips, Golden Rift, energy with cost ticks, ability chips with key labels/cooldowns/denied flash); queued banners (countdown, GOAL, round result, Golden Rift); deny toasts; pause (Esc/P); match-end panel with rematch; in-memory session history; sound toggle (M). |
| Feedback (authoritative events only) | Pulse shockwave rings, impact sparks scaled by impulse, guard rise + break shards, goal ring wave + burst + membrane pulse + camera shake (off in reduced motion), kickoff flash, crosswind streak fields showing the true wind direction, lift tether, velocity trail on the core, approximate aim preview (no rebound prediction), local reticle. |
| Audio | `apps/web/src/audio/sfx.ts`: original WebAudio-synthesised SFX, stereo-panned by arena x, triggered by authoritative events only. |
| Arena (D02 visual bar) | Unique procedural flagstone floor with grout, bevels, veins and brass inlays; walls with brass rails; fluted pillars; arched rift gates with animated membranes; dark stone **wielder plinths** with team-shaped inlays; underside ribs; storm sky + PMREM image-based lighting; shadows; restrained bloom. Near gate structure is hidden when the camera looks from behind it (portrait), and the camera reserves the HUD band on short landscape screens. |

## Design changes forced by testing (adversarial review)

1. **SWEEP redesigned from vortex to crosswind.** A test showed a pure vortex barely curves a
   passing core (its sideways push is antisymmetric along a straight pass and cancels). A bounded
   uniform crosswind bends shots predictably, scales with mass (wind is a force), and opposite
   winds cancel exactly (R9). Keys blow "screen up/down"; the intent carries an explicit direction.
2. **Lift → pulse lob fixed.** Pulsing a lifted core used to yank it back (carry spring beat the
   impulse). A pulse now releases the caster's own lift, and pulses on elevated bodies loft them
   into a ballistic arc (the "high shot" over barriers).
3. **Guard overlap bug fixed.** Placement checked only Rapier's broad-phase, which is stale after a
   teleport; moving bodies are now tested against the barrier's OBB using true positions.
4. **Impact event spam fixed.** Resting boulder support exceeded the report threshold every tick.
   Reports now require ≥ 2.2 × the lightest body's weight impulse, with per-pair de-duplication.
5. **Anti-stall "Meridian drift".** A browser autopilot revealed rounds stalling with a dead core
   deep in the opponent half, out of the attacker's reach. A slow, idle core now eases back toward
   the centre line (≤ 1.1 m/s², only below 3 m/s, beyond 4 m) — symmetric and irrelevant to shots.
6. **Ready-before-init race fixed** (clicking Start before the worker's physics loaded never
   started the match) and **banner queue** (a goal that also won the round never showed GOAL).

## D02 representative shots (seed 5, 30 Hz) — `packages/sim/test/shots.test.ts`

| shot | launch speed (m/s) | peak height (m) | impacts | result | note |
|---|---|---|---|---|---|
| direct | 14.64 | 1.25 | 0 | GOAL slot 0 @ tick 42 | Δv = 118 N·s / 8 kg |
| bank | 14.64 | 1.25 | 1 | GOAL slot 0 @ tick 89 | side-wall rebound |
| curve (control, no wind) | 14.64 | 1.26 | 3 | no goal | z at x=19: 4.17 |
| curve (crosswind) | 14.45 | 1.26 | 0 | GOAL slot 0 @ tick 43 | z at x=19: -0.29 |
| guard ricochet | 14.64 | 1.25 | 1 | no goal | min vx -11.15 m/s after barrier |
| lob (control, flat) | 14.64 | 1.26 | 1 | GOAL slot 1 @ tick 139 | stopped by barrier, rebounds the length of the arena |
| lob (lift → pulse) | 13.15 | 4.36 | 1 | GOAL slot 0 @ tick 60 | apex 4.36 m |
| save (control, no defender) | 13.00 | 1.15 | 0 | GOAL slot 1 @ tick 32 | goal-bound shot |
| save (defender pulse) | 13.00 | 1.15 | 0 | no goal | core vx after save 1.24 |

## Commands executed and results (2026-10-27)

```
pnpm typecheck            # exit 0
pnpm lint                 # 0 problems
pnpm format:check         # clean
pnpm test                 # vitest: 8 files, 87 tests passed (match rules, shots, determinism, restore, protocol, room, controls)
pnpm test:e2e             # playwright: 7/7 passed (2.4 min)
pnpm test:worker          # live DO room checks: 21/21 PASS (RTT loopback p50 1.69 ms)
```

E2E highlights (`e2e/phase02.spec.ts`):
- **Local duel, full loop with real input:** an E2E "player" moves the real mouse (reading only the
  public snapshot) and clicks to pulse; it scores real goals, wins 2–0 under fast local rules
  (`?fast=1`: 1 goal per round), the match-end panel shows PLAYER 1 WINS, and Rematch restarts at
  round 1 with no reload. No score is injected anywhere.
- Two keyboard adapters steer both seats simultaneously (P1 `W`, P2 `↓`).
- vs bot: keyboard steering moves the force point; the clock runs.
- Menu over the live attract match; Controls and Settings dialogs.

Rule coverage (`packages/sim/test/match.test.ts`, 26 tests): kickoff timing and shield; goal once,
correct scorer, field reset; wrong-direction / grazing never scores; round win at 3; match win +
rematch reset; Golden Rift; territory tiebreak; clock win; S15 goal on the expiry tick; energy,
cooldown, lockout, regen delay; not-playing and stale-sequence rejection; manipulator speed cap and
half clamp; guard block, expiry, placement rules, oldest retired; lift raise/drain/release, out of
range, disconnect cancel; crosswind curve, mass scaling, R9 cancellation; superposed opposed pulses;
anti-stall drift.

## Screenshots (real renderer; headless Chromium + SwiftShader, not device performance)

`docs/visual-evidence/phase-02/`: `desktop-{kickoff,approach,pulse,sweep,lift,guard}.jpg`
(1920×1080 high), `phone-landscape-*.jpg` (844×390 low), `phone-portrait-*.jpg` (390×844 low).

Readability review at phone sizes: both goals, the core, both force points, the clock and score are
visible without overlap after moving the camera fit above the HUD band (landscape) and hiding the
near gate superstructure (portrait). The arena occupies the middle third in landscape — acceptable
for the slice; Phase 06 owns compact/collapsible mobile HUD and handedness layouts.

Critique vs docs/CREATIVE_TARGET.md (honest — not final art):
- Still reads as a well-lit procedural arena, not a premium title: walls are boxes, gates are
  primitive assemblies, no sculpted platform edge or storm horizon depth (Phase 7A/7B).
- Ability VFX are flat rings/lines/points; they narrate real events but lack volume (Phase 7C).
- No characters on the plinths yet (Phase 7D). The core is legible but small at broadcast distance.

## Not tested / limitations

- No physical phones, no GPU frame-rate measurements (SwiftShader only).
- Touch controls exercised only by code review and layout capture, not on a real touchscreen.
- Local duel on one touch device (split controls) is not provided; touch is single-seat vs bot.

## Reproduction

```
pnpm install && pnpm dev     # http://127.0.0.1:5173
# Quick match vs bot, Local duel, or deep links:
#   /?mode=bot&difficulty=hard   /?mode=duel   /?mode=duel&fast=1&seed=4
```

## Next instruction

Phase 03 (prompts/03-REALTIME-MULTIPLAYER.md + D03): client `RemoteSession` over WebSocket to the
Durable Object room, lobby/invite UX, interpolation tuning, ping/RTT, reconnect, lag/loss
integration suite, browser E2E create → invite → join → both ready → goal → rematch.
