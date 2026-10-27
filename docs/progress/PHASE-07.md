# PHASE 07 — Visual production (art gates 7A–7E)

**Status: IN PROGRESS — 7A COMPLETE (local); 7B, 7C, 7D, 7E NOT STARTED.**
Phase 07 is five separately gated art stages (docs/BUILD_ORDER.md). Each is judged on frames
captured from the running game (production build, headless Chromium with SwiftShader software
WebGL), critiqued against docs/CREATIVE_TARGET.md and revised, never on standalone mock-ups.
SwiftShader frames show what is rendered; they are not performance evidence, and nothing here has
been seen on a physical phone or a real GPU.

## 7A — Environment geometry and PBR materials (D07) — COMPLETE (local)

The Shattered Meridian is now an authored place instead of a field on a dark plane: a thick
platform of large bevelled basalt slabs with a broken, settling rim, rift-cracked slabs leaking
violet light with crystals growing from them, low stone walls capped with riveted brass, two
monumental rift gates with mounted gyroscope rings, monumental broken columns, an engineered
underside with glowing conduits, and suspended formations in the storm. Collision is unchanged:
every collider still comes from shared data, and the decor is tested to stay out of the playable
volume.

### What was built

| Area | Implementation |
|---|---|
| Platform | `render/arena/geometry.ts → platform()`: 19 large bevelled slabs (D07: 12–20) around the field floor, sectors jittered, joints by a true inward polygon offset (`offsetInward`); the first ring flush with the floor, slabs beyond it settled to stepped heights (3–14 cm), sunk and tilted rim slabs, four bites broken out of the rim (never near the gate axes); three rift-cracked slabs (near the bites first); a channel carved on the scoring axis behind each gate with a sunken bed and a brass inlay; resting spots for rubble and rift crystals; per-slab value and facing-based darkening of joints and undersides. |
| Walls | `wallBlocks()` bevelled blocks under longer capstones (running bond, overhanging both faces); `capRail()` a thin riveted brass trim on both coping edges (brass as an accent that marks the boundary). |
| Rift gates | `gate()`: tapering pylons on stepped footings with brass-framed panels that lean with the taper, a thick pointed arch, a brass soffit, a keystone carrying the seat motif (hexagon / diamond, the HUD glyphs), bronze tie beams, the steel mouth frame, gyroscope rings that turn on a hub with spokes, mounted on an axle, hanger and keystone bracket outside the rings' sweep. High / low LOD (9,600 / 6,336 triangles, same silhouette). Goal posts and cavity walls (`goalPosts()`, `gateCavity()`) sit on their colliders. |
| Set dressing | `fieldPillar()` (fluted shaft never wider than its collider where the core can touch it, brass base, banded stone capital, glowing rune band), `plinth()` (stone drum, brass edge band, glowing inlay on the drum's corner bearings), `monolith()` columns (hidden when on the camera's side), `underside()` (stepped mass, steel ribs and spokes, two glowing conduits held by steel clamps), instanced floating shards, rubble and crystal clusters (`crystalCluster()`), distant formations (70–320 m). |
| Surfaces | `render/arena/surfaces.ts`: five procedural texture families (polished basalt, fractured basalt, rift-cracked, aged brass, brushed steel), each a detail map (value, roughness, cavity, crack) plus a normal map; exactly periodic (every fbm octave on its own lattice so it repeats once per tile); cracks along domain-warped cells, fissures along uniform-width contour lines. |
| Materials | `render/arena/materials.ts → SurfaceMaterial`: one triplanar `MeshStandardMaterial` program for every recipe (`ff-surface-v2`): token colour range, macro variation (breaks the tile repeat), cavity darkening, edge wear, oxide lowers metalness, whiteout normal blend, wet and glowing-crack uniforms, world normals taken from three's view-space normal (correct under non-uniform instance scale). `applyRecipe()` switches a surface to another recipe at runtime (uniforms only, no recompile) — the hook for world material state. Development builds warn about geometry without vertex colours. |
| Rift glass | `render/shaders.ts → createRiftGlassMaterial()`: translucent crystal (premultiplied alpha: veils and glows), fresnel facets, energy rising from the root; instancing-aware. |
| Recipes and layout | `render/art-tokens.ts → SURFACES` (basaltPolished, basaltFractured, basaltChilled, basaltDeep, basaltRubble, basaltFar, riftCracked, brassAged, steelCold) and `ARENA_ART` (platform, monoliths, shards, formations, texture size per tier). |
| Field floor | `render/floor-texture.ts`: the paving now runs on beyond the walls to the slabs (undressed courses) instead of a flat dark band; quartz veins softer. |
| Tools | `scripts/capture-arena.mjs` (golden frames + per-frame render counters → `arena-stats-<round>.json`), `?test=1&shot=NAME` review cameras (hero, gate, rim, wide, stone, brass, under, channel), `pnpm preview:surfaces <png>` (texture sheet, 2 × 2 tiles). |

### Capture → critique → revision (frames in `docs/visual-evidence/phase-07/`)

Five rounds, each captured from the production build: kickoff (1920 × 1080, high tier), the eight
review cameras, phone landscape (low and medium tiers) and phone portrait (low).

1. **Round 1** (`*-r1.jpg`). Critique: brass rails read as green-brown camouflage; polished basalt
   was crazy paving (a full Worley crack network); the field pillars, plinths and goal posts were
   pitch black; distant formations were flat dark cardboard; floating shards near-white; the ember
   ring under the platform a flat orange line; a flat untextured dark band between the walls and
   the slabs; the platform a flat grey disc at phone size.
2. **Round 2** (`*-r2.jpg`). Root cause of the black props: three.js feeds `(0,0,0,1)` to a
   vertex-coloured built-in material when the geometry has no colour attribute — every surface
   geometry now comes from a generator that adds one (a unit test enforces it; development builds
   warn). Also: wall copings with thin brass edge trim instead of a broad brass cap; sparse brass
   oxide (rendered less metallic); masked basalt fissures; rubble and distant-stone recipes; the
   paving continued beyond the walls; clamped glowing conduits; facing-based joint darkening.
   Found on the way: the pillar rune band stood vertically through the pillar, and the old texture
   test could not detect seams (an exact periodicity test replaced it — the round-1 textures did
   have seams). Remaining: big horizontal brass faces (pillar capitals, plinth tops) still mottled —
   polished metal facing up mirrors the dark sky while oxide catches the key light; fractured stone
   read as cobblestone; the platform plain; the rim faces too dark; slab glitter.
3. **Round 3.** Stone capitals and plinth tops with brass only as edge bands; settled slab heights;
   rift-cracked slabs; rubble on the rim; lighter rim faces; gentler basalt normals. Remaining: the
   rift cracks read as a glowing crackle glaze (dense, regular cells) and fractured stone still as
   a cell network.
4. **Round 4** (`*-r4.jpg`, `textures-v1-repeating-octaves.jpg` → `textures-v4-final.jpg`). The
   texture sheet showed the deeper cause: every fbm octave shared one lattice period, so higher
   octaves repeated 2, 4 and 8 times inside a tile (mirror-image ink blots, repeating brass spots).
   Per-octave lattices, domain-warped cracks with varying width and uniform-width contour fissures
   fixed it; sampling optimised ~3× (squared-distance Worley, analytic fbm gradients). Fractured
   stone now reads as weathered basalt; rift fissures are jagged and branching.
5. **Round 5** (`*-r5.jpg`, `arena-stats-r5.json`). Against the D07 checklist: 19 large slabs
   instead of ~40, carved scoring-axis channels with brass inlays, the gyroscope's hub, axle and
   hanger, translucent rift crystals on the level cracked slabs, the `channel` review camera and
   render counters. The larger slabs exposed a latent bug: the cheap inset (vertices toward the
   centroid) pulled the inner edge of a slab wrapping a field corner toward the field — replaced by
   a true inward offset (tested on a concave L).

Side-by-side comparisons: `compare-{kickoff-high,stone,brass,wide,phone-portrait-low}-r1-r5.jpg`.

### D07 checklist

| D07 item | Status |
|---|---|
| Thick overhanging platform, 12–20 large irregular slabs, shattered edge, extrusion depth | done (19 slabs, 1.4–2.6 m thick, bites, sunk and tilted rim) |
| Concentric steel ribs underneath, anchored gateways, 3–5 monumental columns | done (3 ribs + 16 spokes, 2 gates, 4 columns) |
| Meso: bevels, worn corners, carved scoring-direction channels, inset brass rails, pivots/hinges, damaged perimeter, gaps and debris layering | done (channels behind the gates; gyroscope hub/axle/hanger as the mechanism) |
| Micro: triplanar normal noise, cracks, roughness grunge, edge wear, rivets, emissive scars, balanced repetition | done (macro variation and periodic textures against visible repetition) |
| Sky: formations 50–500 m, layered cloud meshes and fog, never in collision | formations done (70–320 m, decor only); cloud layers and atmospheric blending belong to 7B (D08) |
| Procedural TypeScript generators, authorship and licences recorded | done (`docs/ASSET_LICENSES.md`: everything original and procedural) |
| PBR stone and metal: roughness / metalness / normal / AO, not plastic, brass with motivated highlights | done (cavity channel as occlusion; contact shadows beyond shadow maps → 7B) |
| Metres, instancing, simple collision, no hidden obstacles | done (instanced shards, rubble, crystals, formations; tests keep decor out of the field, the gate mouth and a touching core's volume) |
| Variants: polished, fractured, chilled stone; aged brass, cold steel; rift glass; conductive wet; ice; cracked glow — swappable through world state | stone, metal, rift glass, cracked glow done; chilled and wet exist as a recipe and a live uniform and switch at runtime (`applyRecipe`, tested) but nothing in the world drives them yet (7C); ice keeps its Phase 04 shader until 7C |
| Architectural scale; gate 5–8 m | deviation, see below |
| High and low LOD with a consistent silhouette | done (gate, monoliths, underside, pillars) |
| Art parameters in central tokens; deterministic, non-degenerate generators; disposal on unmount | done (`SURFACES`, `ARENA_ART`; tests; `useDisposeAll`, `useSurface`; generated textures are shared and live for the session by design) |
| Golden frames: kickoff 3/4, wide hero, impact near gate, phone landscape; zoom crops | done except "impact near gate", which needs the 7C impact VFX |

### Deviations from D07 (recorded)

- **Gate height 12.4 m (D07: 5–8 m).** The goal mouth from the collision data is already 4.6 m
  tall and 7.2 m wide; a gate that frames it with pylons and an arch rises to ~12 m at the
  keystone, and docs/CREATIVE_TARGET.md (the mandatory benchmark) asks for giant gates. When a
  camera looks from behind a gate (the phone portrait view), its tall structure is hidden so the
  goal mouth stays readable.
- **Rift glass** is a cheap fresnel/premultiplied shader, not physical transmission (which costs an
  extra scene pass per frame).

### Load and render counts (`arena-stats-r5.json`; counts, not benchmarks)

Renderer counters for one frame, all passes (shadow maps and post-processing included):

| View | Tier | Draw calls | Triangles | Textures |
|---|---|---|---|---|
| Kickoff 1920 × 1080 | high | 125 | 163,399 | 36 |
| Phone landscape 844 × 390 | medium | 119 | 162,631 | 36 |
| Phone landscape 844 × 390 | low | 78 | 80,425 | 18 |
| Phone portrait 390 × 844 | low | 68 | 73,553 | 18 |

Surface texture generation runs once at load on the main thread: 0.9–1.2 s for the five families
at 512 px (high and medium tiers) and 0.29–0.35 s at 256 px (low tier) in headless Chromium on this
container's CPU (Node: 1.05 s / 0.34 s). Phones will be slower; moving it to a worker with a cache
is recorded for the Phase 11 performance pass. Frame times under SwiftShader are not recorded —
they say nothing about a GPU.

### Tests

- **Unit:** 243 tests in 23 files pass (Phase 06 ended at 217). New in `apps/web/src/render/arena`
  (26):
  - `geometry.test.ts` (17): outline and ray helpers; `offsetInward` moves every edge of a convex
    and a concave polygon exactly d inward; the platform is deterministic, has 12–20 slabs within
    budget for five seeds, never intrudes into the field, keeps the first ring flush while slabs
    beyond it step down, carves both channels with brass in their beds, cracks slabs and rests
    rubble and crystals on level slabs inside the rim, breaks the rim away from the gate axes; the
    gate leaves the mouth open (both LODs, rings and mounting included), is ≥ 7 m tall with a low
    LOD under 70 % of the high triangles; rocks, walls, monoliths and the underside are
    deterministic and non-degenerate; every generator output carries position, normal, uv and a
    vertex colour; pillar trim never reaches a core touching the pillar collider, resting or
    hovering; a plinth's inlay sits on its drum's corner bearings; wall trim sits on the coping.
  - `surfaces.test.ts` (7): each family seeded, varied, and exactly periodic (f(u+1, v) = f(u, v)
    to 1e-6; the old per-tile fbm fails this by 0.26–0.58); crack density by family (polished
    basalt sparse, fractured more, rift-cracked most); brass mostly bright metal.
  - `materials.test.ts` (2): one program for every recipe; switching to chilled stone and to
    rift-cracked changes only uniforms (no recompile).
  - The pillar, plinth and seam tests were checked against the faults they guard (the old 1.24 ×
    pillar base, a hexagon inlay without its 30° start, the old fbm): each fails on the fault.
- **Browser (Playwright, production build):** 13 / 13 pass on the final build — phase01 (golden
  physics, 3D arena boots and renders without page errors, `/sim-debug`), phase02 (vs bot, menu over
  the live attract match), phase06 (six layouts: touch targets fit and never cover the core or a
  goal; two safe-area layouts). The capture script itself fails on any page error; none occurred.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean.

### Honest limits

- Headless SwiftShader frames only; no physical phone, no real GPU, no frame-rate measurement.
- The scene's lighting and atmosphere are still Phase 02's (one key, one fill, hemisphere, a dark
  storm fog): overall exposure is low, the distant formations are flat dark silhouettes (the fog
  colour is darker than the sky behind them) and there is no ambient occlusion beyond the cavity
  channel — all 7B (D08) work.
- Edge wear is derived from the world normal (faces between floor-facing and wall-facing), which
  puts wear on curved and rocky surfaces too; recipes for rocks turn it off. A baked curvature mask
  would be better (7E candidate).
- The field floor is still Phase 02's single generated texture; its quartz veins can read as
  lightning at gameplay distance (7E candidate).
- World material state does not drive the surfaces yet (7C).

### Commits

- `99fad61` — Phase 07A: authored arena geometry, procedural PBR surfaces, review rounds (code,
  tests, evidence).
- This report and the build status: the commit that follows `99fad61`.

## 7B — Lighting and atmosphere (D08) — IN PROGRESS (paused for milestone 06M)

The owner redirected development (ADR-0009): continuous physical manipulation — milestone **06M**
— comes before further art. 7B's code below is committed and tested; its gate (final-settings
captures, the D08 comparison set, a critique and two revisions) is **not** passed and resumes
after 06M.

### What was built

| Area | Implementation |
|---|---|
| Light rig | `render/Scene.tsx → Lights`: one storm-break key raking from the far left at ~31° (long shadows toward the camera, rims on columns and brass), a constrained shadow area (±34 × ±26 m), a cool camera-side fill and a cool hemisphere so shadows read blue; the core's point light and the gate lights (medium/high). Lighting comes from art tokens (`LIGHTING`) and three D08 comparison variants (`LIGHT_VARIANTS`: final, flat, dark; `?test=1&light=`). |
| Exposure and tone | ACES filmic with the variant's exposure (`renderer.toneMappingExposure`, which the post-processing tone-mapping pass reads); thresholded bloom on medium/high; a firefly clamp in the surface material so a raking sun on polished brass does not bloom into white bars. |
| Aerial perspective | `render/atmosphere.ts`: one sky gradient in GLSL (`ffSky`) used by the sky dome and by the fog of every material (three's fog chunks replaced): distant forms fade into the sky behind them; fog starts 36 m from the centre (field and platform never fogged); a height haze below the platform. |
| Sky | `render/shaders.ts → createSkyMaterial`: eye-wall storm towers ringing the horizon lit toward the break, cirrus (high), a billowing cloud sea below; drawn after the opaque scene at the far plane. The low tier renders it once into a 256² half-float cube map shown as the background (one texture read per pixel; no slow drift). |
| Storm layers | `render/storm.tsx`: cloud sheets drifting below the platform (two heights and speeds; medium/high), storm-break light shafts (instanced billboards), dust motes rising in the updraft (capped point size). |
| Grounding | `render/contact-shadows.tsx`: a soft disc under every dynamic body that fades and widens with height (all tiers; the only grounding on low); contact occlusion baked into the floor at walls, pillars and posts. |
| Quality tiers | `art-tokens → QUALITY` (DPR, shadows, bloom, floor texture, cloud sheets, shafts, dust, sky, particles, point lights; table in docs/ART_DIRECTION.md); `render/adaptive-quality.ts` (auto: steps down after ≥ 5 s below 40 fps smoothed, up after 12 s above 57 fps, 8 s cooldown, hitches ignored, never above the device-class tier); the dev HUD shows tier, draw calls, triangles, shader programs, geometries, textures and texture-generation cost. |

### Low-tier frame cost: a regression 7A introduced, found by CI

PR #2's browser suite failed: the simplified-mode player did not score against the bot in four
matches. The game was not broken, but the 7A arena had made the **low** tier — the tier every
phone test uses — about twice as expensive to draw, so the test's player reacted more slowly.
Measured the same way for every build: SwiftShader (software) in this container, iPhone 13
landscape (844 × 390, DPR 3 → canvas 675 × 312), low tier, a paused match (a static scene, so
runs are comparable), mean `requestAnimationFrame` interval over 5 s. These numbers compare
builds; they are not device or GPU benchmarks.

| Build | Frame interval | Triangles |
|---|---|---|
| Before 7A (`9cebdf1`) | 114–120 ms | — |
| 7A as merged into PR #2 | ~250 ms | 80.7 k |
| 7A + the fixes below | 114–125 ms | 56.2 k |

A test-only bisection switch (`?test=1&off=sky,clouds,floor,platform,walls,underside,…`) dropped
one layer at a time. What it showed and what changed:

- **Hidden pixels are not free.** The underside cost ~45 ms although the platform hides it: the
  software rasteriser shaded its top cap — a disc as wide as the platform — before depth hid it,
  whatever the draw order. The tiers' upward-facing tops are now split off and drawn with an
  unlit near-black material (they are always hidden or in deep shadow under an overhang); the
  underside, monoliths and far formations also draw after the near arena.
- **The low surface shader was never wired.** The dominant-axis, no-normal-map variant of the
  surface material existed but `<Arena>` never received `lowSurfaces`; it does now, and the low
  tier's backdrop (underside, monoliths, far formations) uses a diffuse-only material.
- **Full-screen procedural sky.** Baked once into a cube map on the low tier (above).
- **Walls had no low detail level.** 31 k triangles of bevelled blocks and 3 cm rivets; the low
  level uses one bevel segment and no rivets (sub-pixel on a phone): −24 k triangles.
- **Unused MSAA.** Every tier renders through the post-processing composer, so the canvas'
  multisampling only antialiased the final full-screen copy; it is off.
- Also on the low tier: no cloud sheets (the baked sky carries the cloud sea) and no floor
  normal map (its tile bevels are a pixel wide at that resolution).

The test failure was not only the regression: the same two score-vs-bot tests (simplified-mode
taps and the Phase 05 camera player) had already failed on `main` itself (run 16, the PR #1
merge, all pre-7A code). Their scripted players race a bot that acts every simulation tick, while
their own reactions are paced by page round trips that each wait for a software-rendered frame —
so the outcome depended on the test machine's speed (one local run scored in the last allowed
match, another in none). Two changes, no assertion weakened:

- The touch player reads everything one step needs in a single round trip, taps PULSE at the
  button's position (a locator tap first waited for two stable animation frames) and leads the
  core by its own measured step time.
- Both race tests run the local authority at half wall-clock speed (`?test=1&timescale=0.5`,
  test runs only): rules, physics and every tick are unchanged, only the time between ticks
  grows, giving back the reaction time the software-rendered harness takes from the stand-in.

### A bug the new browser test found

`e2e/phase07.spec.ts` (adaptive quality steps down under a slow renderer) failed on its first run:
the controller ignored every frame longer than 250 ms as a hitch — so a renderer slower than
4 fps, which is exactly when stepping down matters most, never adapted. One or two long frames in
a row (a tab switch, a GC pause) are still ignored; three or more are load (each counted as at
most 1 s). The unit test that had modelled twenty consecutive 2 s frames as hitches encoded the
bug; it now models isolated hitches between normal frames, and a new case checks that a 3 fps
renderer steps down to medium, then low.

### Tests so far

- `atmosphere.test.ts` (5): the field, walls, gates and platform are never fogged; distant
  formations fade progressively; the underside hazes lightly and the depths heavily; the fog
  chunks install once with the shared sky; quality tiers only add cost from low to high (low: no
  shadow maps, bloom, shafts, dust or cloud sheets; a baked sky; one point light).
- `adaptive-quality.test.ts` (6): holds at 60 fps; steps down once after ≥ 5 s at 25 fps, then
  waits for cooldown plus a full hold; ignores a 2 s dip and isolated hitches; steps down from a
  renderer slow on every frame (3 fps); steps back up after a long comfortable stretch, never
  above the start; no oscillation at 48 fps.
- `geometry.test.ts` (+2): the low wall/rail level keeps the footprint with < 45 % of the
  triangles; the underside's tops are split out (all facing up, the widest just inside the slabs)
  and the lit stone has no upward-facing surface left.
- `e2e/phase07.spec.ts`: adaptive quality steps down under load and never on a fixed tier.

### Remaining for the 7B gate

Final-settings captures (all review shots, phone tiers, the D08 flat/dark comparison set) with
the firefly clamp, fog start and baked low sky; a written critique against CREATIVE_TARGET with
two revision rounds; the ART_DIRECTION tier table re-checked against the code.

## 7C — Rift Core and elemental VFX (D09) — NOT STARTED
## 7D — Wielder characters and IK (D10) — NOT STARTED
## 7E — Golden screenshots and art critique (D11) — NOT STARTED

## Next instruction

First milestone **06M — continuous physical manipulation** (ADR-0009,
docs/progress/PHASE-06M.md): the owner wants real people to show they can intuitively bend
physical objects with their hands before the arena's visual transformation continues. Then resume
**7B** (prompts/deep-dives/D08-LIGHTING-ATMOSPHERE.md) at "Remaining for the 7B gate" above:
capture with `node scripts/capture-arena.mjs <url> <dir> <round>` and critique against the
round-5 frames.
