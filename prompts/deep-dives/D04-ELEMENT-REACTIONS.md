# DEEP DIVE D04 — REACTION GRAPH, MATERIAL MODELS AND PHYSICS FIXTURES

**Execute during Phase 04.** This is the signature gameplay system. Do not simulate all reality: simulate a small, coherent rule set whose outcomes are physically legible and delightfully surprising.

## Explicit physics rules to code
Use shared GameRules for material IDs, mass density proxy, restitution, static/dynamic friction, conductivity, energy, heat capacity proxy, fracture threshold, water saturation, freezing/melting hysteresis, field force caps, max concurrent effects.

### Force stage
At tick dt=1/30, collect resolved fields (air, gravity, magnet), compute net force/torque on qualifying rigid bodies by position/radius/material, softening distances and global clamp. Apply impulses only for finite casts; sustained fields apply force each step and consume energy. Core speed cap + CCD. Provide scientific-inspiration comments but avoid misleading full Navier–Stokes claims.

### Material stage
- Water: patches with local wetness, shallow thickness, drag/buoyancy and potential path conductivity.
- Ice: wet+cool temperature threshold creates a brittle collision surface; from heat or time melt -> no solid collider; stress fracture can remove it.
- Thermal: heat input / cooling, capped neighbor conduction and hysteretic phase changes; heat weakening stone/ice, evaporation to steam region.
- Electric: wet/metal/contact graph of nodes, edge threshold, attenuation and finite active propagation; ability costs energy; dry/basalt blocked.
- Earth: rigid boulders and barrier colliders with physical restitution and cracking from impulses.
- Fire+wind: air advects heat and flame region in a bounded direction; limited duration, readable and counterable.
- Magnet and gravity: soft falloff fields with capped potential force; magnets affect marked conductors, gravity affects all non-fixed bodies; both have cost.

## Reaction event matrix (must test causal outcome)
R1 water+cold -> ice collider causes distinct core bounce.  
R2 ice+heat -> melted region now slows core instead of bouncing.  
R3 water+heat -> steam push/lift plus controlled vision veil.  
R4 metal+charge -> target body force changes.  
R5 wet conductive chain+charge -> overcharged shield or temporary danger zone.  
R6 vortex+flame -> heat region carried along flow to another material.  
R7 gravity+rock -> curved shot changes collision impulse and rebound trajectory.  
R8 earth impact -> physical fracture changes path/cover.  
R9 opposing winds -> partial field cancellation; no numeric runaway.  
R10 thermal-shocked wet rock -> reduced threshold + fracture on later impact (if balance permits).

## Regression fixture format
JSON file contains seed, starting body transforms, initial material patches, per-tick ActionIntent[] and assertions e.g. expected core position epsilon, material state transition, score delta, max speed, active body counts, energy. Generate golden traces with deterministic same runtime/version. A visual Lab UI overlays force vectors, wetness/heat/charge grids, collision impulse, event sequence; make it easy to freeze/step.

## Gameplay checks
- Set up a goal reachable by bank off ice ramp but not wet floor; prove physically in test.
- Opponent counters heat-created steam by moving or using alternative arc; reaction never becomes uncounterable obscuration.
- Reactions preserve legal goals/collision not trigger points while core outside.
- When game action changes temperature, record energy injected as supernatural ability; energy isn't falsely "conserved" under external spell forces.
- Worst-case fields stay within Worker CPU budget. Cap zone count and use pooled vectors.

## Gate
Each reaction must change server-owned collider, velocity, event, resource cost or visibility gameplay rule. An effect represented only by shader color change FAILS.
