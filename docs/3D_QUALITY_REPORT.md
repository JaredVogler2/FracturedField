# FRACTURE FIELD — 3D quality report

Scores, measurements and evidence for the visual program
([standard](3D_VISUAL_STANDARD.md) · [plan](3D_IMPLEMENTATION_PLAN.md)). Phase state lives in
[BUILD_STATUS.md](BUILD_STATUS.md).

## How things are measured here

- **Frames.** Every frame comes from the running production build: Vite preview, headless
  Chromium, SwiftShader software WebGL. They are captured by `scripts/capture-arena.mjs` and
  inspected by eye. Nothing is a mock-up.
- **Tonal metrics.** `scripts/frame-metrics.mjs` reports, per frame:
  - luma percentiles (sRGB-encoded luminance, 0–1);
  - the % of clipped pixels;
  - warm-cool, the mean (R−B) of the brightest 10 % minus that of the darkest 30 %.

  These are aids for comparing revisions, not verdicts.
- **Render counters.** Draw calls and triangles per frame, all passes. They depend on the scene,
  not the hardware.
- **Not measured here.** GPU or phone frame rates, Safari behaviour, thermal behaviour. This
  container has no GPU and no phone. SwiftShader frame times only compare one build with another,
  and none is reported as device performance.

## Round b1 — baseline (27 Oct 2026, commit `3c1d5a8`)

The 7A arena with the 7B lighting code, before any 7B revision. Frames:
- the menu (desktop / portrait-low / landscape-medium);
- kickoff (high);
- eight review shots;
- the D08 flat/dark variants (desktop, phone);
- phones (landscape low/medium, portrait low);
- element close-ups R1, R3, R5 and R6.

### Inspection notes

- **Gameplay (high).** Readable, but evenly lit: the warm key barely shows on the floor and the
  shadows are not cool. A white bar sits on the EMBER gate: upward steel reflecting a too-bright
  environment zenith. The rune bands on the pillars are flat lilac strips.
- **D08 comparison.** "Final" sits close to "flat". The "dark" variant shows the light story the
  final should have (warm key, long shadows), but crushes everything else.
- **Hero and wide.**
  - The sky has a warm break and blue towers, and the rim columns and formations recede into
    the haze. That is good depth.
  - The arena itself is dim and low in contrast.
  - The formations read as faceted rocks, with nothing inhabited or alive in the distance.
- **Menu.** The first impression is the top-down gameplay camera under a panel. On a portrait
  phone the panel covers most of the scene.
- **Phones.**
  - Medium has shadows and reads well.
  - Low has no light direction at all, and the floor is a uniform grey grid.
  - The UI fits; thumb controls are large and clear.
- **Elements (7C scope).**
  - Fire is a cluster of pale cones.
  - Water is a flat translucent decal.
  - Ice reads well, but its rim glint clips.
  - Steam reads.
  - Arcs on wet stone read.
  - Fire and ice stay distinguishable.

### Rubric (the brief's nine areas, 1–5; honest, not a target)

| Area | b1 | Why |
|---|---|---|
| Art direction and cohesion | 3 | Consistent palette, motifs and forms; the lighting does not yet express the storm break |
| Geometry and materials | 3 | Authored bevelled arena with PBR surfaces. Rim formations are faceted; the floor is a regular grid; metal strips glow instead of reflecting |
| Lighting and depth | 2 | Near-flat key/fill ratio, a clipped gate bar, no light direction on low; aerial perspective is good |
| Environmental richness | 3 | Rim columns, rift-cracked slabs with crystals, floating debris, cloud sea; no practical lights or storytelling in the far world |
| Animation and liveliness | 2 | Gyroscopes, membranes, dust and cloud sheets (medium/high only); otherwise still |
| Interaction quality | 3 | Reticles, grip tether, trails, impacts and element reactions work and are causal; their VFX are basic |
| Camera behaviour | 3 | Fitted broadcast camera per aspect and controls, with reduced-motion shake; no cinematic first impression |
| Mobile appearance | 3 | Layouts fit with large controls; the low tier looks flat |
| Performance and fluidity | n/a | Not measurable here (no GPU or phone). Counts are within budget: 80 draw calls and 57 k triangles on low |

### Metrics (selected; full table in `docs/visual-evidence/phase-07/7b/frame-metrics-b1.json`)

| Frame | p5 | p50 | p95 | range | clip % | warm-cool |
|---|---|---|---|---|---|---|
| kickoff, high (final) | 0.027 | 0.185 | 0.519 | 0.492 | 0.000 | 0.088 |
| kickoff, *flat* variant | 0.036 | 0.175 | 0.361 | 0.325 | 0.001 | 0.079 |
| kickoff, *dark* variant | 0.000 | 0.055 | 0.207 | 0.207 | 0.000 | 0.082 |
| hero | 0.025 | 0.185 | 0.507 | 0.482 | 0.001 | 0.195 |
| wide | 0.037 | 0.135 | 0.242 | 0.205 | 0.000 | 0.067 |
| menu, desktop | 0.029 | 0.130 | 0.287 | 0.258 | 0.000 | 0.087 |
| phone landscape, low | 0.040 | 0.194 | 0.452 | 0.412 | 0.002 | 0.145 |
| phone portrait, low | 0.048 | 0.175 | 0.325 | 0.277 | 0.002 | 0.149 |
| R6 fire + ice | 0.029 | 0.217 | 0.656 | 0.627 | 0.086 | 0.120 |

Top three deficiencies, which WP1–WP3 address first:
1. the light story (ratio and warmth);
2. false highlights (the environment zenith, the emissive strips);
3. the low tier's missing light direction.

## Rounds b2–b5 (revisions)

The round-by-round critique and its fixes are in docs/progress/PHASE-07.md §7B.

- **b2.** Light ratio and baked shadows.
- **b3.** Key colour, metal caps, cloud-shadow verification.
- **b4.** The first menu camera and menu layout fixes.
- **b5.** Lights +35 %, braziers, the far world, and the backlit menu camera. Found: the steel beam
  glare, banded tower windows, white flame tips.

## Round b6 — 7B closed (27 Oct 2026)

Evidence: `docs/visual-evidence/phase-07/7b/*-b6.jpg`, with comparison sheets `compare-*-b1-b6.jpg`
and `frame-metrics-b6.json`.

### Inspection notes

- **Menu (desktop).** Looking down the field into a golden storm break, the arena is backlit, with
  long shadows toward the viewer and brazier flames on the far wall. Two sky islands carry towers
  with grids of warm lit windows, and a waterfall falls into the cloud sea.

  This is the first impression the brief asks for. What still weakens it:
  - one polished slab at the right glares near-white (capped, but still the brightest stone);
  - the left of the frame, under the menu, is dark platform.
- **Gameplay (high).**
  - Warm-lit stone with cool blue shadows and long pillar shadows.
  - Cloud-shadow patches and wet, glossier patches on the floor.
  - Four brazier flames along the far wall, and rune inscriptions on the pillars.
  - The EMBER gate's steel beam now catches the sun as a line, not a bar.
- **Phones.**
  - Low tier: baked pillar and wall shadows, braziers visible.
  - Portrait menu: the scene above the docked menu shows the far gate, a tower and a waterfall.
- **Elements.** The ice glint stays under 0.15 % clipped. Fire is still cones (7C).

### Rubric (self-assessed, 1–5; b1 → b6)

| Area | b1 | b6 | Why |
|---|---|---|---|
| Art direction and cohesion | 3 | 4 | The storm-break concept now reads in every view: warm key against cool shade, practicals, lit towers in the haze. Core, VFX and characters are still placeholders of the identity |
| Geometry and materials | 3 | 3 | Metal reads as metal (capped glints, brushed steel), and the floor is wet in places. The floor is still a regular grid; formations are faceted; towers are simple lathes |
| Lighting and depth | 2 | 4 | A clear shadow story on every tier, cloud shadows, a backlit hero, aerial perspective through the haze to lit towers |
| Environmental richness | 3 | 4 | Braziers, sky islands with inhabited towers and waterfalls, rune inscriptions, wet stone. No characters yet |
| Animation and liveliness | 2 | 3 | Drifting cloud shadows, flickering flames and embers, falling water, breathing windows, a drifting menu camera. VFX and characters (7C/7D) are still to come |
| Interaction quality | 3 | 3 | Unchanged (7C) |
| Camera behaviour | 3 | 4 | A cinematic menu camera per aspect that follows the play loosely, plus the fitted gameplay framing. No goal-ceremony camera |
| Mobile appearance | 3 | 3 | The low tier keeps its light story and the menus fit (the landscape title clipping is fixed). The portrait menu still covers about half the screen |
| Performance and fluidity | n/a | n/a | Not measurable here. Counts are within budget: low 86 draws / 64 k triangles, high 163 / 194 k |

The brief's bar is 4/5 in every area. Not yet met: geometry and materials, liveliness,
interaction and mobile, with performance unmeasured. These are the targets of WP7–WP10.

### Standard criteria (docs/3D_VISUAL_STANDARD.md §2), b6

| Criterion | Result |
|---|---|
| Light story, medium/high (range ≥ 0.55, warm-cool ≥ 0.15) | Range met (kickoff 0.58). Warm-cool 0.11 in the kickoff frame: the HUD's white text sits among the brightest pixels. World-only frames meet it (hero 0.21, menu 0.20) |
| Light story, low (range ≥ 0.45, static shadows) | Landscape met (0.47, baked shadows visible). Portrait 0.33: its dark control panels cover a third of the frame |
| Highlights (clipped < 0.3 %) | Met everywhere (maximum 0.14 %, fire beside ice) |
| Not too dark (median 0.14–0.40) | Gameplay high 0.16 and hero 0.19 meet it. Low-tier phones are at 0.136–0.137, just under |
| Render budget | Met |
| Frame time | Not measured (no device) |

## Not verified (standing list)

- Frame rate, frame-time tails and thermal behaviour on any physical phone or real GPU.
- iOS Safari rendering differences, such as transparency sorting, precision and half-float
  render targets.
- Real people's impressions. The scores above are the developer's own inspection.
