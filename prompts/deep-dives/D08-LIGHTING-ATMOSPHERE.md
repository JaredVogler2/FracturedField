# DEEP DIVE D08 — CINEMATIC LIGHT, STORM DEPTH AND PERFORMANCE TIERS

**Execute as Art Stage 7B after the modeled environment exists.** The goal is to make static frames evocative WITHOUT making active play unreadable.

## Lighting direction
Artistic center: storm-break daylight raking from one high side, golden rim highlight on brass, blue/cyan ambient fill, bright fracture core as motivated local glow. Have a real shadow story. Sky atmospheric color grading makes distant props progressively desaturated and lighter. Ground structural detail visible even without emissive shader VFX.

## Render implementation
- Confirm exact Three.js/R3F package versions and use supported WebGL2 renderer baseline; WebGPU optional only if stable cross-platform fallback and no alpha dependencies required. iOS Safari can differ from desktop—test.
- Correct renderer output color space (sRGB output and linear material values), physically reasonable PBR environment, ACES/filmic tone mapping with tuneable exposure.
- Base key directional with cascades or constrained shadow map area; 1–2 critical locally lit hero objects; ambient fill/hemisphere; fake baked static AO where necessary. Avoid lots of expensive dynamic point lights.
- Sky through procedural multi-layer gradient, panoramic environment or custom atmospheric shader; drifting cloud sheets at different distances and speeds; parallax floating debris. Volumetric illusion from ray-marched effects ONLY if budget; 2.5D cloud layers acceptable if art passes.
- Fog layering behind playfield; far silhouettes contrast against environment. Camera depth plane must preserve ability reticle and core visibility.
- Subtle light shafts/dust/glints associated with storm breaks. At release: avoid static fog wall, all-black arena or overblown white portals.

## Postprocessing pipeline
- Optional effect composer with selective emissive bloom and threshold, chromatic aberration if subtle/disabled at mobile, film grain minimal, low vignette; depth-of-field usually off during game, maybe hero intro only.
- Correct alpha, transparent sorting and additive blending. Don't apply heavy full-screen distortion on mobile; dynamic rain/wet specular can use cheap procedural normals.
- Reduce flashing intensity via controlled luminance transitions, disable optional strobes/shake in reduced-motion mode.
- Color-blind alternate opponent cues not reliant exclusively on hue.

## Responsive quality levels
Specify parameter table high/medium/low for DPR, shadow resolution, dynamic lights, particle budget, expensive postprocessing, environmental mesh LOD, real-time reflection quality, fog layers. Implement adaptive tier based on smoothed FPS and low fixed thresholds, with hysteresis >5 sec.
Measure GPU draw calls, shader compilations, geometries, texture memory, effects overdraw; log via accessible dev panel.

## Comparison captures
At least 3 lighting variants (too flat, too dark, selected final), each actual renderer screenshot. Reviewer should be able to infer stage depth and composition without effects firing. Test at desktop 1920x1080 and phone 844x390.
Also record with fire + ice + wet surfaces: highlights should not clip or make colors indistinguishable.

## Gate
Environment evokes scale, depth and premium craftsmanship even when players are idle; 30+ FPS target on tested phone under typical combat. If screenshots are too dark/flat, revise lighting, not just raise emissive intensity.
