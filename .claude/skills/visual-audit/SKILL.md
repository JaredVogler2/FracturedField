---
name: visual-audit
description: Inspect and materially improve the actual FRACTURE FIELD 3D game graphics using screenshots, professional art criteria, and performance evidence.
disable-model-invocation: true
---

# /visual-audit — production art review and improvement

Read docs/CREATIVE_TARGET.md, docs/BUILD_ORDER.md, prompts/07-AAA-VISUALS.md, prompts/deep-dives/D07-ENVIRONMENT-ART.md through D11-VISUAL-REVIEW-LOOP.md, the actual rendered scene source, and existing visual evidence. The game must remain PLAYABLE and physics-authoritative.

1. Start the running client and, if possible, capture golden scenarios for hero arena, core, simultaneous casts, water/fire, ice impact, gravity field and goal, at desktop and smartphone viewports.
2. Evaluate architecture/silhouette, high-frequency geometric detail, PBR material sophistication, contact lighting/shadows, atmospheric depth, core detail, original character animation, meaningful elemental effects, UI readability, phone FPS. Contrast what you see against docs/CREATIVE_TARGET.md.
3. Record weighted rubric score and identify TOP THREE actual deficiencies; refuse to call placeholder boxes, glowing primitives, flat water or stiff capsules final art.
4. Modify geometry, shaders, materials, model pipeline, camera placement, character rig/animation, VFX or quality tiers to address the top deficiencies. Produce code, not only critique.
5. Rebuild/test, re-capture and compare visually; make second iteration when beneficial. Include mobile performance/overdraw and avoid any regression in simulation, hitbox authority or touch usability.
6. Save documented before/after evidence or precise NOT CAPTURED blocker, measured performance where possible, updated docs/ART_AUDIT.md; commit and push if available.

Return the actual source commit, changed modules, tests, images captured and remaining shortcomings. Do not fabricate screenshot, benchmark or device validation.
