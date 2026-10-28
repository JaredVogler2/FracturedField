# FRACTURE FIELD — 3D implementation plan

Working plan for the visual program: the owner's October 2026 brief carried out through the art
gates of Phase 07 (7B–7E), with performance and robustness items feeding Phase 11. The standard is
[3D_VISUAL_STANDARD.md](3D_VISUAL_STANDARD.md); scores and evidence are in
[3D_QUALITY_REPORT.md](3D_QUALITY_REPORT.md); phase state stays in [BUILD_STATUS.md](BUILD_STATUS.md).
This plan is updated as work packages land.

## 1. Repository audit (27 Oct 2026, capture round b1)

### Stack (verified versions, no upgrade needed)

- three 0.186.1, @react-three/fiber 9.8.2, @react-three/postprocessing 3.2.2, postprocessing
  6.39.5.
- React 19.3.1, Vite 8.3.5, Rapier 0.21.0 (server-authoritative simulation, unchanged by this
  work).
- WebGL2. WebGPU is not used.

### Rendering pipeline as built

- **Lighting:**
  - forward rendering;
  - one shadow-casting key (PCF soft, constrained 68 × 52 m area, medium/high only), a cool fill
    directional and a hemisphere;
  - image-based light from a PMREM-filtered procedural storm environment;
  - point lights for the core (+ two gate lights on medium/high).
- **Materials:** one triplanar `MeshStandardMaterial` extension for every arena surface (procedural
  tileable textures, macro variation, whiteout normals, cavity, edge wear, live wet/glow
  uniforms, firefly clamp). The floor is a generated texture set (albedo, normal, ORM).
- **Atmosphere:** a GLSL sky gradient shared by the sky dome and every material's fog (aerial
  perspective). Storm towers, cirrus and a cloud sea in the sky shader. The low tier bakes the sky
  into a cube map.
- **Post-processing:** ACES filmic tone mapping as a pass; thresholded bloom and a vignette on
  medium/high.
- **Grounding and layers:** contact discs under dynamic bodies; cloud sheets, light shafts and
  dust (medium/high).
- **Quality:**
  - tiers low/medium/high (`art-tokens → QUALITY`);
  - adaptive quality on smoothed frame time with hysteresis;
  - a dev HUD with renderer counters.

### Measured in round b1 (SwiftShader, so counts only — not performance)

| View | Draw calls | Triangles |
|---|---|---|
| Gameplay, high | 158 | 174 k |
| Gameplay, medium | 124 | 170 k |
| Gameplay, low | 80 | 57 k |
| Portrait phone, low | 70 | 50 k |

### Strengths

- Authored arena geometry with bevels and wear.
- Coherent palette and team motif system.
- A working aerial perspective.
- Adaptive tiers.
- Gameplay readability at every viewport.

### Deficiencies found in b1

Each deficiency was inspected in the frames. Frames are in the scratch evidence, and their metrics
are in the quality report.

1. **Weak light story.**
   - The selected lighting barely differs from the "flat" comparison variant: luma range 0.49 vs
     0.33, warm-cool 0.09 vs 0.08.
   - The warm key hardly reads on the floor, and the shadows are not cool.
   - Hero and wide frames are dim and low in contrast (wide: range 0.21, p95 0.24).
2. **Clipped or false highlights.**
   - Upward-facing steel on the EMBER gate renders as a white bar. The environment map's
     zenith panel is far brighter than the storm sky's zenith.
   - Pillar rune bands and inlays are flat, saturated emissive strips.
   - Ice and fire tips clip in close-ups.
3. **The low tier has no light direction.** There are no shadow maps, so the phone view is evenly
   lit and the floor reads as a uniform tile grid.
4. **The first impression is the gameplay camera.** The menu shows the top-down broadcast view
   under a panel. There is no hero composition, and on a portrait phone the panel covers most of
   the scene.
5. **The world is mostly still.**
   - Little moves when idle (the gyroscopes, the membrane, dust and cloud sheets on
     medium/high).
   - Nothing moves on low.
   - There are no practical light sources and no environmental storytelling in the far world.
6. **The floor reads as a regular grey grid.** It has no wet sheen, no large-scale variation and no
   ornament at the centre line.
7. **Element VFX are basic (7C scope):**
   - fire is cones;
   - water is a flat translucent decal without moving normals;
   - the core is a glowing sphere with rings.
8. **No characters (7D scope):** the players exist only as reticles. The brief's references and
   ADR-0009 point to **luminous hands bound to the hand channel** as the signature.

## 2. Work packages

Each package follows the same loop:
1. implement;
2. unit and browser tests;
3. capture (`scripts/capture-arena.mjs`);
4. metrics (`scripts/frame-metrics.mjs`);
5. critique against the standard;
6. revise.

Then it is committed. The gate column names the Phase 07 stage it serves.

| # | Package | Gate | Status |
|---|---|---|---|
| WP1 | **Lighting rebalance and highlight control.** A stronger, warmer key; cooler, weaker fill and ambient; an environment zenith matching the storm; restrained emissives (rune bands, glyphs, inlays); exposure retuned; D08 variants kept for comparison | 7B r2 | done (b2–b6) |
| WP2 | **Low-tier light story.** Static shadows of walls, pillars, gates and rim columns baked once into a floor/platform mask (planar projection along the key) and applied to direct light; zero per-frame cost | 7B r2 | done (b2) |
| WP3 | **Living light.** Slowly drifting cloud shadows modulating the key on every surface (one texture read; medium and high tiers); frozen under reduced motion | 7B r2 | done (b2; visible from b3) |
| WP4 | **Practicals.** Bronze braziers with animated flame on the rim; warm light pools on stone (baked decals; a real point light only where the tier allows); lit windows in far spires | 7B r3 | done (b5–b6) |
| WP5 | **First impression.** A cinematic attract camera (slow orbit and dolly over the field, framed per aspect, portrait composition); the menu docked so the scene shows | 7B r3 / 7E | done (b4–b6); goal-ceremony camera still open |
| WP6 | **Living far world.** Spires on far islands, waterfalls spilling into the cloud sea, drifting debris; storm-break glow as the sky's focal point | 7B r3 | done (b5–b6) |
| WP7 | **Floor revision.** Larger irregular slabs, a centre-line inlay, storm-wet patches with low roughness that catch the key and the sky | 7A revision | wet patches done (b6); slab layout open |
| WP8 | **Rift Core and elemental VFX** (D09): a multi-shell core; fire with evolving shape and light; water with flowing normals and specular; ice glint control; arcs; steam lit by the key; rune circles where casts land | 7C | done (7C gate, PHASE-07 §7C); no rune circles yet: a cast draws a ring in the caster's colour |
| WP9 | **Wielders and luminous hands** (D10): wielders on their plinths with upper-body intent; a spectral hand at each seat's force point that opens, closes, twists and pushes with the hand channel (ADR-0009) | 7D | planned |
| WP10 | **Golden screenshots and robustness** (D11): the six CREATIVE_TARGET shots at desktop and phone; every viewport in the brief; tests for resize, orientation, tab suspension and context loss; perf instrumentation (frame-time distribution, startup, heap, asset sizes) recorded where measurable | 7E / 11 | planned |

## 3. Verification

- **Static and unit:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
- **Browser:** the existing Playwright suites (gameplay must not regress), plus new tests per
  package where behaviour changes (tier selection, reduced motion, recovery).
- **Visual:** capture rounds `b1`, `b2`, … at desktop 1920×1080 and phone 844×390 / 390×844 (all
  brief viewports in WP10). Every frame is inspected; metrics are recorded; at least two revisions
  per gate.
- **Performance:** this container has no GPU and no phone. Frame times here are SwiftShader
  (software) and are used only to compare builds. Device numbers need the owner's devices or a
  deployed build (Phase 12).

## 4. Order and commits

WP1–WP3 form the next commit (7B round 2), followed by WP4–WP6 (7B round 3, closing 7B's gate). WP7
can ride with round 3. Then come WP8 (7C), WP9 (7D) and WP10 (7E).

Each package lands as a validated commit with its frames and report updates. Pushes are batched,
because every push re-runs the browser CI (~25–40 min).
