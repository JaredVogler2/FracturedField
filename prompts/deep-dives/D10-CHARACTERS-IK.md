# DEEP DIVE D10 — TWO EXPRESSIVE ORIGINAL ELEMENTAL WIELDERS

**Execute as Art Stage 7D.** Two players should be clearly embodied on screen, not represented by bare colored balls. Character movement must communicate accepted actions; gameplay is still driven by server fields, not animated hand contact.

## Visual identity
Original energy wielders: distinct heroic/athletic silhouettes wearing layered ceremonial engineering coats/sashes/metallic harnesses with no copyrighted franchise costume copying. Stylized semi-realistic proportions, faceless or original masks with controlled eye emissive, hand/forearm conductor gauntlets, boots grounded onto plinths. Player A amber/copper, Player B cyan/silver; stage symmetry for competitive fairness. An outlined semi-transparent spectral arm extension may connect camera gesture input to remote in-world target.

## Model pipeline
- Build or acquire fully licensed original rigged glTF characters with reasonable LODs. If no external art generator, implement actual authored procedural mesh characters with torso, joints, limbs, skin/cloth-like geometry, normal/detail maps and skeleton animation; do not pass off capsules as final.
- Character components: head/face-mask, articulated shoulders/elbows/wrists/hands, torso, coat/sash, boots, ambient particles, energy attachments; make anatomical joint limits plausible.
- Configure skeletal/bone graph and 4–8 animation clip equivalents: idle hovering energy, aim focus, Pulse throw, Sweep arc, Lift sustain, Guard cross stance, Infuse channel, stagger/impact reaction, celebrate score. Blend upper body gestures on top of idle.
- If actual full skeletal animation too expensive, implement carefully tuned procedural IK for two arms and torso; include constraints, elbow pole vector, target smoothing, weight shift, secondary cloth energy strands. No teleport-snapping limbs when aim changes.
- Character idle should breathe, subtly brace against forces, look toward moving core (head direction gentle), reaction to physics hit or win.

## Sync requirements
- Remote player pose is **derived from accepted command + aim + animation state**, not a full camera video feed or streamed skeleton of another person. Event start/hold/release tick sets deterministic animation state; smoothing hides network cadence.
- Player transform never overrides authoritative hitboxes if any; in Riftball characters can be non-colliding atmospheric plinth avatars, avoiding competitive body hitbox complexity.
- Animation key event vs audio cue vs VFX action release aligned. Remote missed frames interpolate upper body gestures, no uncanny twitch.

## Readability / UX
- At full arena broadcast view characters must remain large enough to recognize casts; use color/shape on gauntlets and cast silhouette. The chosen loadout controls small icon motif and emitter particle shape.
- During Camera Stand mode: optional live gesture debug silhouette overlay is LOCAL in HUD, not falsely passed as precise photorealistic player mocap.
- Protect privacy; no facial likeness capture, character facial identity derived from original procedural art.
- On phone, simplify clothing/debris and bone counts but keep expressive motion silhouette. A perfect hero still with rigid combat animation is a FAIL.

## Animation tests
- Evaluate mirrored players from same simulated Pulse/Sweep gesture, both hands correct, no elbows hyperextend.
- Simultaneous actions and interruption blend: casting Lift then Guard, goal celebration interruption, lost hand cancellation, player disconnect.
- Screenshot 4 poses/player in arena. Capture short 15-second animation review if available. Grade original design, silhouette, motion easing, material cohesion, synchronized impact.

## Gate
Two rendered characters clearly read as powerful players capable of acting on same world. Quality exceeds cylinders/capsules; their animations correspond to server ability events and don't disrupt 30+FPS mobile tier.
