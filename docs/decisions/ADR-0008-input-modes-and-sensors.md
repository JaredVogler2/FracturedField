# ADR-0008 — Control modes, capability matrix, handheld motion and the fusion policy

- **Status:** Accepted (Phase 06)
- **Context:** prompts/06-MOBILE-CONTROLS.md, prompts/deep-dives/D06-SENSOR-FUSION.md

## Decision

### 1. Five control modes, one intent stream

`ControlMode = desktop | touch | motion | camera | accessible` (`apps/web/src/input/capabilities.ts`).
A mode is only a choice of **input adapters** feeding the seat's `SeatInput`; every adapter produces
the same `ActionIntent`s (same normalised aim plane, same edges), and the authority validates cost,
cooldown, range and caps identically for all of them. The intent's `source` field is diagnostic
only — the authority never grants anything per source, so no device has a power advantage. It is
attributed per intent: an **aim** intent names the device that owns the aim (the mode's source
from the moment of a switch — `MODE_SOURCE`: keyboard / touch / gyro / camera / touch — then
whichever aiming device moved last), an **ability** intent names the device that pressed it (a
thumb button is `touch` even while the phone aims by `gyro`; a key is `keyboard`; a pad button is
`gamepad`).

| Mode | Aim | Abilities | Needs a permission |
|---|---|---|---|
| Keyboard & mouse (desktop) | mouse point, WASD/arrows at the capped speed; a game controller's stick | keys (rebindable), mouse buttons/wheel, controller buttons | no |
| Touch | one finger drags or taps on the arena | thumb cluster (PULSE, LIFT hold, GUARD, SWEEP pad, WET, HEAT, two picks) | no |
| Motion (handheld) | relative device orientation (§4) | the same thumb cluster | motion sensor (asked inside a tap) |
| Camera | hand position (ADR-0007) | hand signs and motions | camera |
| Simplified | tap where to aim | the thumb cluster, larger, holds toggle on tap | no |

`InputAdapter` (`manager.ts`) is D06's "InputController": enabled by construction, writes aim
(`getAim` = `SeatInput.aim()`) and ability edges (`actionStart / actionHold / actionEnd` = the
`SeatInput.edge` phases), and has `pause`, `resume`, `dispose`, an optional `calibrate` (motion
recenter) and an optional per-frame `tick` (stall detection, controller polling).

### 2. A capability matrix, not bare feature detection

`detectCapabilities(env)` reads an injectable `window` subset: secure context, coarse vs fine
pointer, touch points, the orientation API (`available`, `prompt` when a `requestPermission`
exists, `insecure`, `none`), camera API, Gamepad API, vibration. `controlModes(caps)` lists **every**
mode with `available` and, when not, the reason shown in the picker (e.g. "Needs a secure (HTTPS)
page"); `defaultMode` picks touch on touch-first devices and keyboard & mouse otherwise.

- Touch, keyboard and simplified play never depend on a permission, so a player who denies both
  camera and motion can always play (the D06 gate is tested with exactly that phone).
- A sensor counts only once it has **delivered readings**: after permission the picker probes for
  1.5 s for an event with real angles (desktop browsers expose the API and send one all-null event).
- Motion is never offered at start-up and never chosen automatically; a reload reopens a motion
  player in touch (the permission needs a fresh tap on iOS).

### 3. Hot-swap without losing the stream

`InputManager.setMode(slot, mode)`: (1) release every held ability (END intents, so no LIFT
survives the handover), (2) dispose the old mode's listeners, (3) create the new adapters, (4) the
seat's aim adopts the new mode's source at once (also for the idle aim keep-alive). The
seat keeps its **sequence space** — recreating it would restart sequence numbers and the authority
would drop the new intents as stale. The manager is created already in the current mode, so the
very first intent carries the right source. An in-match chip always shows the mode and switches it
in one tap; a short "Controls: …" notice confirms every change.

### 4. Handheld motion: relative orientation only

`MotionAim` (`motion.ts`, pure and unit-tested) + `MotionController` (`motion-controller.ts`, DOM).

- W3C angles → quaternion `Rz(α)·Rx(β)·Ry(γ)` (no Euler gimbal lock when the phone is held
  upright), corrected for the screen rotation (`⊗ Rz(−screen angle)`), then taken **relative to a
  neutral pose** that the player sets with RECENTER (the first reading is neutral). The compass
  heading is never trusted as absolute and no translation is inferred — which also makes it
  indifferent to whether a browser reports α as absolute or relative (iOS vs Android differ).
- Two styles: *pointer* (turn the phone like a window: yaw → horizontal, pitch → vertical) and
  *tilt* (tip it like a tray: roll → horizontal, tipping away → up). Full aim at 20°/14° (pointer)
  or 24°/18° (tilt), scaled by sensitivity 0.5–2; output clamped to [−1, 1]².
- Noise and gestures: 0.8° dead zone, then a One Euro filter (min cut-off 1 Hz, β 0.04, derivative
  cut-off 1 Hz): still hands are smoothed hard, deliberate turns pass quickly. Measured on synthetic
  60 Hz readings (`motion.test.ts`): a 2° correction reaches 63 % in **100 ms**; a 15° turn reaches
  63 % in **33 ms** and 90 % in **67 ms** — inside D06's 80–150 ms / 30–60 ms bands (filter
  behaviour, not device latency).
- Faults: a reading implying > 1,500°/s is held back until a second reading agrees (sensor
  glitch vs real flick); null/NaN readings are ignored; no reading for 800 ms while aiming →
  *stalled* (prompt: Recenter or Use touch); the tab hidden or the OS pausing sensors → *needs
  recenter* (nothing aims until the player confirms); no usable reading at all for 2 s while
  waiting for the first one or for that recenter → *stalled* too, so a sensor that never comes
  back always ends in the "Use touch" offer, never in a prompt that cannot be satisfied; a screen
  rotation re-zeroes on the new orientation automatically. The availability probe requires all
  three angles (a phone without a gyroscope can report no α), and stall detection is frozen while
  the game is paused.
- Motion only aims. Abilities stay on the thumb buttons, so a shake, a bump or a sensor spike can
  never cast; the authority caps everything anyway. **No accelerometer flick modifier**: D06 makes
  it optional "when safe and reliable" — that cannot be shown without real devices, so it is not
  built.
- Permission: `requestMotionPermission()` is called synchronously inside the tap (iOS shows its
  prompt only from a user gesture; Chromium now exposes the same API). Denied → a note on how to
  allow it later, touch stays selected; insecure origin → "needs HTTPS"; never requested at start.

### 5. Touch and simplified

- One thumb cluster (targets ≥ 44 CSS px, 56 px nominal), mirrored for left-handed players; the
  other thumb aims on the arena (pointer capture on one touch id, so a second finger on the buttons
  never disturbs the aim). SWEEP is a pad: swipe in the wind's direction (≥ 22 px) or tap to blow
  forward. Holds use pointer capture (a sliding thumb keeps LIFT) or, optionally and always in
  Simplified, tap-to-toggle synced to the authoritative hold.
- Prompt 06's "radial ability selection + primary action" is built as a corner cluster around
  PULSE: the four core moves sit within ~150 px of the thumb's corner, the element and pick
  buttons one row further out. A true quarter-circle arc keeps every button within reach but is
  ~270 px wide, which on a 390 px-tall landscape phone costs a third more arena width than the
  current 196 px strip; that trade-off needs real hands on real phones (Phase 09 / D15).
- **No two-finger or long-press gestures.** Prompt 06 lists "two-finger guard, long press lift";
  D06 (more specific, later) says to avoid two-finger gestures that conflict with iOS Safari and to
  give GUARD a dedicated thumb button. Dedicated buttons won.
- `touch-action: none` only on the arena canvas (menus and panels scroll normally); safe-area
  insets on every fixed control; the 3-D camera fits the arena into the free part of the screen
  — beside the controls in landscape, above them in portrait — and `setViewOffset` shifts the
  image there (a virtual image grown by the reserved strip, the vertical field of view widened to
  match in portrait), so the controls never cover the core or a goal mouth and the arena keeps
  its size (tested from 320 px phones to a 4:3 tablet). A first version only raised the bottom
  margin in portrait, which made the camera back away ~4× and shrank the arena to a fraction of
  the screen; the screenshot review and an independent code review both caught it.
- Each thumb button carries its own cooldown (a lit band draining to the bottom edge, label
  dimmed) and dims when the move is unaffordable; a refused move shakes its button. The local
  player panel therefore shows only the energy meter in the touch layouts.
- Landscape is recommended (rotate hint); portrait is fully playable.
- Haptics: an 8 ms vibration where supported; most iOS browsers have none, the sound cue covers it.
- Keyboard / switch / screen-reader activation of a thumb button (a click with no pointer press)
  sends the same action (holds toggle). Enter or Space on a control reached with the keyboard
  (`:focus-visible`) belongs to that control — also on the ready screen, where Enter / Space
  otherwise start the match — while a HUD button a mouse player just clicked keeps Space as
  PULSE. Tab is no longer swallowed by the game, so keyboard focus can move during a match.
- Tap-to-toggle holds show the authoritative hold, except for 0.9 s after a tap; a refusal from
  the authority ends that window at once, so the next tap asks again instead of "releasing" a
  hold that never began.

### 6. Game controller and rebinding

- W3C *standard* mapping (`gamepad.ts`): left stick aims at the capped speed (right stick 40 % for
  fine aim), radial dead zone 0.18 with a quadratic response; A/RT PULSE, B GUARD, X WET, Y HEAT,
  LB/RB the picks (held for hold moves), LT LIFT with 0.5/0.35 hysteresis, D-pad SWEEP in that
  screen direction, Start opens and closes the pause menu (it is still read while paused, so a
  controller-only player can resume). Only devices reporting `mapping: "standard"` are used — a
  pedal or flight stick resting at −1 would otherwise steer by itself; others get a "layout not
  supported" notice. Pads connect and disconnect at any time; a disconnect or a pause releases
  whatever the pad held, and a button still held across a pause does not fire again. The pure
  `GamepadMapper` is unit-tested.
- Solo keyboard layout is rebindable in Controls (also mid-match from the pause menu): pick an
  action, press a key; a key already in use swaps with the action's old key, so nothing is ever
  unbound; menu/browser keys (Esc, P, M, Tab, F-keys, Meta) are reserved. Stored overrides are
  validated on load.

### 7. Fusion policy

No fusion of camera and IMU data: their frames are not comparable and D06 makes hybrids optional.
*Camera* = visual gestures + screen aiming (ADR-0007); *Motion* = relative device orientation +
touch buttons. A keyboard or game controller may be used alongside any mode (the aiming device
that moved last owns the aim; each ability intent names its own device). Hybrid camera + motion
with confidence arbitration is not built.

## Consequences

- Every mode is a few hundred lines of adapter code against one stable seat interface; adding a
  mode cannot change gameplay rules.
- All evidence is browser emulation (synthetic orientation events, a stubbed Gamepad API, CDP
  multi-touch and screen rotation, Chromium's permission API). Real iOS Safari / Android Chrome
  behaviour — permission prompts, sensor rates and noise, sign conventions on specific devices,
  safe areas around real notches, thermal throttling — is **not verified** and is owed to the
  Phase 11 / D15 device lab (manual checklist in docs/progress/PHASE-06.md).
