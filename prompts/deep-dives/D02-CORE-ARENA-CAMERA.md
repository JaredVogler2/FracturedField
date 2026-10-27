# DEEP DIVE D02 — FIRST PLAYABLE 3D MATCH WITH CINEMATIC COMPOSITION

**Execute during Phase 02.** The game must look intentionally designed from first vertical slice, while remaining a real physics-driven match.

## Arena geometry
World coordinate contract: Y up, scoring direction along X, symmetric arena around (0,0,0); define dimensions in shared level data. Use 42m x 25m initial footprint (adjust if playtest). Rift goals at ±X. Create a single stable physics core (radius ~0.85m) with CCD and fixed mass, static boundary colliders, 4–8 moving or collidable sculptural obstacles, and goal trigger volumes. Render geometry may be elaborate but authoritative colliders should be simple stable proxies.

## Camera composition
- Orthographic perspective can make visuals flat; begin PerspectiveCamera with carefully chosen elevated 3/4 framing and FOV, stable horizon, 45° down angle approximate. Prototype both goals visible; verify exact goal hit regions no UI occlusion.
- Responsive framing with world bounds fit to 16:9 and phone 844x390; scale interface independently from world camera. Smaller screens should not crop the core at edges.
- Make physical objects readable via contact shadows, rim lighting and motion trails; avoid hiding scoring path behind tall foreground props.
- Create targeted optional replay camera modes only after stable base camera.

## Four core abilities and actual physics
- PULSE: validated instantaneous impulse along world-space direction; force decreases with range.
- DRAW/LIFT: spring/damped force applied over a held duration to move core/rock up or toward anchor, consumes energy over time.
- SWEEP: local time-limited vortex acceleration applied to dynamic bodies in radius; vector visible via subtle ribbons.
- GUARD: short-lived physical barrier collider in allowed player half; real bounce, mass/collider rules, expiry.
Each ability has charge indication, acknowledgement feedback, energy cost, cooldown, no overlap exploits. Physics never set-transform teleports objects on activation.

## Complete match state
Create -> Ready -> Countdown -> RoundStart -> Playing -> GoalAward -> RoundReset -> RoundEnd -> MatchEnd -> Rematch. Server-style owner even in local mode. Opposing keyboard bindings and touch adapters. 90s rounds best-of-three; deterministic tie behavior. Authoritative score events.

## Visual minimum bar
No colored primitives sold as final assets: even temporary world includes dimensional ring floor with tile/joints/trim, two ornate arches with luminous portal rims, dark stone plinths, suspended mechanical ribs, animated swirling Rift Core, sky gradient/cloud fog, bloom used sparingly and shadows.

## Required acceptance exercises
- Execute 6 representative physics shots from fixed seeds: direct, bank, sweep curve, guard ricochet, high shot via lift, endgame save. Record resulting velocity and score.
- Two simultaneously controllable independent input adapters; finish a match and rematch with no app reset.
- Full gameplay screenshot at 1920x1080 and landscape phone. Verify text legibility, core visibility, goals and input affordances.
- Run tests; capture screen if possible. Compare screenshot to docs/CREATIVE_TARGET.md; note weaknesses that later art stages must fix.

## Gate
If a shot does not move a rigid body, or scored goal is faked by animation, reject implementation. If there is no complete match loop, don't advance.
