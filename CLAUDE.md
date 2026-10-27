# CLAUDE CODE PROJECT INSTRUCTIONS — FRACTURE FIELD

You are implementing **the actual two-player, browser-playable FRACTURE FIELD game**. This repository began as a prompt blueprint, not completed source code.

START: Read README.md and prompts/00-ORCHESTRATOR.md; then docs/GAME_DESIGN.md, docs/ARCHITECTURE.md and docs/ACCEPTANCE.md. Track phase completion in docs/BUILD_STATUS.md. The one-command launch is the project skill /goal (found in .claude/skills/goal/SKILL.md).

Rules:
- Build and TEST real code, not another plan or UI-only animation.
- Phase sequence prompts/01 to prompts/13. Commit verified incremental implementation, use source control status, document blockers honestly.
- Core physics, scoring and material outcomes are authoritative and never decided by browser cosmetic events.
- Two player seats on DIFFERENT devices share one World via secure WebSockets and match authority; camera processing stays LOCAL, all controls normalize to ActionIntent.
- Camera Stand, handheld gyro/touch and desktop are distinct viable configurations; do not assume a handheld phone can track free hands reliably.
- High-quality real 3D visuals are required, but never at the expense of FPS or collision truth. Build original assets and respect licenses.
- Preserve type safety, performance budgets, accessibility, security, documented cloud cost and baseline tests.
- Do not claim deployment, testing on physical devices, attractive final production art or benchmarks absent executed evidence.
- At every phase write docs/progress/PHASE-XX.md and update docs/BUILD_STATUS.md including commit hash/test evidence.
- If user says continue, resume the earliest incomplete phase instead of starting over or rewriting instructions.

## Expanded build instructions (October 2026)

- Before each phase read **docs/BUILD_ORDER.md**, then implement the phase's *exact* assigned deep-dive companion(s) under **prompts/deep-dives/**. In Phase 07 follow five separately gated art tasks 7A–7E; do not mark visuals complete after a single shader or lighting pass.
- **docs/CREATIVE_TARGET.md** is the mandatory visual quality benchmark: authored environment, physically based surfaces, original animated wielders, detailed Rift Core, meaningful elemental VFX and smartphone readability. Capture and critique actual rendered screenshots, then revise code; never substitute standalone mockup art.
- The authoritative phase table is **docs/BUILD_STATUS.md**; keep it aligned with docs/progress/PHASE-XX.md. Do not introduce an independent competing status truth source.
- Root skill **/goal** should always use the expanded build map and complete one implementable gated unit per run; root skill **/visual-audit** is used for in-game 3D art review.
