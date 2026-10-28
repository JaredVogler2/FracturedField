# PHASE 07 — Visual production (art gates 7A–7E)

**Status: IN PROGRESS — 7A and 7B COMPLETE (local; phone frame rate not measured); 7C, 7D, 7E NOT STARTED.**
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

## 7B — Lighting and atmosphere (D08) — COMPLETE (local)

The storm breaks over the Shattered Meridian. A warm key rakes long shadows across cool stone,
cloud shadows drift over the field, bronze braziers burn on the rim, rain lies in the stone, and
across the storm sky islands carry lit towers with waterfalls pouring into the cloud sea. The
menu opens on a slow cinematic view down the field into the storm break, instead of the gameplay
camera. The work was paused for milestone 06M and resumed on 27 October 2026, together with the
owner's brief for a world-class 3D experience (docs/3D_VISUAL_STANDARD.md, whose art direction
comes from the owner's two mood references).

Gate: final-settings captures, the D08 comparison set, a written critique, and at least two
revisions. Six capture rounds were made (b1–b6, below), with the tier table re-checked against
the code. The phone frame-rate target (D08: 30+ fps on a tested phone) cannot be measured here:
there is no phone and no GPU.

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
| Key light, revised (rounds b2–b6) | A pale-gold key (`#ffe0bd`, about 3800 K: an orange key turned the blue-grey basalt brown) carrying about four times the floor's ambient (b1: about twice, which read flat); a cooler, weaker fill, hemisphere and IBL; the environment's zenith matched to the storm sky (a bright zenith had mirrored as a white bar on upward metal); lights raised ~35 % in b5 so sunlit black basalt is no longer ~50/255. Tokens: `LIGHTING`, `ENVIRONMENT`. |
| Highlight control | The surface material caps outgoing radiance by its brightest channel, so a glint keeps its hue: 1.5 for stone, 1.1 for metal. Brass got a tighter roughness range (a glint line, not a neon tube); steel is brushed (0.36–0.62). The gate's steel mouth beam got a rounded top, because from the gameplay camera a flat top mirrors the storm break whole. |
| Cloud shadows | `render/key-light.ts`: a tileable noise texture drifting with the wind darkens the key in broad patches on every arena surface and the floor (one texture read; medium and high — the low tier leaves them out to hold its frame cost; frozen under reduced motion). The patch mixes into three's directional-light loop for light 0 only. |
| Baked static shadows (low tier) | `bakeKeyShadowMask()`: the walls, pillars, gates, plinths, braziers and rim columns are rendered once, flattened onto the ground along the key, into a 768-px mask that dims the key on ground-facing surfaces near the floor. The low tier, which has no shadow maps, keeps the light story at no per-frame cost. |
| Practical lights | `render/braziers.tsx`: eight bronze braziers outside the walls (four behind the far wall, two flanking each gate, none on the camera's side). Each has a bronze lathe body, breathing coals, a camera-facing flame sheet of rising noise (deep orange to gold), rising embers, and a flickering warm light pool on the stone (an additive decal, not a point light). All eight together are five draw calls. |
| Rune inscriptions | The pillar bands are an original procedural glyph strip (`render/rune-texture.ts`: a stem plus 1–2 strokes per glyph, seeded) glowing in the rift violet. They used to be a flat saturated ring. The gate motifs and plinth inlays were dimmed (`GLOW`). |
| Storm-wet floor | `render/floor-texture.ts`: rain lies in broad shallow patches and along the joints. Those areas are darker, nearly mirror-smooth and flat, so they catch the sky and the key; about 12 % of the floor is near-mirror (`FLOOR_WET`). |
| Far world | `render/far-world.tsx`: four sky islands at 100–160 m toward the storm break and the north. Six towers carry lit windows, about a third of them lit, some slowly dimming and brightening. The windows fog at half rate, so they read as lights through the haze. Three waterfalls pour into the cloud sea. Three draw calls on every tier. Rock formations no longer stand in the west to north-west sky (`ARENA_ART.formations.openSky`), which is left to the islands and the break. |
| First impression | `render/camera.ts → attractPose()`: the menu's cinematic camera drifts slowly beyond the TIDE end, looking down the field into the storm break. The arena is backlit, the far gate and towers stand dark against the bright sky, and long shadows reach toward the viewer; the break sits in the right half, clear of the menu. Portrait gets its own composition (higher, down the axis, the far gate above the menu). The camera follows the core loosely, never shakes, holds still under reduced motion, and allocates nothing per frame. The menu docks to the bottom on portrait; on short landscape phones it is compact and no longer loses its title above the fold (`.menu`); difficulty buttons are now 44 px. |
| Review tooling | `scripts/capture-arena.mjs` gained the menu views (desktop, portrait low, landscape medium), Physics Lab element close-ups (fire beside ice, the ice ramp, steam, charge on wet stone) and `ONLY=` sections. `scripts/frame-metrics.mjs` reports luma percentiles, clipped pixels and warm-cool separation per frame. |

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

Later, on PR #3 (`51b79c7`), the simplified-mode player again did not score in four matches, on a
commit that changed nothing taps use. Since it moved into the page it had scored in 2 of 7 CI
matches. A headless model of the race — the real sim and the easy bot, the player's decision rule
with its frame and input delays, 60 matches per variant — scored in 58 % of matches and showed
the main reason: the bot steers during the kickoff countdown, while the player waited for play to
start, so the bot reached the core first at every kickoff. The player now takes its place behind
the core during the countdown (it casts only in play), and after a rematch the test hands over
during the countdown rather than after it: 95–100 % of matches in the model. Locally the test then
passed four runs of four, three of them with the page's CPU throttled 2× (frames 141–150 ms) and
one at normal speed under load (175 ms): a goal in match 1 twice and in match 2 once, and once a
round won on the clock in match 1 (the test counts a goal or a round won).

### A bug the new browser test found

`e2e/phase07.spec.ts` (adaptive quality steps down under a slow renderer) failed on its first run:
the controller ignored every frame longer than 250 ms as a hitch — so a renderer slower than
4 fps, which is exactly when stepping down matters most, never adapted. One or two long frames in
a row (a tab switch, a GC pause) are still ignored; three or more are load (each counted as at
most 1 s). The unit test that had modelled twenty consecutive 2 s frames as hitches encoded the
bug; it now models isolated hitches between normal frames, and a new case checks that a 3 fps
renderer steps down to medium, then low.

On PR #3's slower runner the test failed again — "expected high, received medium" — because it
read the tier too late: the menu and the countdown alone outlasted the 5 s hold there, and the
controller had already, correctly, stepped down. The scene now logs when each tier began
(`renderStats.tierLog` in the test hook), and the test checks that rendering began on high and
that the first step down came at least 5 s later, however long the start took.

### Tests (light rig, atmosphere, tiers)

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

### Capture → critique → revision (rounds b1–b6; frames in `docs/visual-evidence/phase-07/7b/`)

Every round comes from the production build: the menu (desktop, phone portrait low, phone
landscape medium), kickoff (1920 × 1080 high), eight review cameras, the D08 flat/dark comparison
(desktop and phone), phones (landscape low/medium, portrait low) and four element close-ups.
Metrics are from `scripts/frame-metrics.mjs`; scores and the full critique are in
docs/3D_QUALITY_REPORT.md.

1. **b1 (baseline, the 7B code as left before 06M).** The final lighting barely differs from the
   "flat" comparison variant (luma range 0.49 vs 0.33; warm-cool 0.09 vs 0.08). Other findings:
   - a white bar on the EMBER gate;
   - pillar runes as flat lilac strips;
   - no light direction at all on the low tier;
   - the menu showed the top-down gameplay camera under a panel.
2. **b2.** Changes: warm key at about 4:1 over the ambient, a dark environment zenith, glyph runes
   and dimmer glows, baked shadows on low, cloud shadows. Low phones now carry long pillar and
   wall shadows. But the orange key turned the basalt brown, metal rails and beams read as neon
   tubes, and the frame got darker (median 0.14).
3. **b3.** Changes: a pale-gold key, stronger cool ambient, a metal cap scaled by the brightest
   channel. The stone reads neutral-warm against blue shadow. Two open problems: the cloud shadows
   were invisible (verified working at strength 0.95, then set to 0.6), and the frame was still
   dark (median 0.13).
4. **b4.** Changes: the first cinematic menu camera, a compact landscape menu, and the clipped title
   fixed. The menu frame was dominated by a dark near slab, and the break was hidden behind the
   menu.
5. **b5.** Changes:
   - lights up ~35 %: kickoff median 0.17, range 0.60;
   - braziers;
   - the far world;
   - the backlit menu camera toward the break: menu range 0.27 → 0.70, warm-cool 0.09 → 0.19.

   Found: the white gate bar was the steel mouth beam (identified by colour-tagging materials);
   tower windows banded into rings (measured around the world origin, not the tower); white flame
   tips; big formations filling the break.
6. **b6.** Changes: rounded steel beam top, per-tower window grids, warm flames, the stone cap at
   1.5, an open sky toward the break, and wet floor patches. Inspected: the towers read as a lit
   city across the storm, the floor carries damp sheen, and the kickoff keeps clear shadows with
   brazier accents.

Selected metrics (b1 → b6):

| Frame | median luma | range (p95 − p5) | clipped % | warm-cool |
|---|---|---|---|---|
| kickoff, high | 0.185 → 0.162 | 0.49 → 0.58 | 0.000 → 0.000 | 0.09 → 0.11 |
| menu, desktop | 0.130 → 0.175 | 0.26 → 0.70 | 0.000 → 0.008 | 0.09 → 0.20 |
| hero | 0.185 → 0.188 | 0.48 → 0.58 | 0.001 → 0.002 | 0.20 → 0.21 |
| phone landscape, low | 0.194 → 0.136 | 0.41 → 0.47 | 0.002 → 0.007 | 0.15 → 0.15 |
| fire + ice (R6) | 0.217 → 0.238 | 0.63 → 0.75 | 0.086 → 0.141 | 0.12 → 0.12 |

The D08 comparison set is kept as rejected variants: `flat` (range 0.35) and `dark` (median
0.04). The final sits between them, with the light story `flat` lacks and the shadow detail
`dark` crushes.

Render counts in b6 (all passes; counts, not benchmarks):

| View | Draw calls | Triangles |
|---|---|---|
| Gameplay, high | 163 | 194 k |
| Phone landscape, low | 86 | 64 k |
| Phone portrait, low | 82 | 57 k |
| Menu, desktop | 159 | 177 k |

These are within docs/3D_VISUAL_STANDARD.md's budgets.

### D08 checklist

- **Lighting direction:** a storm-break key from one high side; a golden rim on brass (capped
  glints); a cool fill; the core as a local glow; a shadow story on every tier (low: baked);
  distant props lighter and bluer (aerial perspective).
- **Render:** sRGB output, ACES filmic with tunable exposure, a constrained shadow area, 1–3 point
  lights by tier, a procedural sky with drifting layers, fog layered behind the playfield, shafts
  and dust in the key (medium/high).
- **Post:** selective thresholded bloom, a low vignette, no full-screen distortion; reduced motion
  freezes cloud drift and steadies flame flicker.
- **Tiers:** the parameter table is in docs/ART_DIRECTION.md (re-checked against `QUALITY`, with
  the 7B additions); adaptive quality with more than 5 s of hysteresis; the dev HUD shows counters.
- **Comparison captures:** flat / dark / final at 1920 × 1080 and 844 × 390; fire, ice and wet
  surfaces under the final light: no clipping above 0.15 % of pixels, and the materials stay
  distinguishable.
- **Gate:**
  - The idle arena now reads with scale and depth (inspected).
  - "30+ fps on a tested phone" is **not measured**: SwiftShader only.

### Tests (7B revisions)

Unit tests:
- `key-light.test.ts`: the patch touches only directional light 0, after its shadow; the mask
  orientation; the cloud texture tiles seamlessly.
- `rune-texture.test.ts`: glyph coverage and dark margins; deterministic per seed.
- `camera.test.ts`:
  - the menu camera stays outside the field and above its walls;
  - the centre and the far gate are framed;
  - the break is in the right half at four aspect ratios;
  - portrait has the far gate above the docked menu;
  - the motion is continuous;
  - no allocation per frame.

312 unit tests pass in total (typecheck, lint and format clean). The browser suites run in CI.

### Honest limits

- **Not real performance or real devices.** Every frame is a headless SwiftShader render. There is
  no GPU, phone or Safari evidence, and frame-rate targets are unmeasured.
- **Scores are self-assessed.** The rubric scores in docs/3D_QUALITY_REPORT.md are the developer's
  own inspection, not a panel's.
- **The floor is still a regular flagstone grid.** Wet patches and shadows break it up; a slab
  layout revision remains open (WP7).
- **Distant formations are faceted rock shapes.** The towers are simple lathes: silhouettes read,
  detail does not.
- **The Rift Core and element VFX (7C) and the wielders and hands (7D) are not started.** The fire
  is still cones and the water a flat decal.

### Commits

- `11267c9` — Phase 7B: lighting and atmosphere (code, tests, evidence, the 3D visual program
  docs).
- The tier log for the adaptive-quality test, the CI notes above and the 7B hash in the build
  status: the commits that follow `11267c9`.

## 7C — Rift Core and elemental VFX (D09) — IN PROGRESS

7C runs in two parts: the Rift Core hero asset first (D09 §Rift Core), then the element systems
(D09 §Ability VFX) and the ten-condition evidence. This section is being written as the work
goes; nothing here is complete until its gate is met.

### The Rift Core (in progress)

Built (`apps/web/src/render/core/`):

- **Look from state** (`core-look.ts`, pure, tested): smoothed energy from speed (full at
  18 m/s), the deliberate spin, heat from temperature (40 → 160 °C), charge, wetness, an impact
  flare from the impulse (decays in about 0.25 s), and the goal → collapse (0.6 s, D09: under
  1.5 s) → gone → kickoff → form (0.5 s, a slight overshoot) cycle. A collapsed core forms again
  after 6 s if the kickoff event is lost. Reduced motion keeps the plates nearly still and halves
  the flashes. Nothing here decides an outcome.
- **Geometry** (`core-geometry.ts`, tested): a broken shell of crystal plates (the faces of an
  icosahedron, shrunk so seams open between them, corners jittered so neighbours still meet,
  each plate tilted and lifted on its own, about a fifth left out) with outer and inner faces and
  side walls; per-vertex attributes for the shader (plate direction, wall/face, depth across a
  wall, barycentric corners, a seed). Two engraved gyroscope bands with a rectangular section;
  the runes map onto the outer face only.
- **Materials** (`core-materials.ts`): the plasma heart, shaded as a volume (filaments where two
  drifting noise fields cross, sampled at depth along the view ray: 3 steps on medium and high,
  1 on low); the plates as polished dark crystal you look into — each facet refracts the view
  ray, meets the heart and shows its plasma there, displaced per facet as in a cut gem, clear
  face-on and mirror-like toward grazing; light from the seams, a hairline round each facet and
  cracks across some plates, all brightening with spin; and an aura, the far side of a slightly
  larger sphere, which rings the silhouette with a halo on every tier.
- **Behaviour** (`CoreVisual.tsx`): the plates part along their own directions with spin and on
  an impact; the bands turn with energy and spin; heat warms, charge whitens (and flickers) and
  water dulls the light. While the core is small on screen (a phone, a far camera) the heart
  brightens and swells into the shell and fine lines fade, so it does not alias into speckle;
  a rift spark (the heart's hot centre) gives a phone a focal point. Its light is the scene's
  always-mounted core light, so a goal's collapse never changes the light count (which would
  recompile every lit shader).
- **Trail** (`CoreTrail.tsx`, replacing the flat ribbon of Phase 02; `trail-path.ts`, 6 tests): a
  camera-facing ribbon along the path the core took, its samples 0.18 m apart however far the core
  went in a frame (so it is as long at 30 fps as at 120), as wide and bright as the core's
  authoritative speed, tapering to a point, a hot line down its middle, the core's seam colour, a
  slight chromatic fringe on high only; steam veils it, a goal fades it, a teleport never streaks
  across the arena and a core at rest starts a new one.

Capture → critique → revision (`node scripts/capture-arena.mjs` with `ONLY=core,phones`: a still
of the core in the Hands Lab with a camera that follows it, the core moving in a match, high and
low; the phones):

1. **c1 (baseline, the core before 7C).** A white ball that read as a soap bubble, with two plain
   brass hoops.
2. **c2.** The first plate shell: a black geodesic "disco ball" that hid the heart entirely.
3. **c3.** Missing plates open windows onto the heart, but the shell still read as a geodesic.
4. **c4.** Tilted, jittered plates read as a fractured violet geode close up, but the core was
   dark and hard to find on the phone.
5. **c5.** A brightness boost while the core is small on screen. Side by side on the phone with
   the b6 core, the old white core read at once; the new one aliased into speckle.
6. **c6.** The rift spark and an even glow over the faces when small. Close up, the plates read
   as pale lavender plastic tiles, each with a dark centre and a broad glow along its edges: the
   regular geodesic look again.
7. **c7.** The look-through crystal (above), hairline edges and cracks instead of the broad
   glow, the aura, one plasma function and phase shared by heart and plates. Close up, far richer:
   each facet shows its own piece of the plasma, as cut glass does. But face-on everything was
   bright violet, the filaments read as marble veins rather than light behind glass, and the
   polished reflections were washed out. On the phone a smooth bright disc, with some dark speckle
   left.
8. **c8.** The view through the plates keeps the bright filaments but only about a third of the
   heart's base violet (dark glass, light inside); clarity 0.7; while small, the heart swells
   into the shell. Close up, dark crystal with the plasma showing through. In motion the aura
   rings the core and the seams light into a bright lattice around dark facets: the strongest
   look yet. But the filaments were thin even lines (marbled stone rather than light in glass),
   the reflections faint, and on the phone the darker faces made the speckle worse, not better.
9. **c9.** Filaments as a bright line in a soft glow; on medium and high a second, fainter layer
   deeper in the heart behind each facet; stronger reflections; and while the core is small the
   heart's own violet comes through (a bright ball far away, dark crystal close up). Close up the
   plasma reads as light inside faceted glass; on the phone the core is the brightest object on
   the field, with less speckle (some remains).

Open on the core: some speckle at phone size; c9 lost part of c8's dark-crystal contrast close
up.

Frames (headless SwiftShader; inspected, not GPU or phone evidence) are in
`docs/visual-evidence/phase-07/7c/`: the close-up in rounds c1, c4, c6, c7, c8 and c9 and
side by side c1 against c9; c9 on the low tier, moving on high and low, and on the phones (with
`arena-stats-c9.json`); the phone close-ups c5 against b6 and c7 against c8 and c9. Render
counts in c9 (all passes): the Hands Lab close-up 101 draws and 164 k triangles on high, 49
and 44 k on low; phone landscape on low 90 and 64 k.

Tests: `core-look.test.ts` (10: rest, energy smoothing, spin either way, impact decay and a
weaker hit during a stronger one, heat/charge/wet, the goal → collapse in under 1.5 s → kickoff →
form cycle with its overshoot, a kickoff during the collapse, a lost kickoff, reduced motion,
NaN/Infinity input) and `core-geometry.test.ts` (4: plate counts with and without holes and
per seed, attribute ranges, outer faces facing out and inner faces facing the heart, the band's
glyph strip on its outer face). The look and the geometry fail these tests if they regress; the
shaders are judged on frames only.

Honest limits (the core):
- Every frame is a software render. Shader cost on a phone GPU (the plates sample the plasma
  per pixel, twice on medium and high) is not measured.
- The collapse into the gate and the trail are now seen in frames (the ten-condition evidence
  below); the forming at kickoff is tested as numbers only.

### The element systems (in progress)

Each system is its own module under `apps/web/src/render/vfx/`. It reads only authoritative
state (snapshot effects, entity element state, events) and decides nothing.

- **Water and ice** (`water-ice.tsx`; `ice-state.ts`, pure, 7 tests; `water-ice.test.ts`, 3
  tests): pools darker toward their depth, ripple rings and foam round the bodies standing in
  them, a broken shore foam band, branching surface arcs while electrified. The ice plate is the
  collider's own frustum cut into facets (corners move by at most 4 %, tested). It freezes in
  from the rim over 0.35 s when the pool's ICE flag sets (the collider exists at once), over the
  water, which stays where the front has not reached and fades out as it closes. It has a
  spectral rim (iridescence) on medium and high, cracks radiating from strikes, frost toward its
  base and a deeper blue toward its thick middle. A thaw takes it back into the pool over 0.5 s;
  a break (`shatter`) throws crystal fragments from the strike and the water is back at once.
- **Fire** (`fire.tsx`; `wind.ts`, 4 tests): flame tongues on camera-facing cards with noise
  flowing up them. They lean with the crosswind the authority uses to carry the flame (`wind.ts`
  mirrors its falloff and fades). Embers convect and drift downwind, and a glowing bed stands in
  for a light (a light that came and went would recompile every lit shader). A flame that leaves
  while still burning goes out over 0.45 s; online the snapshot drops it before the douse event
  is due, so leaving is enough. On high, the air above each flame shimmers (`HeatHaze.tsx`,
  `heat-haze.ts`, 3 tests): the composer's pass bends the frame in a plume over up to four
  authoritative flames, by about three pixels at most, in thin bands drifting upward.
- **Steam and smoke** (`plumes.tsx`): lit, depth-sorted puffs in one draw call. Steam regions rise
  toward the height where their updraft ends, smoke rises above flames, and douse, quench and boil
  throw steam. Fractures and crumbling guards throw dust that settles.
- **Electric** (`electric.tsx`; `bolt-path.ts`, 5 tests): branching arcs along each CHARGE event's
  conduction links, between the authority's own node positions. They are seeded from the event,
  so both devices draw the same lightning, bow well up between conductors, brighter than the
  charged water's own crackle, and restrike within 0.35 s; conductors flare and spark.
  Reduced flashes halves the restrike flicker, and nothing lights the whole screen.
- **Air** (`FieldEffects.tsx`, `ribbons.ts`): straight streamlines flowing downwind, brightest
  where the authority's push is strongest, dashed wisps along the field's two edges and fine dust
  carried along. Pale, with a hint of the caster's colour.
- **Gravity** (`gravity.tsx`): a dark heart with a violet rim and a lensing-ring approximation (the
  frame is not distorted and the camera never warps). Field arcs flow in, shards orbit faster
  closer in and motes spiral down.
- **Magnet** (`magnet.tsx`): flux ribbons to each lodestone in range, dashes flowing toward it,
  brighter the closer it is; field loops turn round the force point.
- **Earth and the guard** (`Entities.tsx`, `EventEffects.tsx`; `guard-columns.ts`, 4 tests): a
  guard is basalt columns inside the collider's box (never past it). They rise from the middle out,
  each within 0.2 s, with a team-coloured seam on each top; the cast throws a ripple and stone
  chips, and a guard that runs out crumbles. Stones show glowing seams after a hard hit, as bright
  as the impulse, and pulsing seams while thermally shocked; fractures throw lit, irregular chips,
  a few sparks and settling dust.

Capture → critique → revision (`ONLY=elements node scripts/capture-arena.mjs`; the Physics
Lab's reaction fixtures with the close camera). A moment after an event is captured by seeking to
its tick and stepping one tick, e.g. `ELEMENT_TICKS=R5:11+1`; since round ev the lab draws frame by
frame, so the moment is exact.

1. **e1 (the baseline, on the core build).** R1 at tick 60 on high: the ice was a flat pale disc
   and the guard a white box with a cyan edge.
2. **e2 (the first build of the systems, low tier).** Fire read as flame tongues instead of round
   blobs, steam as soft lit billows, water with depth and a foam edge, the ice as a faceted plate,
   the guard as basalt columns. Critique: the ice was too white (sky wash, white fine cracks) and
   had a dark dot at its centre, which was a hole (the ragged freeze front cut pixels even when
   the plate was frozen); the fire bed read as spilled paint; the air read as a ring, not a
   crosswind. The event moments came out empty: the stepped tick must be the event's own.
3. **e3–e4 (the event moments).** The gravity well: a black heart with a bright lensing ring, arcs
   spiralling in, orbiting shards. The charge chain: electrified pools full of surface arcs, the
   guard breaking into chips. The fracture: the authority's shards, chips and dust. The quench:
   steam over the soaked hot stone, with thermal-shock seams. The melt. Critique: the discharge
   bolts were drawn (five arcs, read back through a temporary debug hook) but ran close to the
   water and merged with its surface arcs; the chips looked like black confetti.
4. **e5.** The ice is deeper and translucent (the floor shows through it on high) with no hole;
   the fire bed is softer; the bolts bow up, wider and more violet; the air streamlines run
   straight and parallel with edge wisps along the wind; the chips are lit and irregular.
5. **ev (the D09 evidence round).** Assembling the ten conditions turned up six faults, all fixed
   before the evidence frames were taken, and one framing problem.
   - **The captures were a lottery.** Under load the software renderer drew a frame in 0.7–1.2 s
     and took 5–7 s per screenshot (measured: the first shot 7.3 s after the key press), so an
     effect lasting a fraction of a second was gone before the shot, and `ELEMENT_STEP_MS` meant
     nothing. The charge arcs had been drawn all along, but the e4 and e5 charge frames show only
     the water's crackle: the e5 line above that the bolts "bow up, wider and more violet"
     described the code, not anything a frame showed. The Physics Lab can now draw frame by
     frame (`frames=manual`: R3F's `advance` draws one frame at an exact render time), and the
     capture script steps the fixture a tick at a time with one frame per tick, then shoots an
     exact render time after the event (`R5:11+1` with `ELEMENT_STEP_MS=50` is the charge 50 ms
     after it struck). Playing on with the space bar also overshot (the screenshot took long
     enough for the lab to play on), so a play-on is now ticks and frames too.
   - **The lab ran moving bodies ahead of their tick.** Its client extrapolated up to 100 ms past
     the newest snapshot while the lab sat paused, so a paused frame showed the core up to 1.4 m
     ahead of the tick it named, by a different amount each frame (read back through a temporary
     probe). The lab's client now shows each published tick exactly (3 tests).
   - **The core's trail depended on the frame rate.** It laid a sample only when the core moved
     0.18 m within one frame: at 60 fps a core slower than about 11 m/s left no trail at all
     (at 120 fps, slower than 22 m/s); at a software renderer's few frames per second the trail
     ran long; and a short trail ended in a full-width square edge (the flat rectangle beside the
     core in the first R1 frames). `trail-path.ts` now lays samples 0.18 m apart along the path
     whatever the frame rate (6 tests); the fade and the taper run its actual length, so it
     always ends in a point.
   - **The water's crackle outshone the discharge.** The charged water's arcs (a state) were
     brighter than the charge arcs (the event that charged it). The crackle is now under half as
     bright; the arcs are brighter, with a wider glow, and bow higher between conductors.
   - **The freeze front crossed bare floor.** A pool hid its water the moment it froze, so the
     plate's open middle showed the floor, a hole rather than water crystallizing from the rim.
     The water now stays where the front has not reached and fades as it closes (ice-state test).
   - **The trail was too faint** to read against the stone once it followed the path: it is 1.8×
     brighter and fades more slowly along its length.
   - **Framing: R2 cannot show the guard**: from its close camera the SE pillar hides it. The
     ricochet comes from R3's control variant (no steam: the shot hits the guard at tick 71,
     impulse 199) with a camera placed by hand (`ELEMENT_VIEW`), and the goal from a camera in
     front of the gate.
6. **After ev: heat refraction and phone views.** The fire now has D09's restrained heat
   refraction on high (above). It joins the composer's existing pass: a match still links 52
   programs on high. Side by side at R6 tick 40, the core's band and a wind streak above the flame
   ripple; nothing else in the frame moves. The ten conditions were also shot on a landscape
   phone (iPhone 13 at 2×, low tier, `ELEMENT_DEVICE=landscape`): every one stays identifiable,
   the core small but the brightest thing in view.

Frames (headless SwiftShader; inspected; not GPU or phone evidence) are in
`docs/visual-evidence/phase-07/7c-el/`: ice e1 → e2 → e5 (low and high), air e2 against e5,
the charge chain and the fracture e4 against e5, and fire and wind beside ice, steam, the gravity
well, the quench and the melt. Round ev is in `docs/visual-evidence/phase-07/7c-ev/`: the ten
conditions on high, on low and on a landscape phone (one sheet each), the charge chain, the stone
impact, the ricochet and the goal full size on high, the charge chain as e5 captured it against
round ev, and the fire at R6 before and with heat refraction.

Open (element systems):
- The steam reads as a soft column rather than distinct rolling billows, on both tiers; it has no
  vision veil (optional in D09).
- Air is a directional gust in this ruleset, so "air vortex" is shown as its streamlines; there
  is no rotating vortex to draw.
- Shader compatibility in Safari is not tested (no WebKit here).
- The element systems' draw calls are not measured (one or two per active effect by
  construction; the Physics Lab page reports no render counts). Their shader programs are
  counted below.

### The ten conditions (D09 evidence)

Physics Lab fixtures, drawn frame by frame (`frames=manual`) on high and low; the tick each frame
shows is logged by the capture script. Frames in `docs/visual-evidence/phase-07/7c-ev/`.

| D09 condition | Moment | What the frames show |
| --- | --- | --- |
| Fast core spin | R1 control, spin 14 rad/s set at tick 57, then 15 ticks drawn (`R1/control:57~14*500`) | The spin swirl circling the core, its seams brighter and plates parted; its trail along the path it flew toward the guard |
| Stone impact | R8, 150 ms after the fracture (`R8:5+1`) | The boulder bursting into lit chunks and chips over a dust puff, a shock ring spreading on the floor |
| Wet/freeze | R1, 150 ms after the freeze (`R1:0+1`) and at tick 60 | The plate closing in from the rim over the still-liquid water, frost sparkling at its open middle; then the finished faceted, translucent plate with crack lines, the core against it |
| Steam burst | R10, 600 ms after the quench (`R10:28+1`); R3 at tick 40 | A steam column rising from the foaming pool round the red-hot, cracked stone; the steam over R3's fire, veiling the core it lifts |
| Charge chain | R5, 50 ms after the discharge (`R5:11+1`) | The arc leaping from beside the core into the first pool, across to the second and on toward the guard, forking, a strike ring on each conductor; the soaked guard bursting into chips |
| Air vortex | R9 at tick 20 | The two gusts' streamlines across the field (the air ability is a directional gust: there is no rotating vortex to show) |
| Gravity curve | R7 at tick 18; then 12 ticks drawn from tick 12 (`R7:12*400`) | The well's dark heart and lensing ring, field arcs flowing in, shards orbiting; the core's trail as the well pulls it in |
| Fire + wind | R6 at tick 40 | The flames leaning downwind into the ice they melt, wind streaks across the floor, the core above heated red at its rim |
| Shield ricochet | R3 control, 100 ms after the hit (`R3/control:71+1`) and 12 ticks drawn from tick 64, from a camera at the guard | The core against the basalt columns, its seams flaring, a shock ring at the contact; then the core rebounding, the ring still spreading, sparks between them |
| Scored goal | R1, 300 ms after the goal (`R1:164+1`) and 7 ticks drawn from tick 156, from a camera at the gate | The core at the gate mouth; then collapsing into the portal as it flares and throws cyan and amber motes, the score ring sweeping the floor |

### WebGL contexts over ten matches (D09 failure criteria)

D09 rejects a WebGL context leak after ten rematches. A rematch inside a match keeps its canvas;
what makes contexts is the menu round trip (every match started from the menu, and every return
to it, mounts a new canvas). `e2e/phase07-rematch.spec.ts` counts the page's contexts as they are
made (weak references, so counting keeps none alive) and, after every switch, the ones still alive
(neither lost nor collected): ten matches from the menu and back make 21 contexts, and after each
switch exactly one is alive, the view on screen. Twenty-one is more than the sixteen a page may
keep, so a leak would also have made the browser drop one (the test fails on that warning too).
The first version of this test (pushed in `56db850`) only waited for that warning, which six
round trips (13 contexts) can never trigger. The new test passed locally in 4.9 min (with the
CPU shared with a capture batch); the six-trip version took 1.2 min on CI.

### Shader programs (counts, not timings)

`node scripts/probe-programs.mjs` lists every program a page links in 45 s of a bot match (a
match view compiles all of them when it mounts: the join freeze on a slow device). Before 7C (the
build of `567aa71`: the Phase 02 core and effects) a match linked 40 programs on low and 47 on
high; with the 7C core and the element systems it links 45 and 52. By their defines, the new
ones are four double-sided shader materials, the physical ice material (clearcoat and
iridescence on high), a textured sprite material and two plain shader materials; three
vertex-colour programs of the old effects are gone.

### Tests (round ev)

- Unit: 366 tests pass (42 files), among them the trail path (6), the snapshot buffer (3) and the
  revised ice-state test; typecheck, lint and format are clean.
- Browser, local (headless SwiftShader): the ten-match context test passed (4.9 min). With a
  capture batch running alongside (software GL at full load on the same four cores), the Physics
  Lab test and the Hands Lab mouse test passed, while the online loadout test timed out opening
  its room and the Hands Lab camera test's throw fell short (the core reached −8.6 m, not past
  −12.5 m). With the CPU free, both passed (2 of 2, 3.2 min).
- The evidence captures exit non-zero on a page error, a shader or WebGL console error, or a
  frame that never rendered; all ten capture runs (30 frames) exited 0.

### Commits (7C)

- The Rift Core hero asset (the section above through c9): "Phase 7C: the Rift Core, a crystal
  shell over a plasma heart".
- The element systems: "Phase 7C (in progress): element systems as modules on authoritative
  state" and "Phase 7C (in progress): element revisions from capture rounds e2–e5".
- Round ev: "Render: the core trail lays its path by distance, the same at any frame rate", "Render:
  the discharge leads, the charged water's crackle follows", "Physics Lab: exact ticks and exact
  frames for evidence captures", "Render: water stays under a freeze front; the core trail reads
  against the floor" and "Browser test: ten matches from the menu, each view releasing its WebGL
  context".

## 7D — Wielder characters and IK (D10) — NOT STARTED
## 7E — Golden screenshots and art critique (D11) — NOT STARTED

## Next instruction

**7C, continued** (prompts/deep-dives/D09-CORE-ELEMENTAL-VFX.md): the ten-condition evidence is
assembled (round ev; frames in `docs/visual-evidence/phase-07/7c-ev/`) on high, low and a
landscape phone, and the fire has its heat refraction. Before the 7C gate review:
- the steam as rolling billows rather than a soft column;
- Safari: shader compatibility needs a Safari browser (WebKit is not installed here) — a limit to
  record, or a check for the owner on a device;
- then the gate review against D09's gate statement, and 7D.

The plan (docs/3D_IMPLEMENTATION_PLAN.md, WP8) adds rune circles where casts land.

Capture with `node scripts/capture-arena.mjs <url> <dir> <round>`: `ONLY=elements` with
`ELEMENT_TICKS` (`R5:11+1` an event moment, `~14` a spin, `*400` a play-on, `R3/control:71` a
control variant), `ELEMENT_STEP_MS` (render time after the event), `ELEMENT_QUALITY`, `ELEMENT_CAM`
`ELEMENT_VIEW` (a camera placed by hand) and `ELEMENT_DEVICE` (`landscape` or `portrait`, a
phone); `ONLY=core,phones` for the core. Compare against the
ev, c9 and b6 frames.
