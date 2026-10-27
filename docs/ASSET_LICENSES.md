# Asset and license record

Everything a player downloads or sees, where it comes from and under what terms. Update this file
whenever an asset, model, texture, sound or runtime library is added.

## Art (3D, textures, shaders) — all original

| Asset | Source | License |
|---|---|---|
| Arena architecture: platform slabs, broken rim, wall blocks and brass rails, rift gates (pylons, arch, keystone, rings, beams), monumental columns, underside ribs, floating fragments, distant formations | Generated at runtime from seeded TypeScript generators in `apps/web/src/render/arena/geometry.ts` (this project) | Project code |
| Surface textures (basalt, fractured stone, aged brass, brushed steel: detail + normal maps) | Generated at runtime by `apps/web/src/render/arena/surfaces.ts` (value noise, Worley cells) | Project code |
| Field floor tiles, inlays and markings | `apps/web/src/render/floor-texture.ts` (procedural) | Project code |
| Shaders: triplanar surfaces, goal membrane, element effects, core | `apps/web/src/render/arena/materials.ts`, `render/shaders.ts`, `render/vfx/*` | Project code; the triplanar whiteout normal blend follows the published technique by Ben Golus ("Normal Mapping for a Triplanar Shader", 2017) — an algorithm, no code copied |
| Team glyphs (hexagon / diamond), HUD and UI | `apps/web/src/ui/*` (SVG/CSS written for this project) | Project code |
| Sounds | Synthesised at runtime (`apps/web/src/audio/sfx.ts`, Web Audio) | Project code |

No third-party 3D model, texture, HDRI, font file or sound sample is shipped. The UI uses the
platform's system font stack.

## Machine-learning models (camera control, downloaded on first camera use)

| Model | Source | License |
|---|---|---|
| `hand_landmarker.task` (float16, v1) | MediaPipe model zoo, Google — pinned URL and SHA-256 in `scripts/prepare-vision-assets.mjs` | Apache-2.0 |
| `pose_landmarker_lite.task` (float16, v1) | MediaPipe model zoo, Google — as above | Apache-2.0 |

Test-only (never in a production build): four hand photos from MediaPipe's public test assets,
used to build the fake-camera video for E2E tests (`scripts/make-hand-video.mjs`), Apache-2.0.

## Runtime libraries (bundled)

| Package | Version | License |
|---|---|---|
| three | 0.186.1 | MIT |
| @react-three/fiber | 9.8.2 | MIT |
| @react-three/postprocessing / postprocessing | 3.2.2 / 6.39.5 | MIT / Zlib |
| react / react-dom | 19.3.1 | MIT |
| zustand | 5.0.16 | MIT |
| @mediapipe/tasks-vision (WASM runtime) | 1.0.1 | Apache-2.0 |
| @dimforge/rapier3d-compat | 0.21.0 | Apache-2.0 |
