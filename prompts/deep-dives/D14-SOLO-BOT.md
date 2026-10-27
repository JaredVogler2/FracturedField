# DEEP DIVE D14 — OFFLINE SOLO PLAY AND TRAINING AI

**Execute with Phase 10.** Provide a worthwhile single-player route while preserving exactly the multiplayer physics protocol and gameplay rules.

## System contracts
- BotPolicy receives a bounded public-ish Render/Game snapshot and its assigned legal player slot, returns an ActionIntent via same input validation adapter as human. Bot cannot alter transforms, adjust cooldown, read opponent hidden intentions, override scoreboard or sample future random number stream.
- In solo, run authoritative GameWorld in a local Worker or stable main loop with the same package and fixed timestep. Avoid requiring Cloudflare room for solo practice; support offline after app resources cached where feasible.
- Bot visual avatar & VFX indistinguishable from remote human when acting (aside from explicit bot label), and abilities react to same ACTION_ACK + GameEvents.

## Planner baseline
At ~4–8Hz: estimate ballistic core intercept using its position/velocity and available fields; evaluate a small candidate set of PULSE directions/target, GUARD placement to intercept dangerous shot, SWEEP deflection around obstacle, LIFT lob and setup an ice ramp. Cost function balances probability of goal, defense urgency, energy reserve and material combo synergy. Use approx kinematic rollout for cheap candidates; no running dozens of full Rapier worlds in a tight main-frame loop.
- Allow difficulty to vary response delay, target noise, candidate budget, available abilities and strategy sophistication, NOT raw ability magnitude or illegally sped cooldown.
- Watchdog when bot repeatedly fails to act or loops between positions; deterministic seeded fallback to simple legal action. Bot can lose and make mistakes.

## Three training maps
- FIRST CONTACT: one moving core and empty field; objective 3 clean pulses through rift, feedback for aim and force.
- CURVED PATH: wall blocks straight shot, Sweep + Pulse to bend goal; reset/ghost optional.
- PHASE CHANGE: wet patch, freeze into ramp, core ricochet into goal; thermal alternate.
Plus free physics lab with mode reset, seeded objectives and ability quick reference.

## Testing and pacing
Headless run 100+ games per difficulty and record win rate, score, energy, action counts and stalls. Novice must lose more often to decent scripted challenger than Master without cheating; if samples small don't claim precise skill ranking.
On web, solo planner and visual particles fit phone budget. Test 10 consecutive rematches in one tab, no memory growth/renderer leak and no Worker thread storm.

## UX
Practice available from landing without account or invite. Bot difficulty visible, change before rematch. User can switch camera/touch/motion freely. Tutorial gives objective feedback rather than fake animation reward.

## Gate
Offline/local solo matches must be completed using canonical world with legal moves, no server cost; training actually teaches player a trick they can use in online duel.
