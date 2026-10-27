# DEEP DIVE D07 — PRODUCTION QUALITY LEVEL ASSETS, GEOMETRY AND MATERIALS

**Execute as Art Stage 7A.** First read docs/CREATIVE_TARGET.md. Your task is to make the world visually unmistakable and authored. Do NOT begin with broad particle noise or a huge UI overhaul. Build coherent architecture and high-fidelity materials.

## Design task
A ring-like *Shattered Meridian* basalt arena suspended in an enormous atmospheric storm chamber. The arena is 3D architectural engineering, not a colored grid. Two massive sculpted rift gates at scoring ends are physically believable mechanisms with rings, inset bronze structural beams, luminous animated membrane, decorative sigils that are original and never copy recognizable franchise symbol sets.

## Content hierarchy / rough geometry
- Macro: thick overhanging platform silhouette, 12–20 large irregular stone slabs with recesses, shattered edge, visible extrusion depth, concentric steel ribs on undersurface, anchored gateways and 3–5 monumental exterior columns.
- Meso: stone bevels, worn corners, carved scoring direction channels, inset hand-forged brass rails, mechanical pivots/hinges, damaged upper perimeter, physically plausible gap and debris layering.
- Micro: triplanar rocky normal noise, surface cracks, roughness grunge, wear masks on edge bevel, small bolts/rivets and emissive scars, balanced material repetition.
- Sky: distant suspended rock formations and monumental silhouettes ~50–500m away visually, volumetric illusion through layered cloud meshes and fog. Never place cosmetic sky objects into collision group.

## Asset strategy
1. Build geometry procedural in TypeScript or use original/licensed glTF assets (if generating via Blender script, commit source .blend or generator script and glTF/GLB under asset budget). Record asset authorship and licenses.
2. Author physically based stone and metal materials with roughness/metalness/normal/AO; use authored patterns and wear. Stone must not look like clean plastic; brass reflects motivated highlight.
3. Use correct meters scale and instancing for repeated decor. Keep collision mesh simple; limit authoritative rigid bodies. Decorative detail never changes net fairness or creates hidden obstacles.
4. Produce at least 3 stone variants (basalt polished, fractured rough, chilled), 2 metal variants (aged brass, cold steel), translucent rift glass, conductive wet material, ice and cracked interior glow. Make them easy to swap through world material state.
5. Use modeling proportions with architectural scale: near-high-quality gate 5–8m tall, floor slab bevel few cm, core roughly human-scale, outer rib silhouettes readable at mobile resolution.
6. Create high and low LOD with consistent silhouette, especially gate; mobile assets cannot collapse into bland primitive placeholders.

## Code boundaries
ArenaVisual.tsx consumes readonly RenderSnapshot and map seed. Static geometry instanced/batched, no physics mutation; colliders defined in shared data. Procedural mesh generation tested for nondegenerate normals/tangents and deterministic seed.
Move artistic parameters to central ArtTokens configuration (roughness, color palette, fog, bloom, time-of-day) and avoid magic numbers in 50 components. De-allocate geometries/materials on unmount.

## Visual inspection gates
- Golden frame at normal 3/4 camera from kickoff, wide hero view, impact near gate, phone landscape.
- Zoom crop review of stone, metal, gate, under-platform silhouettes. Distinct geometry detail and material roughness variation visible; contact shadows ground large forms.
- Scene readability: both goals and core visible, collision-path contrast not obscured, team hues not over-saturated.
- No default BoxGeometry/CylinderGeometry-only world; if procedural primitives are foundations they must form a sculpted authored architectural environment.

## Deliverable
Production world renderer, source assets/generators, art token palette, load/perf report and docs/ART_DIRECTION.md update with captured frames and objective problems to solve next.
