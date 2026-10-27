---
name: goal
description: Execute the Fracture Field 3D multiplayer physics-game build program one validated phase at a time.
disable-model-invocation: true
---

# /goal — BUILD FRACTURE FIELD

Operate as the lead implementation agent. This is a command to WRITE and TEST game code, not merely propose it.

1. Read CLAUDE.md, README.md, prompts/00-ORCHESTRATOR.md and docs/BUILD_STATUS.md, then inspect actual git state and existing code.
2. Determine earliest uncompleted phase among prompts/01-ARCHITECTURE-SPIKE.md through prompts/13-FINAL-REVIEW.md. Read the relevant prompt and supporting docs in full.
3. IMPLEMENT that phase end to end, iteratively, using available tools. Produce runnable code, automated tests and a build. Do not spend an entire run only outlining implementation.
4. Use original game assets, safe dependencies and official documentation. Real websocket authority, server physics, camera/gyro paths, and visuals must be demonstrable.
5. Run tests honestly. Record exact results and uncertainties in docs/progress/PHASE-XX.md and docs/BUILD_STATUS.md. Commit validated code and documentation.
6. If phase is not complete, focus on fixing failed gates; don't prematurely skip ahead.
7. Continue to the next phase only when current acceptance gates pass; for long sessions prioritize small, cohesive commits and resumed progress.
8. At the end report user-facing concise phase status, working commands, any legitimate blockers, commit SHA and next action.

Optional user-added constraints: $ARGUMENTS

Critical: No manufactured tests, remote device claims, production URLs, screenshots, benchmarks or fee estimates. If provider credentials absent, implement locally and identify minimum next steps. Preserve working code. The objective is a world-class playable 3D game.
