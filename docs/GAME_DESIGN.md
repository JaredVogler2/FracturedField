# GAME DESIGN BIBLE — FRACTURE FIELD

## High concept
FRACTURE FIELD is a high-skill two-player real-time physics sport. Each player is a matter/energy manipulator, not an avatar performing canned damage animations. The goal is to **drive a massive unstable reactor core into the rival's rift goal**, using measured gestures or alternate input to deform the physical environment. Fire, water, air, stone, metal, heat, charge, and gravity interact, creating a continually changing battlefield. It should feel like elemental bending meets billiards, air hockey, arena sport, and physics sandbox—with quick rematches and extraordinary visual spectacle.

Original IP: no existing franchise naming, outfits, iconography, music or character likenesses.

## Primary match: RIFTBALL
- One arena, mirrored team halves, a central floating physical **Rift Core**, two large 3D goal portals, two live players. Goals are scored when the core crosses the verified trigger plane in the proper direction and with sufficient penetration.
- Match length: 3 rounds, 90 seconds each; first to two rounds wins. Round winner is first to 3 goals, or most goals when clock expires. Ties enter a 45-second Golden Rift sudden-death; subsequent ties draw if configurable, but ranked rules need deterministic finite resolution.
- Kickoff: 3-second anticipation, symmetric core reset, random seeded slight impulse after countdown; each goal produces a brief cinematic replay (skippable) then a reset.
- Core has world-space mass, inertia, damping, spin, charge, temperature, surface wetness, and momentum; critically it is never just moved to an arbitrary new coordinate by a spell. Goal scoring is server authoritative.
- Players control side-aligned aim reticles/field regions and projected in-world manipulators. They can move around their own half with virtual control; standing physically still must still be playable. Competitive camera POV is a readable angled spectator view, not literal shaky first-person body camera.
- Initial starting roles symmetrical for fairness. Visual player skins/factions can differ, but gameplay loadouts are equal by default. A later opt-in asymmetric draft mode may have tradeoffs.

## Core input vocabulary (abstract commands)
AIM: direction/target derived from hand pose, motion or touch.  
PULSE: forward impulse, scalable through gesture confidence/motion intensity but **clamped for fairness**.  
LIFT: sustained upward force on nearest qualified object.  
DRAW: attraction/drag field toward aim target.  
SWEEP: tangential vortex/wind vector, persistent for a short duration.  
GUARD: rapidly summon barrier of stone/ice with durability and cost.  
INFUSE: apply selected elemental state (heat/cool/wet/charge) to a legal target; state changes impact mechanics.  
FOCUS: charge a limited high-impact move by committed hold gesture; interruptible, noticeable telegraph.
All commands use a canonical ActionIntent schema independent of camera/touch/gamepad.

## Elemental engine
We simulate physically credible causal interactions at game scale. We do not pretend to run full Navier–Stokes, electromagnetism, thermodynamics or molecular simulation. Prefer stable and measurable approximations:
- EARTH: pick up/shove bounded-mass rigid objects, fuse clusters into fragile cover, shatter them when impact impulse exceeds material thresholds. Momentum affects collisions.
- WATER: a small number of pooled/surface patches and particle/VFX representations (not millions of authoritative droplets). Applies drag, buoyancy and wetness. Wet surface reduces stone friction but increases conductivity.
- AIR: a bounded local vector force field which deflects projectiles and pushes the core; directional funnels, vortex patterns, turrets of air.
- FIRE/HEAT: injection of thermal energy; dry objects, weaken ice, create steam where wet, alter softening/breakage; visual fire is sampled from authoritative fuel/temperature state.
- ICE/COOLING: latent heat style threshold; turn water regions into collision-capable ice plates with brittleness, melt back under sustained heat.
- METAL/ELECTRICITY: conductive metal bodies and wet trails connect graph edges; charge propagates locally with fixed cost and attenuation, e.g. stuns an active shield briefly or accelerates a charged core through a field.
- GRAVITY: rare, high-cost spherical directional force/well, capped duration and magnitude, counterable via barriers and timing. No actual spacetime simulation.
- STEAM/FOG: temporarily occludes aiming and visibility locally, applies limited lift/pressure effects but never disables essential accessibility targeting.

## Interactions worth mastering
1. Water + cold -> ice ramp that physically redirects the core.
2. Water + electricity -> conductive zone that briefly overloads a shield.
3. Earth barrier + wind -> redirects airflow and core trajectory.
4. Heat + water -> steam burst causing lift and concealment.
5. Metal + charge -> temporary electromagnet-like attraction/repulsion in limited radius.
6. Ice + impact -> brittle fracture and sharp audiovisual feedback.
7. Gravity + launched rock -> curved ballistic trick shot.
8. Whirlwind + fire -> burning vortex with dangerous pathing but finite energy/time.
Each combo must have server-owned causal state, predictable counters, visual telegraph, and a regression test.

## Energy and fairness
- Shared base manipulation meter on each player: default max 100 units, regen 10 units/s; tuned by telemetry, not hard-coded throughout the codebase.
- Representative starting costs (tuning data, not final balance): PULSE 10; LIFT 6/s; DRAW 7/s; SWEEP 24 for 2 s; GUARD 28; INFUSE 18; GRAVITY 55 for 1.2 s; FOCUS 45 after 0.7 s charge. Global launch rate caps, 0.15–0.4 s move lockouts as appropriate.
- Competing abilities must never arbitrarily teleport or freeze the core. Ownership of field forces is temporary, not an exclusive lock; simultaneous actions superpose under fixed caps.
- Add readable telegraphs, counters and brief invulnerability after a goal reset. Anti-spam resource regeneration incentivizes creative and skilled play.
- A player with one hand or alternate controls must have access to identical move capabilities; camera inputs should not confer statistical raw power advantage.

## Arena layout / environment art
A suspended ancient-engineering ring built above a vast stormfront, architecturally distinct from famous IP. Cracked black basalt, silver-rimmed mechanical rings, glass-like runic energy veins, volumetric shafts of mist, dynamic storm cloud horizon; looming cores, bridges and fractured monoliths.
- Competitive geometry must remain legible from a phone: distinct silhouettes, high-contrast player colors, broad pathways, uncluttered center.
- Physically meaningful cover plates, 5–15 movable obstacles, a limited number of destructible chunks (LOD bodies at low settings), asymmetrical decoration but symmetrical collision map.
- Camera should show both goals and core location; on mobile responsive framing and an offscreen indicator for fast events.
- Level evolution: periodic predetermined 'fracture events' reshape cover or light dynamic hazards without deciding victory by chance.

## Player delights and retention
- Skill expression: bank shots, timed counters, chained material transformations, defensive saves, coordinated multiple forces, clever rebound geometry.
- 6–10 minute session with short submatches and an immediate rematch flow.
- Accessible Quick Duel, Invite Friend, Practice, Tutorial, and optional Chaos Laboratory with altered physics; eventually seasonal maps and cosmetics.
- Persistent stats stored only if infrastructure is warranted; guest matchmaking without signup first. No pay-to-win.
- Highlight moments: last-second save, chain-reaction goal, triple deflection, synchronized counters; local replay via low-bandwidth action log and snapshots.
- Modes must not be invented at the expense of shipping a single complete, fun, polished RIFTBALL match.

## Teaching without tutorials-as-text
- 30-second single-player training: move core with Pulse, bend around obstacle with Sweep, build ice ramp, block enemy shot, score goal.
- First-match contextual cues, diegetic move glyphs, color-coded force vectors, short haptic/audio feedback.
- Motion gestures are intentionally forgiving; user must never be forced into excessive physical exertion.

## Ethical, safety and user experience
- Friendly motion-range calibration; avoids requiring punches, jumps, rapid whole-body movements, unsafe physical spaces.
- Privacy-first video: process frames locally, do not upload; do not collect physiological/biometric profiles.
- Flash, camera shake, particles, motion intensity all configurable; accessible colorblind shapes, reduced motion and touch fallback.
- Gameplay theme prioritizes mastery, delight, and experimental discovery, not monetized addiction loops.

## Final release definition
A first-time player can open a link, learn 3 moves in under a minute, play a full smooth two-device match with matter transformations, score, rematch and have a strong reason to experiment again.
