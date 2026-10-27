# PROMPT 04 — ORIGINAL, REAL-TIME MATTER / ENERGY INTERACTION ENGINE

## Mission
Deliver the defining magic: an extensible, **physically informed** engine where both players can change matter/energy and those changes meaningfully affect motion, collisions, access, and goals. A painted fireball + shader-only water is insufficient. Keep performance playable at the actual server simulation rate.

## Separation
- PhysicsAuthority: owns body transforms, colliders, fixed time, velocity/force, collision/goal events.
- ElementRegionSystem: manages bounded discrete regions: moisture, heat, charge, airflow, ice, fog, friction, conductivity, density proxy, timers. A world-aligned coarse grid or sparse keyed regions; no 1M-particle authoritative water.
- MaterialTable: basalt, steel, ice, water region, vapor, charged metal and Rift Core defined data-driven coefficients (restitution, friction, density, conductivity, brittle threshold, heat capacity proxy, cost).
- EffectSystem: accepts server-validated abilities, generates force/element deltas for simulation with versioned IDs; visual shaders sample authoritative resulting events.
- ReactionResolver: deterministic priority, reaction combinations, conversion thresholds, clamps, budgets, event IDs and anti-recursion; each interaction documented with a state transition diagram.
- Renderer: particles, splashes, vortex meshes, steam, sparks, crack decals, trails are non-authoritative and quality-scalable.

## Required physical phenomena and implementation detail
1. **Ballistics**: Pulse applies vector impulse, obeys mass and distance falloff; equal/opposed commands combine within capped acceleration rather than arbitrary winner selection.
2. **Airflows**: Vortices apply per-object tangential/curl field plus radial lift or drag. Repeated effect overlapping superposition capped. Obstacles attenuate if cheap ray tests can do so.
3. **Earth/stone**: cover produced from limited pre-generated segments; moved blocks collide and provide momentum transfer. Break when collision impulse exceeds material strength. Spawn 2–5 collision shards only if body budget permits; all other shards cosmetic.
4. **Water**: regions represent shallow pools, jets/patches with liquid mass proxy, apply wetness, drag and buoyancy; visually fluid shader sheet/ribbons and GPU splash particles. No fake 'SPH authoritative water' unless benchmarked.
5. **Temperature**: abilities raise/lower local scalar, update through bounded conduction steps. Define melt/freeze thresholds with hysteresis; ice creates static/kinematic collision shape; steam removes local water and creates lift/fog. Prevent oscillating freeze/melt every frame.
6. **Electrical**: dynamic graph connects wet regions and conductive metal; distance/contact thresholds, attenuation, per-effect energy budget. Charge pulse over connected nodes with deterministic traversal order, cooldown; can overload exposed barrier and affect charged metallic obstacles.
7. **Metal/magnetism**: only a small set of metallic bodies respond to temporary field, with inverse-distance softened bounded force. Counter through shield or interruption.
8. **Gravity well**: apply mass-dependent force to qualifying objects with softened falloff and small radius; well placement in legal ranges only; explicit energy/duration/counter. Avoid singularities and escaping core.
9. **Reactions**: wet+electric conducts, water+cold freezes, water+heat steams, vortex+fire burns, stone+wind creates cover-mediated change, metal+charge deflects or attracts, gravity+rock curves ballistic path, ice+impact fractures.
10. **Persistence**: effects evolve over real simulated time, expire cleanly and restore from snapshot/resync; visual time must not control server expiration.

## Engineering invariants
- Document how every elemental effect injects external energy via player ability; do not assert energy is 'conserved' when supernatural manipulation creates impulse/heat.
- Preserve plausible causality, predictable telegraphing and strategy; gameplay readability beats expensive theoretical fidelity.
- No NaN, division-by-zero, zero-distance singularity, unbounded feedback, object tunneling at allowed velocity; consider CCD for fast core.
- Dynamic budgets by arena, for example ≤20 rigid bodies, ≤30 concurrent effects, ≤64 live regions, capped fractured colliders; expose counters on HUD.
- No full world serialization for every decorative particle. Only physics-relevant state is replicated.
- Cross-field operation order fixed: validate -> apply incoming abilities -> resolve fields -> physics step -> collisions -> material conversions -> score -> snapshot/events; document the chosen exact order.
- When clients disagree on effect visuals, authoritative state corrects them without jumping collision bodies.

## Move design for 2 players
Base set: PULSE, LIFT, SWEEP, GUARD, INFUSE. Add advanced hot-swappable move slots: FREEZE, CHARGE, MAGNETIZE, GRAVITY and FOCUS. Make interface choice comprehensible and controller-mappable. Loadouts symmetrical and energy-balanced; do not require each player to master 10 gestures simultaneously.
Per ability define: 3D targeting geometry, input gesture(s), target restrictions, server action schema, cooldown, energy, hold cost, force envelope, audio cue, visual telegraph, opponent counter, one interesting combo.

## Mandatory automated tests
- Numerical outcome: known impulse + known mass affects core Δv within tolerance.
- Wet stone conductive while dry stone is not.
- Liquid freeze spawns collider; thermal reversal removes collider; transforms validated.
- Rock at threshold X does not fracture, above threshold Y fractures once; fragment budget maintained.
- Air vortices of opposite sign mostly cancel (subject to cap).
- Gravity at r≈0 is finite, objects never exceed legal velocity.
- Material interactions produce canonical GameEvent IDs exactly once, even under one-tick repeats.
- Sim same seed+action log yields identical result/hash twice at same runtime/version.
- Sample 1,000 seeded action sequences and assert finite transforms, bounded count, no fixed-step crash.
- Check that all reactions can alter a scoring trajectory in an integration scenario; mere VFX is fail.

## Quality
Create a live development Physics Laboratory route with step / pause / rewind trace, friction/impulse vectors, active field overlays and material state toggles. This is a development tool, not a substitute for game. Benchmark worst-case 2-player overlapping effects server-side and both low/high client visual tiers.

## Acceptance
G08 and G10 for physical system, no gameplay regression. Document which approximations are used; no false claims of scientific simulation fidelity.
