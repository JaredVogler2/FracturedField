# FRACTURE FIELD — Art direction (living document)

North star: [CREATIVE_TARGET.md](CREATIVE_TARGET.md). This file records what is actually built,
the recipes behind it, and the problems still open. Screens are captured from the running game
(docs/visual-evidence/phase-07/), never from standalone mock-ups; the capture/critique history is in
[progress/PHASE-07.md](progress/PHASE-07.md).

## World: The Shattered Meridian

A colossal engineered platform of black basalt and forged brass, suspended in the eye of a storm.

- **Macro:** the field (42 × 25 m, collision unchanged) sits on 19 large bevelled basalt slabs,
  1.4–2.6 m thick. Beyond the first ring (flush with the floor) the slabs have settled to stepped
  heights; some rim slabs have sunk and tilted; four bites are broken out of the rim and shed
  fragments that hang in the updraft below. Three slabs are rift-cracked: violet light in jagged
  fissures, translucent crystals growing out of them, rubble on the rim beside them. Beneath, an
  inverted stepped stone mass, concentric steel ribs with radial spokes, and two glowing conduits
  held by steel clamps. Four monumental broken columns stand on the rim behind the action (any
  column on the camera's side is hidden).
- **Gates:** each scoring end is a rift gate — tapering pylons on stepped footings with brass-framed
  panels, a thick pointed (two-centred) arch with a brass soffit, a keystone carrying the seat's
  motif (hexagon for EMBER, diamond for TIDE — the HUD glyphs, so the cue never depends on colour),
  bronze tie beams, a steel mouth frame, gyroscope rings that turn on a hub with spokes (axle,
  hanger and keystone bracket behind them) and spin faster when the gate is scored on, and the
  luminous receiver membrane behind the scoring plane. Behind each gate a channel carved along the
  scoring axis splits the slabs, brass laid in its bed.
- **Meso:** bevelled slabs, blocks and capstones, dark joints, thin riveted brass trim along every
  wall coping (the boundary line), fluted pillars with banded stone capitals and glowing rune
  bands, plinths for the wielders behind the far wall.
- **Micro (textures):** mottled polish with rare thin fissures on the slabs; weathered fractured
  basalt with jagged cracks and hairlines on gates and columns; pits; worn bevels; brushed steel;
  brass that is bright worked metal with sparse oxide.
- **Far:** suspended rock formations from 70 to 320 m in the storm haze.

## Palette (sRGB, `apps/web/src/render/art-tokens.ts → PALETTE`)

| Token | Hex | Use |
|---|---|---|
| skyAbyss | `#071421` | sky void |
| storm | `#12364A` | storm body, fog |
| basaltShadow / basaltPolished | `#202830` / `#343B42` | stone midtones |
| coldSilver | `#9AAAB7` | steel highlights, UI text |
| brass | `#C18B53` | forged brass |
| amber (EMBER, seat 0) | `#FF9C46` | team light, hexagon motif |
| cyan (TIDE, seat 1) | `#50D8E8` | team light, diamond motif |
| riftViolet | `#9C7DFF` | rift energy, glowing cracks, rift glass |
| icePale / waterDeep / earthInterior / arc | `#BEEFFC` / `#0D688A` / `#C76D32` / `#C7B7FF` | elements |

## Materials (`SURFACES` recipes → `arena/materials.ts`)

One triplanar `MeshStandardMaterial` extension serves every surface (one shader program):
world-space sampling of procedural tileable textures (no UVs needed on generated geometry), a
macro-variation sample that breaks the tile repeat, whiteout-blended normal maps, cavity darkening,
metalness lowered where the cavity channel marks oxide or dirt, edge wear on bevels, per-vertex
value variation, and live `wet` / glowing-crack uniforms. `applyRecipe()` switches a surface to
another recipe at runtime without recompiling — how world material state (chilled, charged…) will
change a surface in 7C.

| Recipe | Family | Albedo range | Roughness | Metal | Tile | Use |
|---|---|---|---|---|---|---|
| basaltPolished | basalt | `#14191F` → `#46505A` | 0.30–0.72 | 0.04 | 3.2 m | slabs, wall blocks, capstones |
| basaltFractured | fractured | `#191C21` → `#565A60` | 0.62–0.95 | 0.03 | 2.6 m | gates, columns, pillars, plinths |
| basaltChilled | fractured | `#25333D` → `#A9C3D1` | 0.45–0.85 | 0.02 | 2.6 m | chilled state (swap target) |
| basaltDeep | fractured | `#0D1014` → `#2A2F35` | 0.75–0.98 | 0.02 | 5 m | underside, goal cavity |
| basaltRubble | fractured | `#15181C` → `#464B52` | 0.70–0.96 | 0.02 | 1.8 m | shards, rubble (no edge wear) |
| basaltFar | fractured | `#1C2026` → `#5A6068` | 0.75–0.98 | 0.02 | 8 m | distant formations |
| riftCracked | rift | `#16141B` → `#46434F` | 0.55–0.90 | 0.03 | 5 m | cracked slabs, violet glow 3 |
| brassAged | brass | `#4A2F17` → `#E6AD6C` | 0.16–0.70 | 1.0 | 2.2 m | trim, bands, beams, posts, inlays |
| steelCold | steel | `#3C454E` → `#A2B0BB` | 0.24–0.58 | 0.95 | 1.8 m | ribs, frames, rings, clamps |

Rules learned in review: brass is an accent (edge trim, bands, rods) — a broad horizontal brass
face mirrors the dark sky and reads as camouflage; rocks get no edge wear (the normal-based wear
mask would cover them); every geometry drawn with a surface material carries a vertex colour.

Rift glass (`createRiftGlassMaterial`): premultiplied translucent crystal with fresnel facets and
light rising from the root. Water, ice and the electric/thermal states keep their Phase 04 shaders
(`render/vfx`) until 7C.

## Generators and budgets (`arena/geometry.ts`, tested in `geometry.test.ts`)

| Generator | Output | LOD | Guarantees (unit-tested) |
|---|---|---|---|
| `platform` | slabs, cracked slabs, channel inlays, rubble and crystal spots | — | deterministic; 12–20 slabs ≤ 60k triangles; nothing near the surface inside the field outline; first ring flush, outer slabs step down; channels on the scoring axis; rim ≥ 1.5 m outside the field |
| `offsetInward` | slab joints | — | every edge of convex and concave polygons moves exactly d inward |
| `wallBlocks` / `capRail` | blocks + capstones / brass edge trim | — | fill the run at the visual height; trim stays on the coping |
| `gate` | stone / brass / steel / motif / rings | high 48 / low 16 segments | the goal mouth stays empty; ≥ 7 m tall (12.4 m); low LOD < 70 % of high triangles |
| `fieldPillar`, `plinth`, `goalPosts`, `gateCavity` | props on their colliders | high / low | never reach a core touching the collider; inlay on the drum's bearings |
| `monolith`, `underside`, `rock`, `crystalCluster` | columns, supports, fragments, crystals | high / low | deterministic, finite positions, unit normals |
| all | — | — | position, normal, uv and colour attributes on every output |

Surface textures: 256 px (low tier) / 512 px (medium, high) per tile, five families generated once
at load: 0.9–1.2 s at 512 px and ~0.3 s at 256 px in headless Chromium on this container (moving
to a worker with a cache is a Phase 11 item). Render counters per view and tier:
`docs/visual-evidence/phase-07/arena-stats-r5.json`.

Tools: `node scripts/capture-arena.mjs <url> <dir> <round>` (golden frames + counters),
`pnpm preview:surfaces <png>` (texture sheet).

## Open problems (next)

- **7B:** exposure and contrast are low; distant formations are flat dark silhouettes because the
  fog colour is darker than the sky behind them; no cloud layers; no ambient occlusion or contact
  shadows beyond shadow maps (high/medium) and the baked cavity/facing terms.
- **7C:** world element state does not yet drive the surfaces (`applyRecipe`, `uWet`, crack glow);
  no "impact near gate" frame without impact VFX.
- **7E:** normal-based edge wear also marks curved surfaces; the field floor's veins can read as
  lightning at gameplay distance; the gate hides entirely in end-on (portrait) views — a fade would
  be gentler.
- **Phase 11:** texture generation on the main thread.
