# DEEP DIVE D11 — RIGOROUS VISUAL QA AND CONTINUOUS ART REDESIGN

**Execute as Art Stage 7E and repeat at every later phase.** This is the antidote to game projects that technically work but look like unfinished primitives. You must actually inspect captures, grade flaws and revise source.

## Golden camera capture harness
Build a deterministic scene capture route /visual-lab with seed, fixed timestep, server snapshot fixture, viewport, quality tier and a clock freeze/resume slider. Support capture scenarios:
1. Hero arena idle with architectural scale.
2. Rift Core near camera at high spin/charge.
3. Both original wielders simultaneously casting opposing elements.
4. Water colliding with fire and steam emerging.
5. Frozen ramp with core trajectory rebound and ice fracture.
6. Gravity well curving metal/stone debris.
7. Goal score with core collapse and portal energy.
8. Phone match moment with all live HUD controls.
Use stable camera positions/time freeze to compare rendered revisions.

## Required viewport captures
1920×1080 high desktop, 1365×768 medium laptop, 844×390 phone landscape, 390×844 portrait, 1024×768 tablet. Capture real running renderer via Playwright screenshot when feasible; if graphics backend/headless fails document and use real-device screenshot. Save optimized contact sheet or manifest + file names under docs/visual-evidence (avoid huge binary files in git without reason).

## Scoring rubric
Per image rate 0–5:
C = readable high-level composition; G = geometry density/original sculpture; M = material detail; L = shadow/color lighting and depth; P = physically driven VFX; A = character silhouette and acting; U = nonintrusive polished HUD; Q = performance/phone clarity.
Weighted 15C + 15G + 10M + 10L + 15P + 10A + 10U + 15Q scaled /100. Keep raw notes and measured FPS separate from subjective art scores.
A phase art pass requires >=80/100 overall AND zero category below 3, with visual proof. If unattainable, document no pass and deficits; don't fudge marks. Aesthetics are evaluated by human reviewer if available.

## Structured adversarial inspection
Ask: Does game look immediately different from a Three.js tutorial? Would this screenshot persuade a player it was a real premium fantasy physics game? Can you see action clearly, not just neon chaos? Is architecture intentional and asymmetric in decoration? Do assets feel physically heavy? Does sky create scale? Do character actions correspond to physics state? Do spells consist of layers / subtle transparencies rather than cartoon solids? Are mobile controls readable without shrinking world into postage stamp?
Choose top THREE weaknesses with evidence and implement targeted fixes; then re-capture and grade. Repeat at least twice during Stage 7.

## Automated screenshot diffs
Use baseline snapshots for invariant placements/HUD safe bounds; know that pixel diffs will be noisy due to GPU variability. Prefer manual scene quality grading plus geometric automated checks on core and goal screen-space size, clipping and HUD overlap. No arbitrary 'visuals good' test assertion.

## Performance tie-in
Every art improvement includes high/medium/low tier load measurement, CPU/GPU frame time if available, draw calls, WebGL context stability, iOS texture issues. Reject beautiful effects that make gameplay too sluggish. Prioritize removing overdraw and improving composition over adding particles.

## Outputs
docs/visual-evidence/README.md with scenes, viewports, environment, camera seed and render settings; docs/ART_AUDIT.md with initial/after review, screenshots references, scored rubric, change commits, residual issues; production material parameters and screens in code.
If screenshots cannot be obtained, list NOT CAPTURED (not "looks great" by assertion).

## Gate
Visual art stage not complete until authored running game materially surpasses simple procedural primitives in side-by-side screenshot review at both desktop and phone.
