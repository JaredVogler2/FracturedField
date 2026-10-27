# DEEP DIVE D13 — PRODUCT-LEVEL UX, AUDIO DESIGN, AND RESPONSIVE GAME JUICE

**Execute with Phase 09.** Translate complex gameplay into immediate readable action for first-time players and retain a premium UI language. Beautiful UI is secondary to the game world but should feel like part of it.

## Screen production plan
A. Title / hero: subtle live arena preview or static fallback, memorable FRACTURE FIELD title treatment, "CREATE DUEL", "JOIN WITH CODE", "PRACTICE", "HOW TO PLAY" and Settings. No permissions before user opts in.
B. Create: room code and share invite QR/link, opponent presence, selected mode and core visual motif; permission to camera/motion chosen now or before READY.
C. Join: room code input, connection status with actionable error, waiting counterpart, lobby seat/energy hue, mutual ready controls.
D. Calibration: user chooses CAMERA STAND, HANDHELD MOTION, TOUCH or DESKTOP. Permission denial immediately offers fallback; preview remains local to device.
E. Interactive tutorial: apply first force, redirect core, guard incoming, score. Context instructions projected in arena, with large controls; never paragraphs covering core.
F. In-game HUD: score/timer top center, team goal identity left/right, energy near thumb area, cooldown symbols, network/tracking and mute minimal corners; leave central arena readable.
G. End-of-round: brief goal camera, scorer credit, replay or skip, rematch; no full-screen celebration obstructing next kickoff.
H. Match end: winner, highlights (auth events), saves/combos, rematch / swap input / home. Room rejoin status gracefully shows exact situation.

## UI style system
Create design tokens in packages/ui: typography scale, 4/8px rhythm, safe areas, shadow/blur, neutral obsidian panels with brass/cyan edges, tasteful material grain, animated rift glass borders, single accent per seat. Flat huge rounded cards and sterile admin dashboards are excluded.
Mobile accessible targets >=44px; focus indicators and label semantics; reduced-motion config, captions, alternate contrast; large legible numbers. Landscape compact HUD and portrait adaptive model.

## Game-feel exact event chain
- Local intent: palm/pointer glows & small charge immediately (cosmetic).
- Server ACTION_ACK: short cast acceleration, wrist/gauntlet energy blast begins; if rejected, subtle dissipate/refund animation.
- Server FIELD_CREATED: environment bends and visible field vector aligns with real force region.
- Server COLLISION: audio impact pitch scales with physical impulse and object material, minor ring shock and core deformation. No big blast for tiny bump.
- Server REACTION: distinct material transition sound and animation; no duplicate if snapshot arrives after EVENT.
- Server GOAL: slow cinematic pulse, portal consumes core, scoreboard changes and one-time spatial low boom; camera reset seamless.
Implement event dedupe keyed authoritative event ID. Pool particle/audio sources.

## Sound architecture
AudioContext user-gesture resumed; WebAudio spatial panner for events + limiter and master, music and SFX buses. Author original sounds or licensed assets; maintain credits. Core ambient hum pitches subtly with speed/charge; water muffled rush, ice crack, metal/earth heavy resonance, wind hiss, electricity segmented snaps, gravity subharmonic warp, steam whoosh; short layered transient/decay so sonic identity matches mass/energy.
Support stereo fallback, mute, captions for sound-critical events, no autoplay error. Haptics optional supported APIs only.

## Usability tests
2 devices remote with independent input modes, complete room creation -> invite -> ready -> play -> score -> rematch. Record clicks/taps to first playable moment. Test invalid link, full room, expired token, WebSocket retry, camera permission deny, motion unsupported, no audio, WebGL fallback, phone refresh during game, timer crossing round state.
Screen capture full flow both desktop and 844x390; check text overflow, overlap, unreadable HUD at high zoom and reduced motion.

## Gate
A new user should understand the game without technical docs, create/join a room, execute 3 abilities, score, finish and rematch. Match-critical sounds always have visual equivalents.
