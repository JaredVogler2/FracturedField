# FRACTURE FIELD — Claude Code Production Build Program

**Genre:** two-player online physics-bending arena sport + elemental dueling  
**Deployment:** Vercel web client + Cloudflare Worker / Durable Object authoritative match rooms (default); architecture must permit other server adapters.  
**Inputs:** independent device camera/hand and upper-body pose tracking; gyroscope / accelerometer where available; touch, keyboard, mouse, and controller fallback.  
**Rendering:** genuine 3D with Three.js / React Three Fiber, authored/procedural geometry, high-end lighting and performant shader VFX.  
**Physics:** Rapier 3D for bounded rigid-body simulation; custom deterministic, physically informed elemental interactions (NOT falsely claiming full computational fluid dynamics).

> This repository starts as an **implementation instruction pack**, not a completed playable game. Claude Code must write, run, test, deploy, and verify the application in phased increments.

## First action in Claude Code

Open this repository in Claude Code and simply invoke the built-in project skill **/goal** (installed in .claude/skills/goal/SKILL.md). Alternatively, paste this expanded instruction if skills are unavailable:

```text
/goal Read README.md, docs/GAME_DESIGN.md, docs/ARCHITECTURE.md, docs/ACCEPTANCE.md and every file under prompts/ in numerical order. Follow prompts/00-ORCHESTRATOR.md as the standing execution contract. Execute phases sequentially starting with 01, implementing actual runnable code and tests; do not merely summarize the prompts or create a mockup. Commit after each passing phase. Do not advance a phase until its acceptance gates pass or you have documented a concrete blocker. Prioritize playable end-to-end local multiplayer as quickly as possible, then excellent graphics, physics, camera/sensor controls, and competitive depth. Never claim any test or deployment succeeded unless executed and evidenced.
```

## Prompt sequence

| Phase | Instructions | Deliverable |
|---|---|---|
| 00 | [Orchestrator](prompts/00-ORCHESTRATOR.md) | Persistent operating rules and status protocol |
| 01 | [Architecture & feasibility](prompts/01-ARCHITECTURE-SPIKE.md) | Executable architecture, Rapier/Worker spike, CI |
| 02 | [Playable vertical slice](prompts/02-VERTICAL-SLICE.md) | Local two-player physics match with scoring |
| 03 | [Authoritative multiplayer](prompts/03-REALTIME-MULTIPLAYER.md) | Cross-device rooms and synchronized simulation |
| 04 | [Matter & energy physics](prompts/04-MATTER-ENERGY.md) | Interacting elemental systems and counterplay |
| 05 | [Camera/pose control](prompts/05-CAMERA-GESTURES.md) | Local gesture tracking, calibration and mapping |
| 06 | [Phone sensors and fallback controls](prompts/06-MOBILE-CONTROLS.md) | Gyro, touch, accessibility and presets |
| 07 | [World-class 3D visual design](prompts/07-AAA-VISUALS.md) | Art bible implemented, shaders, lighting, VFX |
| 08 | [Game design and replayability](prompts/08-MODES-BALANCE.md) | Rules, modes, progression, strategic metagame |
| 09 | [UX, audio, onboarding](prompts/09-UX-AUDIO.md) | Complete product interface, spatial sound |
| 10 | [AI opponent and solo play](prompts/10-SOLO-AI.md) | Offline-compatible practice, bot opponents |
| 11 | [Performance, QA and security](prompts/11-PERF-QA-SECURITY.md) | Device/network/abuse testing and optimization |
| 12 | [Vercel deployment and observability](prompts/12-DEPLOY-OPERATIONS.md) | Real deployments and reproducible operations |
| 13 | [Adversarial launch review](prompts/13-FINAL-REVIEW.md) | Verified readiness and defect closure |

### Non-negotiables

1. **Two real players on separate devices** must see and change the same authoritative world; no simulated networking.
2. **Gameplay in minutes:** arena, physical energy core, player abilities, goals, timer, score, replay and rematch.
3. **Physics, not spectacle alone:** physical impulses, materials, collisions, state changes and counterplay decide outcomes.
4. **Controls must work** with camera permissions denied, no gyro, low light, single hand, and desktop devices.
5. **Beautiful rendering:** cinematic direction, believable scale and materials, responsive VFX and animations; no default primitive placeholder arena at release.
6. **Security:** do not transmit/store raw camera video or personal biometrics; validated server commands, opaque join tickets, rate limits.
7. **Evidence:** unit, integration and E2E tests plus real two-device manual checks; performance metrics, not unverified promises.

## Document map

- [Game design & numerical tuning](docs/GAME_DESIGN.md)
- [Technical architecture and message protocol](docs/ARCHITECTURE.md)
- [Acceptance matrix](docs/ACCEPTANCE.md)
- [Research/official documentation](docs/REFERENCES.md)

## Engineering realities

- An ordinary phone typically cannot be both handheld for gyro play **and** reliably positioned to see a player's entire body. Provide separate **stand-mounted camera mode**, **handheld motion+touch mode**, and **desktop** options; hybrid only when physically feasible.
- Cloudflare Durable Objects are a strong room server, but active 30–60 Hz simulations must be **benchmarked** under Workers limits. Hibernation is for idle rooms, not continuously ticking live matches. If 3D Rapier/WASM performance proves infeasible within plan limits, document evidence and move to an appropriately hosted stateful Node game service. Keep the Vercel client.
- No custom LLM API required for the core game.
- Use original game art, names and sounds; don't reproduce characters or copyrighted assets from existing elemental fantasy franchises.

## Quality workflow

Each phase ends with: files changed, tests run and their outputs, performance values, screenshots/video where feasible, current deployed URLs if any, known failures, decision log, and the next prompt number. No long speculative monolith. The full specification governs whenever a prompt leaves a detail open.
