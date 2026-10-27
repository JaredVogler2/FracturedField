# FRACTURE FIELD — 3D visual standard

The standard every rendered frame is held to: the art direction, the measurable criteria and
what is never accepted. It joins [CREATIVE_TARGET.md](CREATIVE_TARGET.md) (the north star and the
art-review rubric), the deep dives D07–D11 and the owner's brief of October 2026 ("world-class
interactive 3D visual experience", with two mood references).

- [ART_DIRECTION.md](ART_DIRECTION.md) records what is built and the recipes behind it.
- [3D_IMPLEMENTATION_PLAN.md](3D_IMPLEMENTATION_PLAN.md) is the plan.
- [3D_QUALITY_REPORT.md](3D_QUALITY_REPORT.md) holds scores, measurements and the evidence.
- Phase state lives only in [BUILD_STATUS.md](BUILD_STATUS.md).

## 1. Art direction — *the storm breaks over the Shattered Meridian*

An ancient engineered arena of black basalt and forged brass, suspended in the eye of a storm, at
the moment the clouds tear open. Gold light rakes across cold blue stone. Warm fires burn against
the storm, and magic is drawn by luminous hands in rune light. Stylised physical realism: substantial
PBR surfaces, readable shapes, light as the main storyteller.

### References (principles only — nothing is copied)

The owner supplied two mood references. The first is a first-person spell-casting scene: luminous
hands crackling with blue-violet energy, a circle of runes drawn in light, a blazing warm sky
behind dark ruins, and debris in the air. The second is a fantasy village in a cavern: warm windows
and lanterns against a cool blue-green world, still water carrying the warm lights, haze, and a
bright opening above.

What we take from them:
- warm against cool;
- light sources that motivate local colour (practicals);
- one luminous focal point per view;
- silhouettes layered in haze;
- reflections on wet surfaces;
- magic as structured light (rune circles, arcs) bound to hands.

What we never take: characters, costumes, symbols, layouts or compositions from these or any
other works. CREATIVE_TARGET's originality rule applies.

### Colour relationships

| Role | Colour | Rule |
|---|---|---|
| World base (≈ 60–70 % of a frame) | storm blues, basalt (`#071421` → `#343b42`) | cool, never black-crushed |
| Key light, practicals, brass | gold / amber (key `#ffc58a`, flames `#ffb066`) | warm is *light*, not paint |
| Teams | amber EMBER `#ff9c46` (hexagon) / cyan TIDE `#50d8e8` (diamond) | always paired with a shape |
| Rift | violet `#9c7dff` | the core and rift cracks only |
| Elements | their own hues (D09) | never clipped to white |

Warm means light, fire and brass; cool means air, stone and shadow; violet means the rift.
Emissives stay below the bloom threshold, except the focal accents: the core, scoring, casts and
hands.

### Scale, camera and composition

- **Scale (metres).** Field 42 × 25 (physics unchanged), platform radius 32, rim columns 15–21 m
  tall, distant formations 70–320 m away.
- **Gameplay.** A three-quarter broadcast camera fitted to each aspect ratio and to the thumb
  controls (built). Both goals and the core are always visible, and no UI covers them.
- **First impression (the menu).** A slow cinematic camera, low over the field: the core in the
  foreground, a gate, the rim columns and the storm break beyond. Portrait phones get a vertical
  composition of their own (along the field, the sky above), not a crop of the landscape one. The
  menu docks to a side (landscape) or the bottom (portrait), so the scene stays visible.
- **Depth layers.**
  - Foreground: the field, the core, hands and cast circles, the walls.
  - Midground: gates, pillars, rim slabs, braziers, rim columns.
  - Background: floating formations, waterfalls off far islands, spires with lit windows, storm
    towers and the cloud sea.

  Aerial perspective, shared by the sky and every material's fog, separates them.
- **Focal point.** The brightest, most saturated thing on screen is what matters: the core, then a
  cast or a held body, then the storm break in the sky. Set dressing never out-shines them.

### Materials

- **Basalt.** Dark, worn to a soft polish, with chipped pale bevels. A storm-wet sheen gathers in
  the low spots and picks up the warm key and the sky.
- **Brass.** Worked metal that catches the warm key. It is never a glowing strip.
- **Steel.** Cold and brushed.
- **Rift.** Violet light in fissures, with crystals.
- **Water, ice, fire, steam and arcs** follow D09 (stage 7C).
  - Water shows moving normals and specular.
  - Ice is pale and refractive, with a controlled glint.
  - Fire has evolving shape and lights its surroundings.

### Lighting

- **Key.** A warm storm-break sun raking from the far left at about 31° elevation. Shadows are long,
  sharp near contact and readable from the gameplay camera.
- **Fill.** Cool sky light. Shadows read blue: never black, never flat. Upward metal faces reflect
  a storm zenith, not a white sky.
- **Practicals.** Brazier fires on the rim and lit windows in the distant spires: warm pools of light
  on stone, motivated by a visible source.
- **Living light.** Cloud shadows drift slowly across the platform (subtle; frozen under reduced
  motion), and light shafts and dust hang in the key.
- **Exposure.** ACES filmic, with exposure set to protect highlights: no white clipping on ice,
  brass or stone tops.
- **Low tier.** It keeps the light story through baked static shadows and baked light pools rather
  than losing all light direction.

### Motion language — alive, never noisy

- **World.**
  - Cloud sheets and cloud shadows drift.
  - Waterfalls fall off the far islands.
  - Dust rises in the key.
  - Gyroscopes turn, flames flicker, debris bobs.
- **Interaction:** anticipation → release → impact → settle.
  - Cast circles draw on and then dissolve.
  - A held body shows a tether, and a spinning core shows a swirl.
  - A goal implodes its gate in under 2 s.
- **Reduced motion:** drift, flicker and shake stop; flashes ramp instead of strobing.

### UI integration

The existing HUD language stays: dark glass panels, brass and amber accents, Inter type. Panels are
compact, never cover a goal or the core, and give touch targets of at least 44 × 44 CSS px.

## 2. Measurable criteria

These are working targets. Scores and frame metrics are evaluation aids, not proof: every frame is
also inspected by eye, and the report says what was and was not seen.

| Area | Criterion | How it is checked |
|---|---|---|
| Composition | Both goals, the core and the local reticles are visible and unobstructed by UI at every listed viewport | Browser layout tests (phase 06 suite) + captures |
| First impression | The menu frame shows the core, at least one gate and the storm break, on desktop and on portrait / landscape phones | Captures |
| Light story | Gameplay frames (medium/high): luma range p95 − p5 ≥ 0.55; warm-cool ≥ 0.15. Low tier: range ≥ 0.45 and visible static shadows | `scripts/frame-metrics.mjs` + inspection |
| Highlights | Clipped pixels (all channels ≥ 250) < 0.3 % in world-only frames, element close-ups included | frame metrics |
| Not too dark | Median luma 0.14–0.40 in gameplay and hero frames | frame metrics |
| Motion | Idle menu and gameplay frames 2 s apart differ outside the UI (the world moves); with reduced motion only gameplay moves | Browser test |
| Viewports | 1920×1080, 1440×900, 1366×768, 390×844, 393×852, 844×390, 360×740: no horizontal overflow, no clipped primary control, touch targets ≥ 44 px | Browser tests + captures |
| Render budget (gameplay view) | Draw calls ≤ 100 low / 170 medium / 210 high; triangles ≤ 80 k low | `renderStats` in captures |
| Frame time | Desktop 16.7 ms at 1920×1080; phones 33.3 ms sustained, with adaptive quality | **Real devices only.** SwiftShader numbers in this container compare builds; they are never reported as device performance |
| Robustness | No page errors or shader errors; resize, orientation change, tab suspension and WebGL context loss recover | Browser tests |
| Rubric | Each of the brief's nine areas ≥ 4/5 and each CREATIVE_TARGET category ≥ 3 (weighted ≥ 4.0) under genuine inspection | 3D_QUALITY_REPORT |

## 3. Never accepted

- Floating primitives as final art, a default-looking three.js scene, or a featureless ground
  plane or background (CREATIVE_TARGET: no checkerboard ground, no grey blocks, no flat backdrop).
- Flat uniform lighting, all-black arenas, overblown white portals, or constant full-screen bloom.
- A saturated glowing strip standing in for metal.
- Fire as an orange unlit mesh, water as a solid blue wedge, smoke as a flickering sphere, or VFX
  as clip-art cones and arrows.
- A motionless world. Equally, motion that harms clarity or frame rate.
- A 1080p frame that works while the 390 px phone view does not.
- Cosmetics in a still that are absent in real play, or a still with no working game behind it.
- Physics decided by cosmetic events.
- Claims of device, GPU or Safari performance that were not measured on that hardware.
