# PHASE 06 — Phone input: touch, handheld motion, controllers, accessibility (with D06)

**Status: IN PROGRESS — implemented and tested in browser emulation; physical iOS / Android phones
and real controllers NOT TESTED.**
Every player chooses how to control their seat — keyboard & mouse (or a game controller), touch,
handheld motion, camera (Phase 05) or a simplified one-hand mode — from a capability matrix that
never offers a dead end; all of them produce the same `ActionIntent`s and can be switched mid-match
without losing a held ability or the intent stream. Verified here in a real browser: the D06 gate
(a phone with no camera and no motion sensor joins a remote room and completes three rounds with
touch alone), motion aiming from synthetic orientation readings through the authority, the iOS
permission flow, rotation and background handling, a stubbed game controller, multi-touch, key
rebinding and six screen sizes. Not verified: physical phones, real sensors and permission prompts,
real controllers (see "Honest limits" and the manual device checklist).

## What was built

| Area | Implementation |
|---|---|
| Capability matrix | `apps/web/src/input/capabilities.ts` — `detectCapabilities(env)` (secure context, coarse/fine pointer, touch points, orientation API `available / prompt / insecure / none`, camera, Gamepad, vibration; injectable for tests), `controlModes(caps)` (every mode with availability and the reason when unavailable), `defaultMode`, `MODE_SOURCE`. |
| Mode switching | `InputManager.setMode(slot, mode)` (`manager.ts`) hot-swaps a seat's adapters: holds released first, old listeners removed, the sequence space kept, the new source adopted at once; a manager is created already in the current mode. `InputAdapter` interface (D06's InputController: pause / resume / dispose / calibrate / tick). |
| Handheld motion | `motion.ts` (`MotionAim`, pure): W3C angles → quaternion, screen-rotation correction, relative to a recentred neutral pose; pointer and tilt styles; dead zone + One Euro; glitch guard; null/NaN tolerance; stall and needs-recenter states; automatic re-zero on rotation. `motion-controller.ts`: permission inside the tap (`requestMotionPermission`), live-reading probe (`probeOrientation`), `MotionController` adapter (aims only; abilities stay on the thumbs), UI store. |
| Touch | `ui/TouchControls.tsx` — thumb cluster (PULSE, LIFT, GUARD, SWEEP pad, WET, HEAT, two picks) with ≥ 44 px targets, left/right hand, press-and-hold with pointer capture or tap-to-toggle synced to the server hold, swipe-direction SWEEP, 8 ms haptic tick where supported, keyboard/assistive activation. Arena drag/tap aim (`TouchAimController`, one touch id). The arena is framed clear of the controls (`render/camera.ts`, `Scene.tsx`: landscape side strip via `setViewOffset`, portrait bottom band). |
| Simplified mode | Large buttons (× 1.18), holds always toggle, tap-to-aim, no timing-critical input. |
| Game controller | `gamepad.ts` — standard mapping (`GamepadMapper`, pure) and `GamepadController` (polling, connect/disconnect at any time, release on disconnect/pause, Start pauses), connect/disconnect notice. |
| Rebinding | `bindings.ts` (`rebind` with swap semantics, reserved keys, validated persisted override, `applyOverride`) and `ui/controls/Rebind.tsx` (Controls panel, also from the pause menu; applies live). |
| UI | `ui/controls/ControlPicker.tsx` (ready gate, online lobby, in-match), `ModeChip.tsx` (always-visible mode chip + "Controls: …" handover notice), `MotionPanel.tsx` (tilt gauge with a recenter animation, RECENTER, background / stalled prompts with "Use touch"), `GamepadNotice.tsx`, Settings → Touch & motion (thumb side, hold style, motion style, sensitivity). Rotate hint in portrait. |
| Fixes found on the way | the seat reported `keyboard` as its source until the first touch (the D06 gate caught it) — intents are now attributed per intent: aim names the aim owner (the mode's source from the moment of a switch), each ability names the device that pressed it; Tab was swallowed by the game (keyboard focus could not move during a match); Enter on a focused button fired both the button and PULSE; the thumb buttons ignored keyboard / screen-reader activation (they listened to pointer presses only); the Controls panel's rebind rows overflowed under the duel tables at ≤ 1280 px and both Controls and Settings opened scrolled to the bottom (autofocus on the last button). |

## Unit tests (`pnpm test`)

215 unit tests in 20 files pass (Phase 05 ended at 180). New for Phase 06 (43 in `apps/web`):

- `capabilities.test.ts` (6): iPhone Safari (touch first, motion behind a prompt), Android Chrome
  (motion without a prompt), desktop (no motion although the API exists), insecure origin (reasons
  shown), a touch laptop (keyboard & mouse by default), nothing detectable (simplified remains).
- `motion.test.ts` (14): the W3C angle formula round-trips; turning right aims right and tipping
  away aims down; the singular upright hold; landscape screen correction; rotation re-zero; still
  hand with noise does not move the aim; a deliberate turn reaches 90 % within 150 ms; one-reading
  glitch ignored vs a persistent flick; null/NaN ignored, gap → stalled → resumes; nothing aims
  after the background until recenter; sensitivity and clamping; tilt style; and two measurements:
  **2° correction → 63 % in 100 ms; 15° turn → 63 % in 33 ms, 90 % in 67 ms** (synthetic 60 Hz
  readings — the filter's behaviour, not device latency) and **1 % null/NaN readings during a turn
  change the aim by < 0.05**.
- `gamepad.test.ts` (6): one fire per press, LIFT trigger hysteresis, picks by loadout, D-pad
  sweeps and Start, stick dead zone / quadratic response / NaN safety, release ends every hold once.
- `bindings.test.ts` (4): free key replaces, a taken key swaps, every action keeps a key after any
  sequence of rebinds (property test), reserved/malformed keys refused and stored data sanitised.
- `manager.test.ts` (5): a manager created in a mode aims under that mode's source from its first
  intent; an ability intent names the pressing device while aim keeps naming the aim owner;
  swapping mid-hold releases the hold and continues the same sequence; only motion mode has a
  motion adapter (re-setting a mode is a no-op); hiding the tab releases holds.
- `camera-controller.test.ts` (8, Phase 05) still pass with camera edges tagged explicitly.

## Browser evidence (Playwright, production build, headless Chromium + SwiftShader)

In progress — results so far on the production build (`vite preview`) and local workerd:

- `e2e/phase06.spec.ts`: **D06 gate passed** (2.3 min: a touch-only phone — iPhone 13 profile,
  no camera permission, no sensors — joins a room by invite link, readies with a tap and completes
  three rounds online with taps alone; every intent it sent was `source: touch`); hot-swap during a
  LIFT releases the server hold and shows the handover; two thumbs at once (CDP multi-touch: one
  finger keeps aiming while another taps PULSE, exactly one PULSE, all touch) plus keyboard /
  assistive activation of a thumb button; six layouts (320×568, 375×667, 430×932, 568×320,
  844×390, 1024×768: targets ≥ 44 px, on screen, clear of the scoreboard / pause / mode chip, and
  neither a control nor a HUD panel covers the core or a goal mouth); safe-area insets in landscape
  (47 px notches, 21 px home indicator) and portrait (47 px island, 34 px indicator) — nothing sits
  under an inset.
- `e2e/phase06-devices.spec.ts`: motion end to end (turn right / left moves the authoritative force
  point; gyro aim intents; background → "tap Recenter", nothing aims until recentred; sensor
  silence → "stopped sending" → Use touch); rotation landscape → portrait re-zeroes for the new
  orientation (and turning right then moves the force point right on the portrait screen); iOS
  permission requested inside the tap (user activation and the click event recorded), granted →
  motion, denied → touch stays playable; no readings / browser refusal → touch stays; controller
  connect / steer / A pulses / LT lifts / unplug mid-LIFT releases on the server / Start pauses;
  PULSE rebound to Z in Controls is used in the match (HUD shows Z, Space no longer pulses).
- Remaining: the simplified-mode test (one tap holds LIFT, another lets go; then taps alone score
  against the bot) after the toggle fix, the full regression suite, and the visual evidence.

## Honest limits

- **Browser emulation only.** Phones are Playwright device profiles (iPhone 13 viewport, touch,
  coarse pointer) in desktop Chromium; motion readings are synthetic `DeviceOrientationEvent`s; the
  iOS permission prompt is a stub of `DeviceOrientationEvent.requestPermission` (the denial path is
  also run through Chromium's real permission API); screen rotation and multi-touch go through the
  DevTools protocol; the controller is a stubbed `navigator.getGamepads()`. None of it proves how
  iOS Safari or Android Chrome behave on hardware (D06: "automated emulation is not proof of
  sensor permission APIs").
- Not measured on devices: sensor rates and noise, the smoothing trade-off as felt in the hand,
  sign conventions on specific phones, real notches / dynamic island / home indicator against the
  safe-area insets, thermal throttling, haptics. The motion timing numbers are filter behaviour on
  synthetic 60 Hz readings.
- No accelerometer "flick" modifier (D06 optional; not reliable without device testing). No
  camera + motion hybrid (D06 optional; ADR-0008 §7).
- Remote play between two physical phones on different networks still needs the deployed room
  service (Phase 12); the D06 gate ran two browser contexts against local workerd.

### Manual device checklist (owed — Phase 11 / D15 device lab)

Record device model, OS and browser version, result and notes for each line.

1. **iPhone, Safari (HTTPS):** no permission prompt on load; Motion → the iOS prompt appears from
   the tap; Allow → Motion selected within ~1.5 s; Don't Allow → the note, Touch stays, the match is
   playable; reload → Motion still offered (iOS will not prompt again until site data is cleared).
2. Motion in a match, landscape: RECENTER, then turn right / left / up / down — the force point
   moves the same way on screen; rotate to the other landscape side and to portrait — the
   "Recentered for the new screen orientation" notice, directions still correct.
3. App switch / lock screen mid-match → back: "tap Recenter" prompt, nothing aims until tapped, a
   held LIFT has ended. Settings → Safari → Motion & Orientation Access off → back: "stopped
   sending" prompt → Use touch works.
4. Touch: left thumb drags the aim while the right taps PULSE / holds LIFT / swipes SWEEP; no page
   scroll, zoom, text selection or back-swipe; nothing under the notch or home indicator in either
   landscape side or portrait; Simplified mode plays a full round one-handed.
5. **Android, Chrome:** the same, plus: Motion with no prompt (Chrome grants it), a phone without
   a gyroscope shows "No motion readings" and stays on Touch; vibration tick on button presses.
6. Camera denied + motion denied on both phones → a full online match on two networks (G04/G07).
7. Bluetooth controller on a laptop and on Android: connect mid-match (notice), steer, A pulses,
   LT lifts, unplug mid-LIFT → released, Start pauses.

## Commits

- Phase 06 (1/3): control modes, motion, touch, controller, rebinding (code + unit tests)
- Phase 06 (2/3): browser E2E for phones, sensors, controllers and layouts
- Phase 06 (3/3): ADR-0008, this report (in progress), build status
