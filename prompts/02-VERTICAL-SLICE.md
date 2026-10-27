# PROMPT 02 — A COMPLETELY PLAYABLE LOCAL GAME FIRST

## Mission
Implement RIFTBALL end to end in the web client using two independent input adapters (keyboard/mouse and touch or two-keyboard sets) feeding the exact same authoritative-style simulation APIs that multiplayer will use. A human must be able to finish a FUN match in a browser. Screenshots are not sufficient.

## Mechanics to implement NOW
- Beautifully staged but modest 3D arena viewed at a reliable 3/4 perspective. Two readable illuminated goal portals at opposite ends, central Rigidbody Rift Core, high-quality floor with depth cues, defensive obstacles, a small stylized force marker for each player; no complex avatar modeling yet.
- Core rigid body: 3D mass, inertia, restitution, friction, linear/angular damping, reasonable max speed; collides with posts/walls/obstacles. Accurate collision sensor scoring, one goal exactly once, goal direction verified. The core cannot be teleported as ability effect.
- Local physics step at fixed 30Hz, under control of a local authority driver implementing the interface later used by network worker. Client visuals render frame-by-frame using snapshot interpolation.
- Input adapters: player 1 WASD + pointer; player 2 arrows + IJKL or secondary touch control; remapping is okay. On touch, two screens can each operate their local player later; for the local demo use desktop shared-device and single-player against an easy scripted bot. Both players have the same full capabilities.
- Move set phase 02: directional PULSE (force impulse), LIFT (sustained upward attraction), SWEEP (tangential sustained airflow), GUARD (spawn physical temporary barrier). Shared cost/energy, cooldown, aim line. All forces physically affect core and obstacles; finite clamps and max distance.
- One frictionless player onboarding overlay: PLAY, CONTROLS, QUICK MATCH. Scoreboard, time, pause, round transitions, rematch, sound toggle.
- Baseline feedback: wind ribbons, force pulse ring, expanding shield with sparks, goal explosion. Effects observe actual command acceptance, not client hallucination. Color coding and accessibility.
- Golden Rift sudden death or tie-break according to spec; seeded kickoff after goals, safe reset.
- Recorded local match outcomes (in-memory). No accounts or database necessary.

## Make it feel fun
- Target roughly 4–6s after kickoff to engage the core, avoid sluggish low-force pushing.
- Pulse has crisp pop and visible effect; Guard blocks a shot; Sweep curves trajectories in a way a player can anticipate.
- Skillful save, rebound, multi-touch control or double-deflection must be possible within one round.
- Starting tuning in docs/GAME_DESIGN.md. Move values into data tables for adjustment; no scattered magic constants.
- Add visual aim previews without predicting exactly from an intentionally approximate local visualization; avoid perfect aim assistance which kills mastery.
- Make the core visually striking with layered animated emissive shell and trails; use physically correct collision proxy.

## Quality/testing
- Test force direction, scoring once, right-way goal, energy exhaustion, cooldown, shield lifetime, round transition.
- Script a simulation where player 1 successfully scores; another where a barrier changes resulting trajectory.
- Record video/screenshots if tools permit and critique visual readability at iPhone width. No claim about real remote match (comes phase 03).
- Minimize runtime allocations in update loops; cleanup worlds, event listeners, WebGL objects.
- Build keyboard-only complete game before additional interaction tech.

## Acceptance
Playable start -> input -> physics -> score -> win -> rematch, no cheats. G01–G03. The actual game loop is working and reusable; phase 03 must replace only the session driver, not redesign scoring.
