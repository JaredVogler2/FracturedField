# PROMPT 10 — PRACTICE AND BOT OPPONENT WITHOUT THIRD-PARTY AI API

## Mission
Enable satisfying solo play and skill improvement when a friend is unavailable, while preserving the exact same physical interaction rules. Do not introduce a generative-LLM request on every animation frame. A good bot should learn to intercept, set up material reactions, and have an obvious difficulty curve without cheating.

## Core bot architecture
- Define BotInputAdapter implementing the SAME ActionIntent interface as human controls and obeys same cooldown, energy, field placement and limits. No direct mutation of core position, player energy, scoreboard, or physics world.
- The bot receives a legal/perceptually limited snapshot (core position and velocity, visible obstacles/material zones, energy, opponent public telegraphs, elapsed time) rather than reading future player input. Optional reaction delay to approximate human awareness.
- Planner: a fast low-cost finite horizon candidate search using ballistic/force approximations plus heuristic scoring. Candidate actions: pulse vector toward scoring gap, sweep curl, lift/save, place barrier at predicted interception, create ice bank, energy recharge. Select based on expected goal chance, defense, energy cost, field persistence and difficulty-level noise.
- Do not instantiate dozens of full Rapier worlds per render frame. Offload to worker if needed and cap planning calls per second.
- Include recovery from stuck objects, own-goal avoidance, and no instant perfect aiming.

## Difficulty presets
Novice: 300–600ms delay, imperfect shots, uses 2 simple abilities, conservative defense; suitable for onboarding.
Adept: 150–300ms, uses Sweep, Guard and occasional wet/freeze setups; predicts intercept trajectories.
Master: ~80–160ms reaction depending playtest, optimizes energy and uses combo chains; no info advantage or infeasible movement.
Practice partner: non-oppositional ability to reset ball, highlight expected trajectory and drill shots.

## Training experiences
1. First impulse drill: aim/pulse moving core through portal 3 times, wind-off; target reticle and physics vectors optionally visible.
2. Curve shot drill: start with obstacle, use Sweep to bend route, score within limited attempts.
3. Material combo challenge: freeze a pool to create a deflection ramp, then pulse through it; optional wet+electric variant.
4. Defensive reaction drill: bot sends increasingly complicated shots; show last-second save and feedback.
5. Chaos lab free sandbox with pause/resume, reset seed and slow motion in LOCAL single-player mode only; remote server cannot be arbitrarily slowed by client.

## Persistence / economics
- Solo by default runs locally in browser and needs no room billing. Optional challenge record in local storage, no account required; validate and scope persisted data.
- No third-party API key, LLM or expensive hosted inference to operate bot. Model-based policy can be later upgrade if proven superior to baseline on seeded tournament and frame budgets.

## Tests
Bot never sends illegal actions; obeys cooldown; novice statistically weaker than master under identical seeded match suite; bot can score and defend with plausible movement, match completes and rematch works offline.
Stress scenario: low-end phone with bot strategy computation cannot destabilize render or simulation; throttle planner and cap CPU.
Demonstrate one bot attack and one player save on screen with event log; avoid bot acting purely by fake predetermined keyframes.

## Acceptance
S19 (solo), G03 G08, stable across 10 offline rematches. The bot is a genuine game opponent inside the same rules.
