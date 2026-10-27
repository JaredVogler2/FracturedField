# PROMPT 08 — PLAYABILITY, REPLAYABILITY AND COMPETITIVE DEPTH

## Mission
Create lasting competitive strategy around emergent physical interactions, not repetitive button spam or cinematic animations. Treat the game as a sport, not an empty effects sandbox.

## Mode priorities
1. RIFTBALL Quick Duel: default 1v1 with invite code, full rounds and best-of-three match, scoring, rematch. Tune deeply.
2. Practice / Element Lab: solo physics playground with goals, dummy challenges, ability demonstrations, time trials and shot replay.
3. Chaos Arena: private unranked modifier playlist with rotating wind direction, low gravity or shifting obstacles; deterministic seeds and clear rules.
4. Later optional: competitive ranked matchmaking only after enough users and moderation/abuse controls exist; do not build massive accounts/infrastructure prematurely.

## Strategic depth
- Make each ability meaningful: Pulse is reliable scoring/deflection; Lift supports lob shots; Sweep curves route; Guard transforms arena geometry; Infuse changes material state and unlocks counterplay.
- Add elemental secondary moves in 2 selectable slots rather than 10 overloaded gestures. Loadout selection works via touch, camera or keyboard without advantage.
- Distinct approaches: rapid low-cost redirection, delayed terrain setup, area denial through ice/water, long-range magnetism, quick reactions via electricity, risky gravity slingshot.
- Reward reactive saves and inventive rebounds. Implement plausible predictable cause -> effect. Reaction order defined, UI communicates combo trigger.
- Counter matrix: guard counters straight impulse but loses to bypassing arc/thermal fracture; gravity redirects shot but expensive/can be counter-steered; heat melts ice but may create protective steam; charge stronger through wet conductor but requires setup. No unbeatable combo.
- Quantify action trade-offs with a simple spreadsheet/csv or tuning JSON: costs, durations, ranges, damage/fracture, response window, expected utility in 10 representative scenarios.
- Tune through simulation and structured playtests. Bot vs bot seeded tournaments (e.g. 1,000 matches) can discover obvious degenerate strategies but human playtesting still mandatory; high win rate should trigger investigation.
- Optional skill input combos: form a wet path with one hand, charge it using second action for conductive propagation; setup-and-payoff allows satisfaction without requiring complex gesture gymnastics.
- No raw gestural speed multiplier beyond bounded intensity; fairness across camera/touch/gyro modes.

## Temporal play rhythm
- 0–3 seconds: kickoff anticipation, clear team colors/goal direction.
- 3–20 seconds: baseline manipulation and first opportunity.
- 20–60 seconds: repositioned cover, meaningful generated fields, reactions set up.
- Final 10 seconds: readable heightened tension, modest sound/lighting escalation without random overpowering mechanics.
- Goal: fast reset/replay, clear scoring, no drawn-out dead time.
- Comebacks from efficient defensive saves and tactical adaptation—not artificially rubber-banded damage.
- Ensure core cannot be trapped forever: bounded speed, contact recovery, optional server-authoritative unstuck reset with clear rules and a cooldown; don't teleport during normal gameplay.

## Replay and discovery
- Event highlights selected from authoritative log by critical deflection, rapid chain effect, close save, very high impulse, scored ricochet; scrub 5–8 seconds via periodic snapshots + input replay if possible.
- End-of-match panel shows score, saves, average shot speed, best combo, ability choices, rematch, shareable nonpersonal highlight link only if privacy/cost sensible.
- Daily challenge seeds optional if hosting requirements manageable; training exercises include trick-shot targets and combo puzzles.
- Cosmetic unlocks strictly visual if added, no energy/performance boosts.

## Balance harness
- Seeded physics fixtures for direct shot, curved shot, barrier defense, frozen ramp, charged wet path, gravity curved shot; snapshot resulting trajectories for regression.
- Bot strategy head-to-head matrices, generate action usage per minute, wins, average goals, score distribution; identify exploitable deadlocks/colliders.
- Tune class winrates/ability impact with confidence intervals, not only gut feel. Record before/after configuration and simulation seeds.
- Human survey 1–5: controls, legibility, perceived fairness, agency, feeling of mastery, fun, rematch desire.
- Minimum honest sample: several full matches of different skill and input modes, log findings; do not claim robust statistical balance from two matches.

## Deliverables
At least 5 complete physical move interactions are compelling in RIFTBALL; 3 training challenges; Chaos Arena with two vetted modifiers if performant; meaningful end-of-round stats; balance tests and source-data-driven tuning; polished menu integration.

## Acceptance
G16, G03, G08. If a move has no meaningful strategic value, redesign it before adding content breadth.
