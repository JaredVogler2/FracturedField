# FRACTURE FIELD — VISUAL AND EXPERIENCE NORTH STAR

## Vision
An original third-person cinematic elemental physics arena sport. The camera looks over an immense suspended fractured platform while two distinct wielders manipulate a living world of momentum, matter and energy to score with a singular unstable **Rift Core**. First look must communicate a real crafted 3D world: deep perspective, substantial materials, ornate structures, atmospheric lighting and responsive physical action—not a dark UI dashboard sprinkled with glowing cubes.

**Reference terms:** premium console-quality art direction translated carefully into browser performance; stylized physical realism; ancient machinery over a vast storm; substantial PBR stone/metal; grounded VFX; great physics clarity. Avoid copying visual assets, costumes, symbols or signature scenes from existing games/franchises.

## Concrete camera composition
- Arena roughly 42m × 25m, multi-layered with central playable ground and vertical visual features outside playable bounds. Physics extents are symmetric for fairness. World units in meters. Tune after prototypes.
- Three-quarter elevated chase/broadcast view, approximately 35–55° depression and camera orbit yaw 20–45° relative to lateral axis (adjust to frame both goals), with **both goals + Rift Core** never concealed by player UI.
- Cinematic hero framing for lobby: central core foreground at apparent 1–2m diameter, giant rift gate left and right, massive jagged silhouettes in deep cloud valley; atmospheric perspective as a visibly different mid/background depth layer.
- Gameplay camera stays legible. FOV / perspective must be adaptive across 16:9 desktop, 844×390 landscape phone, 390×844 portrait. Real screen capture on every tier.
- No heavy unexplained camera shaking on routine attacks. Reduced-motion control and cut-scene skip.
- Character proxies stand outside the central scoring lane. They are original stylized faceless energy wielders with visible upper-body intention; no prominent uncanny faces.

## Palette (starting tokens, can iterate)
- Sky abyss: #071421; storm: #12364A; shadow basalt: #202830; polished basalt: #343B42; cold silver: #9AAAB7.
- Brass edge: #C18B53; amber / player A: #FF9C46; cyan / player B: #50D8E8; rift violet: #9C7DFF.
- Ice pale: #BEEFFC; water deep: #0D688A; earth warm fractured interior: #C76D32; electromagnet arcs: #C7B7FF.
- Tonemapping ACES/filmic evaluated in screenshots; exposure protects highlights; never saturate every emissive object.

## Geometry target
1. Ring stadium: visually complex sculpted slabs, center-line geometry, physical collision walkways, layered exterior ribs and pillars, ornamented large forms with repeatable material variation, deliberate wear/chips/noise.
2. Goals: sculpted portal arches with visible thickness and multilayer portal interior, glowing score receiver membrane, architectural footing and stable collision plane. Team silhouettes different by engraving motif, not shape asymmetry that affects scoring.
3. Wielder silhouettes: body proportions original and athletic, cloak/coat as controlled secondary motion, glowing hands, animation rig or carefully crafted IK. No headshot/face scan.
4. Rift Core: multi-shell optical depth, iridescence, energy cable lattice, crack and mass cues, velocity-dependent trails; real collider proxy.
5. VFX: volume illusion through shader layers, soft particles, signed fields + collision-driven debris; avoid clipart-like arrows, cones or flat sprite spam.
6. Distant world: cloudbanks, suspended fragments, receding megastructure silhouettes, atmospheric shaft lighting, parallax and horizon cues.

## Scene lighting contract
- One motivated storm-break directional key; ambient skylight, subtle cool fill, micro-rim light around core, grounded contact shadows; static ornament can use baked AO.
- Dust/steam volumes visually read under light. Shadow softness varies by distance; lower-tier fake contact shadows acceptable.
- Water must show surface normal flow, specular and foam response; stone must show roughness/normal, metal metalness reflections; do not recolor basic lambert primitives and call them final assets.
- Light overdraw + transparent sorting/precision on Safari tested explicitly.

## Feedback ladder
- 0 ms user action: local reticle animates and pointer ribbons charge—cosmetic, not trusted effect.
- Server accepts: wielder anticipation/release and ability cast emerges at correct origin.
- Contact: projectile/rock bounce changes server body velocity, brief impact flash, sound/haptic/deflection trail, optional damage decal.
- Reaction: physical material state visibly converts, e.g. glassy ice forms actual platform; fog clears; metal charge propagates through conductive chain.
- Scoring: Rift Core enters goal plane, portal implodes and transmits dramatic ring wave, scoreboard updates, sub-2-second ceremony.
- Network correction never spawns a conflicting false explosion.

## What final screenshots MUST show
### HERO_01 — Arena reveal
Ornate suspended colossal arena, two dramatic goals, detailed core, powerful key light, storm depth, intentionally composed premium game rather than demo.
### COMBAT_02 — Water / fire collision
Curved translucent water structure and believable heat/steam, actual physical interaction with core; volumes grounded and clear.
### COMBAT_03 — Ice + impact
Ice bridge/ramp physically alters a core trajectory, fractured edge glow and debris.
### COMBAT_04 — Gravity vortex
Stone + metallic fragments orbit field center, core trajectory visibly curves and remains readable.
### DUEL_05 — Two player scene
Both wielders face contested core; simultaneously cast contrasting elemental powers with a clear contest over momentum.
### MOBILE_06 — Usable phone
Goal, ball, players/forces, timer/score, energy, touch/camera button all in compact viewport without overlap or unreadable text.

## Art-review rubric scored 0–5 in each category
Composition, architecture/silhouette, material texture fidelity, light/shadows, atmosphere/depth, character design, ability VFX, causal physics feedback, UI integration, visual readability, mobile performance. Overall weighted score = 15% composition + 15% environment + 15% VFX + 10% character + 10% lighting + 10% materials + 10% UI/readability + 15% mobile/performance. Each category must reach >=3 and weighted >=4.0/5 for launch candidate. These are subjective reviewed scores, not automated code pass promises; save visual evidence.

## Hard failure examples
- Arena = checkerboard ground plane, gray blocks, flat background.
- Two floating capsules = claimed animated energy wielders.
- Physics objects moved by setPosition in game abilities instead of forces.
- Fire = orange unlit mesh; water = solid blue wedge; smoke = flickering sphere.
- Entire screen constant bloom; gradients & GUI cover core.
- Cosmetics shown in static mock but absent during real gameplay.
- 1080p render perfect but 390px phone view unplayable.
- A pretty screenshot but no working real-time game behind it.

## Iterative improvement
Build PBR environment -> capture golden shots -> critique at full resolution -> improve composition/materials/light -> test phones -> refine transparent VFX -> re-capture. Use cheap optimized approximations only where scene still looks intentional and causality remains true. High fidelity is achieved through disciplined art iteration, not only adding polygon count.
