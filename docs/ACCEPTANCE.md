# ACCEPTANCE / EVIDENCE CONTRACT

A phase passes only with working code, repeatable tests, and explicit evidence. A polished static mock or simulated multiplayer event is a FAIL.

## Phase gates
| ID | Requirement | Observable pass test |
|---|---|---|
| G01 | clean build | install, typecheck, lint, unit tests, client build in a clean environment |
| G02 | real simulated world | fixed-tick Rapier rigid-body core collides and interacts with terrain; not keyframe animation |
| G03 | minimum fun loop | two input sources, real-time core manipulation, goal sensor, timer, scoreboard, reset, winner, replay |
| G04 | true remote multiplayer | two phones/computers on different networks with independent players join room and see identical final score/collisions |
| G05 | authority / cheat rejection | forged goal, extra energy, out-of-bounds target and impossible force rejected server side |
| G06 | camera interaction | browser camera detects hands and gesture start/hold/end; no camera frames leave client; tracked/denied/lost transitions |
| G07 | alternate device inputs | touchscreen, mouse/keyboard and gyro via permission flow; iOS denies sensors without breaking gameplay |
| G08 | element interactions | at least 8 specified physical reactions tested for gameplay effect and counters |
| G09 | exceptional 3D quality | production-art-quality environment with bespoke materials, atmospheric effects, high readability, lighting/polish comparisons |
| G10 | sustained performance | no server tick backlog and no catastrophic client stutter in instrumented stress test; quality adapts |
| G11 | accessibility | reduced motion, flashes, color-blind shapes, subtitles, rebind/remap; avoid mandatory strenuous gestures |
| G12 | fail-safe reconnect | drop/rejoin, state restore, duplicate actions and timeout are correct |
| G13 | production deployments | Vercel URL with functional live match Worker, no localhost or secret hardcoding |
| G14 | E2E | scripted fixtures + live test protocol for remote devices with logs/screenshots |
| G15 | privacy and security | media local, CORS/origin checks, token authorization, rate limits, no XSS injection or leaked secrets |
| G16 | retention | compelling multi-round play, immediate rematch, skill diversity and replayable practice loop |

## Reference testing scenarios
- S01: 2 browser tabs, independent controls, both shoot Core toward goal; identical scores.
- S02: two physically separate phones over distinct networks (Wi-Fi + cellular), join via link; remote manipulations visible on other screen; compare authoritative state hash and scoreboard after round.
- S03: 150 ms RTT + 2% loss + jitter; no divergent authoritative scores; local ability feedback responsive, recover smoothly.
- S04: repeated action 10x allowed rate + enormous force + NaN intensity; gracefully reject, log metrics, do not crash.
- S05: moving core collides with stone barrier, impulse changes velocity, barrier fractures when threshold reached.
- S06: wet stone conducts charge; dry stone does not; clear telegraph.
- S07: freeze water into ice collider; fire reverts ice into water; core bounces then drags appropriately.
- S08: overlapping wind fields superpose under global cap; core cannot accelerate past max speed.
- S09: goal trigger crosses wrong direction and partially overlaps => no score.
- S10: camera access denied; user can immediately use touch-only control and complete match.
- S11: iPhone Safari permission request is user-gesture-initiated; denied gyro does not block touch gameplay.
- S12: camera loses hand for 200 ms vs 2 s; short dropout gracefully smooths, long dropout cancels held actions and prompts recalibration.
- S13: browser refresh in live round; rejoins via resume ticket with energy/score intact, world state remains authoritative.
- S14: active player backgrounds app; graceful interruption, partner gets pause/no free unfair goal; recovery or timeout works.
- S15: round result 3:2 and timer expires at same tick; deterministic tie/round rules and duplicate goal events once.
- S16: opponent cannot join with 3rd-party room code as existing player without valid seat credential.
- S17: reduced-motion & low-effects mode visibly remove expensive flashes/camera jolts and keep competitive cues.
- S18: server benchmark for 1, 10 and 50 rooms simulated offline (when resources permit); document p50/p95 tick CPU and worker budget suitability rather than fabricating measurements.
- S19: local solo game without network works from same physics protocol/action abstraction.
- S20: visually compare final game with target images / art specification at mobile and desktop viewports; independently critique amateur-looking composition, generic materials and tiny unreadable objects.

## Quality metrics (targets)
- Render: 60 FPS good desktop; 30+ FPS modern mid-range smartphone during busy effects; degrade quality before degrading responsive input.
- Sim: 30 fixed steps/sec without persistent tick overrun in intended initial deployment.
- Network: 20 snapshots/sec baseline, input messages batch at 10–20 Hz plus ability edges; monitor bandwidth and frame size.
- Latency: instrument measured input-to-visible-cosmetic, input-to-authoritative-effect, remote effect, jitter, reconnect time and stale snapshots. Performance targets in docs/ARCHITECTURE.md are aspirations until tested.
- Failure budget: zero unhandled exception in normal match, zero divergent scoring, zero camera leaks, no permanent blank screen on WebGL context loss.

## Evidence artifacts per phase
Produce docs/progress/PHASE-XX.md with:
1. scope completed / files added,
2. commands actually run and compact output,
3. test coverage with pass/fail,
4. measured timing/fps/bandwidth if applicable and conditions,
5. screenshots or video links only if really captured,
6. unresolved defects and their severity,
7. next-phase readiness, decision log,
8. links to commit and deployment if actually created.

Do not mark work as verified by merely reading code. Distinguish automated from physical-device testing. If unavailable, explicitly mark as NOT TESTED rather than PASS.
