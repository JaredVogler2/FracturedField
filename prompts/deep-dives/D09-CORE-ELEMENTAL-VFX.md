# DEEP DIVE D09 — HIGH-END 3D RIFT CORE AND EIGHT REAL ELEMENTAL VISUAL SYSTEMS

**Execute as Art Stage 7C.** Make elemental powers breathtaking and always rooted in the actual physics/material state. The core and spells are signature game identity, not generic default particle emitters. Read docs/CREATIVE_TARGET.md.

## Rift Core hero asset
Build a sophisticated layered animated energy orb/ancient reactor:
1. Author actual core geometry: faceted fractured mineral or polished translucent polyhedron, multiple concentric shells, hairline emissive cracks tied to spin, interior pulsing volume illusion via view-dependent Fresnel, etched gyroscopic halo rings orbiting around it.
2. Shader inputs: authoritative position/velocity/spin, thermal scalar, charge, wetness, impact magnitude, camera direction and time. Never invent velocity unrelated to simulation.
3. Trail: motion-derived streak ribbons with fading width/opacity based on physical speed; keep readable against arena. Small controlled chromatic fringe and motion blur only high tier.
4. On impact, emit sparks/dust/shell disturbance proportional to impulse; respond with audio trigger and brief bloom. Active goal entry collapses core into gate in <1.5 seconds then reset via canonical game event.
5. Lower-tier variant still has material depth, halo silhouette and motion trail, not a plain sphere.

## Ability VFX systems (separate modular classes/components)
**Water:** GPU sheet/spline ribbon shaped by authoritative fluid/field region, flowing normals, Fresnel/specular, depth fading, droplets and foam at contacts, wet decals follow actual region coverage. Real collision only through region/body sim.  
**Fire:** layered flame tongues/flow maps with ember convection, incandescent debris and restrained heat refraction, state tied to heat field and wind advection. Never represent water/steam reaction by simply disabling orange mesh.  
**Air:** wispy ring spirals and fine dust particle streamlines indicating vector field direction, radial curl and attenuation; player can predict deflection. Low-opacity line work plus short turbulence reaction.  
**Earth:** levitating rock cluster built with sculpted fractured meshes, debris dust and crack emissive seam proportional to impact. Actual body poses synchronized from snapshot. Collision shard count capped.  
**Ice:** wet patch crystallizes from edges across surface with faceted translucent thin shell and spectral rim, then leaves tangible smooth collider; crack streaks form at impact points, fracture splinters emit and melt leaves puddle.  
**Electric:** physically plausible stylized stochastic branching arc (deterministic seed for event) follows server conductive graph nodes; timed radial pulses and short small sparks; do not strobe entire screen.  
**Gravity:** bending of local dust trajectory, curving purple/white field line arcs, coherent ring lensing approximation and orbiting shards; massive depth cue near field center, no gameplay camera warping.  
**Steam:** water/fire intersection yields rolling volumetric-look plumes with soft fade and upward motion, actual short lift effect region; optional local vision veil that respects accessibility.  
**Magnet:** charged metallic segments emit streaks/flux lines along contact/field, metal rigid-body movement does all actual bending.  
**Guard:** crystalline basalt wall materializes upward from legal plane with light ripple and stone shedding; core really bounces off actual barrier collider.

## Shader discipline
- Write GLSL or approved shader node implementations, isolated reusable materials, typed uniforms and lifecycle disposal. Use signed-distance/pseudo-volume math sparingly and document camera/lighting treatment.
- Use baked flow textures / procedural noise with original sources; no proprietary textures from reference game.
- Use quality parameter caps (particles, steps, distortion, overdraw, transparent layers), update only active effects, pool temporary objects.
- Prevent clipping / sorting of overlapping water and ice; fade near depth intersections.
- Apply player hue with limited accents, not colorize every spell entirely amber/cyan. Material identity remains recognizable.

## Artistic choreography / telegraphing
Every power: anticipation 100–300ms (input confirmation), buildup/hold, release (authoritative event), physical impact or field persistence, graceful decay. Opponent sees which ability and approximate aim. Energy meter and spell animation have consistent rhythm.
Do not delay instant server actuation to wait for fancy VFX. Time visuals to accepted game event and interpolate.

## Evidence / failure criteria
Create video or series of screenshots for 10 conditions: fast core spin, stone impact, wet/freeze, steam burst, charge chain, air vortex, gravity curve, fire + wind, shield ricochet, scored goal. Each must include the world geometry and actual effect origin, not effect alone on black background.
Test shader compatibility in Chrome and Safari; no error consoles, NaN uniforms, overbright highlights, particle explosion, WebGL context leak after 10 rematches.
Reject: fake flat colored cones, point-sprite snowstorm that obscures ball, effects that look great but have no server causal mapping.

## Gate
Core is an iconic premium asset and eight systems are identifiable, physically reactive and visually coherent on both desktop and tiered mobile settings.
