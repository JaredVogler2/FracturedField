# PROMPT 09 — PREMIUM GAME UX, JUICE, SOUND AND TUTORIALS

## Mission
Deliver a finished, coherent, learnable browser game. The visual world, controls, UI, feedback and sound must reinforce each other and feel deliberately designed; remove the appearance of a weekend WebGL demo. Don't sacrifice gameplay for a beautiful menu.

## End-to-end user journey
Landing: cinematic live arena backdrop that degrades to a lightweight still on low-end mobile; strong brand lockup FRACTURE FIELD; Create Duel, Join Duel, Practice, How It Works, Settings. Immediate play path with no login. Show that game uses camera optionally; don't request any camera/sensor permission on landing.

Create: choose private room, show invite link + six-character short code, QR if worth the payload, Copy and Share. One-click share through Web Share API if available. Host sees lobby with seat status, selectable mode and input style. Consent/permission step only on explicit choice.

Join: paste code or direct URL; handshake status, clear opponent identification without personal data, ready check. Expired/full/malformed/no-network error states with actionable retry. No permanent spinner.

Calibration: input choice cards (Camera Stand, Handheld Motion, Touch, Desktop), optional camera preview and sensitivity; 30-second tutorial. Text and subtle animation; skip flow available.

Match: legible high-priority score, timer, energy, abilities, cooldown and tracking/network status; server events drive scoreboard. Local input readiness is visible, distant player movements communicated through in-world silhouettes and effects. Dynamic sound and minimal HUD emphasis at critical scoring moments.

End: winner, rounds, skillful moments, replay, rematch, new match, switch input mode; if opponent leaves, offer Practice without trapping the user in dead session.

## UI design language
Original high-contrast "ancient science / kinetic glass" interface: intentional typography, spacious spacing, editorial hierarchy, gunmetal/obsidian surfaces, restrained teal/amber accents, fine diagrams, etched lines, dimensional translucent overlays (fallback for blur), no oversized glassmorphic panels obstructing gameplay. Design tokens for colors, typography, spacing, elevations and motion.
- Use rounded typography only if cohesive; font licensing and performance considered; no tiny text on phone.
- Accessible semantics and focus management for menus; ARIA input descriptions; 44px minimum mobile targets where feasible.
- Layout supports 16:9 desktop, iPhone landscape, iPhone portrait (playable fallback policy), 4:3 tablet.
- Use React state machine or well-modeled routing so menu and match cannot be half-visible simultaneously; isolate DOM HUD from WebGL render.
- Robust WebGL loading/error and device feature detection screens; graceful downgrade to lower effects or textual error with recovery actions.

## Feedback timing
Local effect preview immediately after intention (within same frame where possible), accepted action produces authoritative activation event, rejected action gives low-key visual/audio rejection without firing fake physical objects. Energy/cooldown affordances communicate why not available.
- Hit response: contact sparks, high-frequency but short sound, brief physically motivated core flare.
- Defense: force wave spreads along barrier, satisfying resonant low thud, goal imminent tension chime.
- Combo reactions: unique mix of audio timbre and VFX rather than simply large text "COMBO"; optional small toast.
- Highlight/replay: tasteful camera orbit/zoom, never unfairly interrupt live play for cinematics.
- Device haptics when supported, no promise of universal Safari vibrations.

## Original dynamic audio
- Audio WebAudio engine (Howler optional), event-driven from canonical GameEvent timestamps with dedupe and spatial panning.
- Design palette: stone impacts, airy sweep, electrically crackling arcs, layered water bubbles, ice fracture shimmer, heat roar, gravity low-frequency sub pulse, rift gate bass/metallic harmonic hit.
- Environment: evolving ambient drone/wind and distant storms; music dynamically increases urgency in last 10 seconds and during golden rift.
- Mix bus priorities, compressors/limiters to prevent distortion under multiple reactions, volume sliders by category, mute default policy compliant with autoplay restrictions.
- Only original or appropriately licensed sounds, track attribution. Provide generated/procedural source if no legal sound library; no scraped copyrighted samples.
- Accessibility: subtitles for meaningful cues, flashes low/high toggles, reduce camera shake, reduce effects; all tactical sound has visual analog.

## Tutorial design
- Micro-onboarding: aim -> Pulse Core into goal -> Guard incoming shot -> Sweep around obstacle -> start match; less than ~60s interactive onboarding for standard touch, camera perhaps extra calibration.
- One-line text and highlighted world object per step, replay instructions.
- Self-correct mistakes without scolding. No walls of copy; avoid requiring users to hold phone at unsafe angles.
- Controls screen with real-time live gesture preview; during match small accessible quick reference.

## Error / edge design
- Camera denied => "Continue with touch", not blocking red alert.
- Motion permission denied => "Touch controls selected", recover.
- Network lost => overlay describing paused/attempting rejoin/timeout; no score lies.
- Old client protocol => clear refresh route.
- WebGL context lost => dispose/recreate scene if possible; otherwise fallback explanatory screen.
- Room full, room expired, third-party join misuse => readable states, no stack traces.
- No sound due autoplay => tap to unmute; game otherwise complete.

## End-phase evidence
Screenshot 6 screens and at least 3 in-game ability sequences. Compare to initial mock and critique visual consistency; if possible demonstrate end-to-end UX from open link to rematch with no debugging intervention. Automated navigation tests plus actual accessibility keyboard/focus testing.

## Acceptance
G03 G09 G11 G12. A person who hasn't read the docs should know how to create a match, invite a friend, cast an ability, identify score, and rematch.
