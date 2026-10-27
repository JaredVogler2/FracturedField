# PROMPT 13 — LAUNCH-QUALITY RED TEAM AND FINAL PRODUCT AUDIT

## Mission
Pretend this is an external studio submission. Your job is to disprove exaggerated claims of completeness, challenge every technical assumption and fix the most consequential failures. Deliver the best polished, physically meaningful, original two-device 3D game possible within practical constraints—not a report calling a partial prototype finished.

## Independent role-based review
Lead game designer: Is Riftball actually fun beyond the first 60 seconds? Does player skill beat random effects? Are there repeatable clever saves and chain reactions? Is there a real rematch incentive? Which move is degenerate or pointless?
Gameplay physicist: Are momentum, collision, field force and thermal state causal? Are interactions merely shaders? Can reaction graph cause NaN, unstable energies, infinite fracture or speed? Does fixed-tick authoritative replay match?
Realtime engineer: Can two mobile devices join over separate networks? Is the room owner truly authoritative? Does a forged message change the world? Are interpolation, stale inputs, reconnect, lifecycle and session tokens correct? Is server CPU sustainable?
Technical art director: Is the arena polished, original, physically grounded and cohesive? Is the Rift Core dramatic, not a glow ball? Are casts materially believable? Does high-end desktop quality look premium and low-end mobile quality still look attractive? Are damage/particle effects responsive to impact forces?
Mobile UX engineer: Can an ordinary user play on an iPhone right away? Does Camera Stand actually have an operable camera viewpoint? Can someone with no permissions still play? Is HUD touch-safe and portrait/landscape behavior coherent?
Accessibility reviewer: Can play in a limited-motion/seated mode? Are goals, timers and color-coded attacks understandable without color/with reduced motion? Can controls be remapped?
Privacy/security lead: Can camera data leak through telemetry? Can secrets appear in frontend bundle? Can room token be stolen/guessed? Can a client forge own victory or affect opponent controls?
QA engineer: Can a complete match be replayed, rematched, resumed and ended repeatedly without leaked workers/sockets/video tracks or crashing WebGL? Do source/tests/docs describe reality rather than aspirations?

## Required audit procedure
1. Fresh clone + install with docs-only prerequisites; run all workspace builds, typechecks, linters, tests, E2E and smoke.
2. Execute docs/ACCEPTANCE.md G01–G16 and S01–S20; include PASS/FAIL/BLOCKED/NOT TESTED with evidence link or logs per scenario. Don't conflate emulator and actual phone tests.
3. Physically or synthetically test adversarial gameplay: 2 opposing simultaneous attacks near score line, 5 overlapping effect fields, water freezing under moving core, charged wet patches, gravity pulling fragments into goal, refresh mid-match, user leaving and rejoining, outdated protocol.
4. Capture required high/medium/low-quality screenshots and video/gifs if feasible. Grade actual output against art rubric, identify and fix top three visual weaknesses; no empty aesthetic promises.
5. Measure worst-case server tick ms p50/p95, client FPS, load time, bytes/active player/min, sensor inference CPU, reconnection; report device and network.
6. Validate cloud config, secret references and deployed URLs. Run public two-device game if access; otherwise call production evidence blocked and provide exact remaining validation plan.
7. Play ten complete matches or run supervised automated matches plus actual human playtests as available; observe win distribution, stalled rounds, input pain points, rematch completion. Adjust cost/cooldowns/aim assist.
8. Review code quality: eliminate dead/demo branches and hard-coded placeholder endpoints, consolidate physics rules, enforce strict typings, cleanup effects/geometry/video tracks, remove stale temporary files and test secrets.
9. Audit content licensing for models, fonts, textures, audio and libraries; ensure no trademark/IP copying. Document asset sources.
10. Add final README quickstart with realistic setup and one-command local development, cloud deploy instructions and supported devices; never obscure unresolved limitations.

## Red-team release blockers
- A player cannot enter a live match with a second independent device.
- Scoring decided on client or diverges across peers.
- Matter/energy abilities only move particle effects and cannot affect real collision/trajectory.
- Camera movement only draws overlay, not normalized actions into game.
- No playable touch/keyboard fallback.
- Arena still presents as bare cubes/placeholder UI rather than cohesive premium-art direction.
- Severe mobile frame stalls or unusable untested permission path.
- Private camera video or raw landmark history sent to network without consent.
- Missing authority rate limits / room impersonation exploit.
- Build broken, app blank, repeated rematch memory leak, or fake production URL.

## Final deliverables
- Playable source in monorepo, deterministic sim unit tests, network integration tests, camera/sensor fixture tests, browser E2E and performance harness.
- Staging/production URLs if actually deployed, not assumed.
- docs/FINAL_AUDIT.md with acceptance matrix, device support, benchmark numbers/method, screenshot comparisons, problem severity, remediation commits, playtest findings and clear GO / CONDITIONAL GO / NO GO verdict.
- docs/OPERATIONS.md with configuration and rollback guide.
- Demo script: two players at separate places each opens URL; join room; one lifts an obstacle, other sweeps core through vortex; fire steams water / ice ramp; saved goal; real score; rematch.
- Product roadmap limited to the highest-leverage remaining features; no bait-and-switch into unrelated huge expansions.

## Hard finishing rule
Do not claim "AAA finished" or "fully multiplayer tested" because the code resembles a feature list. If a launch-blocking gate is missing, state exactly what fails and continue fixing within available tooling. The output is game software and evidence, not a triumphant implementation summary.
