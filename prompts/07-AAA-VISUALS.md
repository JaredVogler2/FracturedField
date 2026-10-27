# PROMPT 07 — BUILD A BEAUTIFUL ORIGINAL 3D GAME, NOT A TECH DEMO

## Mission
Transform the functional 3D prototype into an emotionally impactful, sophisticated, cinematic and readable real-time experience of the caliber a discerning player would willingly share. We want **premium-looking, smooth 3D gameplay within realistic browser budgets**, not misleading claims that browser procedural objects equal UE5. Favor excellent art direction and material/shader craft over raw polygon count. Real-time graphics must remain responsive on phones.

## Art direction
Codename **The Shattered Meridian**: a floating colossal stone engineering monument in the eye of a luminous storm. The playing surface is a broken circular basal platform with sculpted tessellated stone, wet black basalt and worn brass inlays. The reactor is suspended at arena center; concentric cracked halo rings rotate around it as magnetic flux traces its surface. Two ancient opposing rift gates physically anchor the goals. At edges: floating shards, distant rock spires, streaming clouds, a planet-scale sky void. Mood: awe, elemental power, ancient impossible technology, dangerous tension. Palette: blue-white atmospheric shadows, black/polished stone, copper/brass/obsidian, contrasting amber and azure team power, iridescent refracted core. Avoid overwhelming bloom, pure saturated neon everywhere, bland low-poly gray blocks, and copyright-adjacent famous franchises.

## Composition and camera
- Gameplay view 3/4 elevated arena, 35–60 mm equivalent lens feel. Core + both goals clearly in frame; lightweight dynamic camera focus/pan on critical action, no nauseating shaking. Movement easing, collision reframes, cinematic goal shot limited to <=1.5 s, fully skippable.
- Distinguish ground, playable surfaces, non-colliding decor, goal volumes, readable player interaction zones, reticles. Mobile thumb zones must not occlude goals; UI safe framing.
- Teach scale: towers, roughness variation, believable shadow direction, atmospheric perspective and some ground contact.
- Adapt field of view and camera boom by viewport rather than squashing 3D horizontally.
- Materiality matters: physically based metal/roughness, high-quality normals, layered noise, triplanar stone/wear procedural where appropriate, animated emissive cracks / engraved energy conduits.
- Keep goals legible with distinctive arch silhouettes and directional internal light. Team color must have redundant shape/icon cues for colorblindness.

## Environment pipeline
1. Create reusable art components and procedural generators for ring floor, monoliths, barriers, gate arches, fractured fragments and horizon; not just BoxGeometry scattered at random.
2. If using 3D models/textures, use original/properly licensed assets and record attribution/licenses in docs/ASSET_LICENSES.md. Prefer glTF with Draco/Meshopt only if verified mobile support and asset load. No runtime call to arbitrary paid model/image APIs.
3. Author subtle high quality procedural textures/shaders. Use physically motivated lighting, soft shadow, sky environment, ambient occlusion if affordable, selective bloom only emissives, tonemapping, contact shadow tricks, fog and particle-depth fade.
4. Build deterministic aesthetic variation from seeded parameters to avoid asset repetition; visuals do not alter competitive collision geometry.
5. GPU instancing / merge decorations; respect transparent-sorting and overdraw on mobile.

## Signature effects (original high quality)
**Rift Core:** layered refractive shell, turbulent plasma/signed field ribbons, stable collision sphere, animated energy filaments, spin and blur/trail linked to actual velocity, charge state color, thermal effects; trail reflects speed and direction truthfully. High-tier selective distortion, low-tier emissive Fresnel sphere + sparse particles.

**EARTH:** actual rigid body movement. Spawn sculptural jagged rocks with high-quality rough stone and fresh fractured glowing interiors; dust plume emitted from collision impulse event; impact decals scale with force; camera shakes subtle and optional.
**WATER:** convincing curved surface sheet/jet vortex (mesh ribbons, shader flow, normal animation) coupled to coarse server wet zones; droplets mostly GPU particles, collisions controlled by authority events. Refracted highlights and foam where impact occurs. No flat opaque blue cones.
**FIRE:** layered flame tongues and volumetric-appearance billboard particles, heat distortion only high quality; emissive pyro arcs/tendrils, impact ember showers. Physical world only reflects authoritative heat state.
**AIR:** translucent thin spirals, dust motes, subtle local refraction/directional ribbons that reveal vector flow without obscuring core. Field visualization must help a player predict deflection.
**ICE:** translucent frosted surfaces with prismatic edge, crack growth following stress, audible fracture and particle burst on break; collider swap drives visible state.
**ELECTRIC:** branching segmented arcs between conductive nodes/along wet surfaces, localized crackle, readable timing pulses, no seizure-risk full-screen flashes.
**GRAVITY:** subtle lensing/ring horizon & warped particulate orbit path. Accurate center + falloff cue; no wildly distorted camera.
**STEAM:** dissipating soft plume visually and fog-visibility gameplay effect, capped overdraw.
**GOAL:** monumental gate activates, core collapses into controlled implosion, energy waves across floor; match score prominently readable; dramatic but brief.

## Animation / avatars
- Distinct high-quality **stylized humanoid energy-wielder silhouettes** on opposite sides, secondary to physical gameplay. Use a lightweight rig or procedural inverse kinematics for torso/arms/hand approximation, guided by local ActionIntent and accepted events. No requirement to stream full 3D body pose over network.
- Avoid uncanny realistic faces, blank mannequins and default capsules. Capes/cloth may use cheap shader/vertex skinning; no expensive general cloth simulation.
- Grounded anticipation/hold/release/recovery actions; each has a meaningful telegraph so opponents can read commands.
- Use skeletal or simplified proxies at lower quality if necessary, but final aesthetic must remain intentional. Consider seeing hands projected as monumental translucent energy constructs in world space as a striking alternate art identity.
- Procedural idle stance, look-at target, and gesture follow-through. Synchronize combat animation to accepted action and world event time.

## Shader / lighting stack
- Three.js + R3F; custom ShaderMaterial/onBeforeCompile in isolated files; shader compilation fallback tested, no uncontrolled per-frame allocation.
- HDR environment, single clear key light and motivated fill; baked light maps for static geometry where practical, dynamic shadow budget based on tier.
- Temporal artifacts and TAA ghosting avoidance for moving core; postprocessing selective bloom, mild filmic tone mapping, optional vignette; no constant heavy DOF blurring gameplay.
- Ground screen-space detail: puddles, scratches, chips, rim wear, damp areas, cold frost, sparks; ensure aesthetic not too noisy.
- Transparent effects order, alpha premultiplication and mesh layering tested on Safari/WebGL2.

## Fidelity ladder
LOW (mobile constrained): fixed 0.7–0.85 DPR depending load, shadows simplified, sparse particles, no screen-space distortion, reduced effect meshes and draws.  
MEDIUM: moderate DPR, key dynamic shadows, controlled particles, core effects, selected bloom.  
HIGH desktop: high-res geometry, smooth physically-based materials, high particles, soft shadows, sky detail, postprocessing.  
ADAPTIVE: measure sustained FPS and memory pressure, gradual quality switch with hysteresis; don't oscillate.

## Measurable budgets (start targets, adjust with evidence)
- 30+ FPS on stated midrange mobile devices under typical combat, 60 FPS target on reasonable desktop; record specific GPU/OS/browser. Important: no claim of achieving without physical measurement.
- Conservative active draw calls ~100–250 mobile (measure actual), limited transparent full-screen overdraw, physically relevant colliders stable, particles batched.
- Loading stage should be under a reasonable compressed asset budget (~20 MB initial target, smaller mobile desirable); lazy-load quality assets and optional modes; cache compiled shader where practical.
- No shader recompilation in the main hot path, no memory leak across 10 rematches, stable after WebGL context restoration.

## Concrete visual QA method
1. Capture frame at 1920x1080 at kickoff, core impact, earth fracture, heat/water reaction, goal, and overlaid controls.
2. Capture same at iPhone 390x844 and landscape 844x390 and an older mobile quality tier.
3. Evaluate against production-art review rubric 1–5: composition, light, material fidelity, silhouette, VFX integration, coherence, visual hierarchy, text contrast, moment-to-moment readability, motion.
4. Perform **adversarial review**: if environment looks like gray primitive geometry, blocks float without grounded lighting, particle effects obscure mechanics, core looks like a glowing tennis ball, colors are oversaturated, or UI looks like engineer debug overlay, redesign the deficient area before acceptance.
5. Include accurate before/after screenshot comparisons in docs/progress. Where assets aren't possible, document compromise, create high-quality original procedural alternative and do NOT claim equivalent professional output.

## Deliverables
docs/ART_DIRECTION.md with moodboard descriptions, palette hex, material/lighting recipes, asset manifest and licensing; production visuals across all major abilities; adaptive tier switches; GPU profiling and captured evidence.

## Acceptance
G09 G10 G11, no regression on actual remote gameplay. Strong graphics must never depend on disabling authoritative physics or physics interactions.
