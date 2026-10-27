# DEEP DIVE D12 — GAME DESIGN, STRATEGY, COUNTERPLAY AND RETENTION WITHOUT PAYWALLS

**Execute with Phase 08.** A fun match is a strategic contest of aim, forces, environment and resources, not 100 flashy spells fired rapidly. Prove what makes it worth replaying.

## Gameplay model
Three rounds of 90s, core must reach opposing rift gate. Initial 3 basic abilities simple for first-time user, unlock temporary two-element tactical kit after tutorial; each action has force envelope, cost and recovery. Scoring depends on genuine collision trajectory. Terrain is reactive, not cosmetic.
- Opening: score in first 10–20s is possible but requires deliberate movement; both players have equal access to defensive tool.
- Mid-match: create trap by freezing pool/setting barrier/wetting conductor; opponent has visible counter opportunity. Bounded persistence prevents arena gridlock.
- End: energy tension, last-second saves, controlled climax, no arbitrary random spell to gift winner.

## Ten testable skill moments
1. Direct goal with well-aimed Pulse.
2. Bank the core off a wall.
3. Curve a shot with Sweep.
4. Defend by placing Guard and then counterattacking.
5. Use Lift for lob over shield.
6. Freeze wet pool into a ramp and bounce core.
7. Heat-melt ice ramp to disable opponent path.
8. Wet + electrify metal chain to temporarily overcharge opponent's guard.
9. Use gravity to deflect a fast shot into a ricochet.
10. Make fire-wind steam screen then aim through it by anticipating momentum.
Each must be achievable using regular in-game inputs in a seeded training or match scenario, not just storyboards.

## Match balancing
Implement a headless tournament tool: 100–1000 seeds with novice/adaptive scripted bot policies, collect median goals, 95th-percentile round duration, distribution of ability use, energy downtime, score rate, stalemates, advantage by spawn/team, win rate by loadout. Make rules editable from config and record every change. Headless metrics are heuristic, not human fun proof.
Fight abuses: permanently trap core, spam cheapest impulse, win only through gravity, barrier placement in goal trigger, freeze all playfield, fire all field effects to slow server, one player can't recover after concession. Add field caps, decay, anti-stalemate restart with fair notice.

## Player playtest protocol
At least 3 human test sessions if available: novice vs novice, novice vs experienced, camera vs touch. Ask after each:
- Could you infer goal/rules?
- Did your commands feel connected to world movement?
- Did you understand why you lost?
- Which two moves were most satisfying?
- Could you attempt a new tactical idea?
- Would you rematch without a reward?
Track observations separately from surveys and implement top friction reductions.

## Meta systems
Instant rematch, best moments of game, local personal best stats, skill challenges and optional Chaos arena with rotating physical modifiers; avoid battle pass, cash purchases, daily streak compulsion, or any mechanic impairing fair control. Invite codes are all that's needed for first release.

## Gate
At least five real combos reproducible, meaningful counterplay for all expensive abilities, no frequent stalemate in tournament and evidence of actual user playtesting where access exists.
