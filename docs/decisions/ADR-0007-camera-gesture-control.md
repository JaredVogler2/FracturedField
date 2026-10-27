# ADR-0007 — Camera control: on-device landmarks, a pure gesture engine, intents only

- **Status:** Accepted (Phase 05)
- **Context:** prompts/05-CAMERA-GESTURES.md, prompts/deep-dives/D05-GESTURE-STATE-MACHINES.md

## Decision

### 1. Three layers, one way out

```
camera ─► CameraSession (main thread: getUserMedia, hidden <video>, frame pump)
        ─► vision.worker (module worker: MediaPipe Hand/Pose Landmarker) ─► landmarks only
        ─► @ff/gestures GestureEngine (pure TS, frame clock) ─► aim + gesture events
        ─► CameraController ─► SeatInput (same reticle / ActionEdge path as keyboard and touch)
        ─► ActionIntent ─► authority (local worker or room) validates and decides
```

- **Landmarks are not actions.** `@ff/gestures` has no DOM, network or timer dependencies: it
  turns `LandmarksFrame`s into aim and discrete events on the frames' own timestamps, so every
  gesture is unit-tested deterministically on synthetic landmark sequences (positive, negative,
  borderline, dropout, bystander, mirrored, aspect, frame-rate and noise cases).
- **The camera is just another input adapter.** `CameraController` drives a `SeatInput` exactly
  like the keyboard or touch adapters: the same reticle clamp, the same `ActionEdge`s, the same
  `ActionIntent` stream. The authority never knows or trusts what produced an intent; there is
  no camera-specific message, force value or bypass.

### 2. Inference off the render thread

- MediaPipe Tasks Vision **1.0.1** `HandLandmarker` (`VIDEO`, `numHands: 2`) runs in a **module
  worker**; stand mode adds `PoseLandmarker` lite (`numPoses: 1`) for the torso gates. The worker
  uses the ES-module WASM loader (`FilesetResolver.forVisionTasks(base, true)`), because module
  workers have no `importScripts`.
- The main thread grabs a frame per `requestVideoFrameCallback` (one in flight), resizes it with
  `createImageBitmap` (640 → 480 → 320 px wide, adaptive), and **transfers** it; the worker closes
  every bitmap immediately. Rate and resolution step down when inference exceeds its budget and
  back up when it recovers; the session pauses with the tab and fails cleanly when the track ends.
- **Delegate choice:** GPU is preferred, but WebGL in workers is often software-emulated. The
  worker detects software rasterisers (SwiftShader / llvmpipe), benchmarks GPU against CPU at
  start-up, and switches to CPU after five consecutive GPU frames slower than 150 ms.
- Model files and the WASM runtime are **self-hosted** under `/vision/` with SHA-256 pins
  (`scripts/prepare-vision-assets.mjs`); nothing is fetched from a CDN at runtime.
- Rejected: synchronous `detectForVideo` on the main thread (blocks rendering); a cloud vision API
  (privacy, cost, latency — and the prompt forbids it).

### 3. Gesture vocabulary (as built)

| Game action | Gesture | Why this form |
|---|---|---|
| Aim | open palm position inside the calibrated working range → screen [−1, 1]² → arena via the current camera's ground axes (so "right" is right on screen, also in seat 1's mirrored view); One Euro smoothing; frozen while a gesture forms | 2-D image position is reliable; no depth claims |
| PULSE | open palm pushed toward the camera: apparent size +18.5 % within 0.55 s from a still moment, sustained ~100 ms, little lateral drift; a torso growing with it (camera moved) is rejected | the most "physical" motion; robust to aiming because aim position ≠ size |
| SWEEP | one decisive open-hand stroke: ≥ 2.6 palm widths, ≥ 6 palm widths/s, consistent direction; one cast per stroke | a greeting wave (small, alternating) never qualifies |
| GUARD | palm turned up and held, or two open palms brought together | the prompt's one-hand accessible alternative; no crossed-forearm contortion |
| LIFT (hold) | closed fist held; opening the hand, a dropout or a pause ends it | static shapes classify far more reliably than "pinch and raise" across lighting and hand sizes |
| INFUSE wet / heat | V sign / thumbs-up (orientation hysteresis) | one-handed, unambiguous, never produced by aiming motion |
| Pick 1 / Pick 2 | pointing finger / OK sign (tap or hold per ability) | as above |

DRAW and FOCUS are not implemented by the authority (`IMPLEMENTED` in `game.ts`), so they have no
gesture. Every gesture has a keyboard / touch equivalent (fatigue, accessibility).

### 4. State machines and frame-rate independence

Each sign is an `armed → candidate (dwell, default 280 ms, user-adjustable) → active/holding →
release → cooldown → re-armed` machine with a miss debounce of `max(70 ms, 1.5 frames)`. All
time constants are on the frame clock, and window sizes adapt to the median frame interval, so
the same thresholds hold from 30 fps down to 5 fps (tested at 30, 24, 20, 15, 12, 10, 8, 6, 5 and
4 fps). Shape classification uses median-of-3 inputs and enter/exit hysteresis.

**Two palm sizes.** Shape ratios (thumb reach, pinch) use the original palm `scale`; motion
(push depth, stroke length, speed) uses a steadier `size` — the four wrist → knuckle distances
averaged, with the knuckle span taking over only past ~28° of tilt. Using one noisy distance for
motion produced false pushes under doubled landmark noise; the averaged size produces none in
10 minutes at 30, 15 and 8 fps.

### 5. Tracking lock, dropout and re-acquire

The engine locks onto the calibrated playing hand (scale, pose and continuity gates reject a
bystander's hand), coasts 200 ms through brief losses, and **after 500 ms lost ends every hold**
(the controller sends END; the authority releases). Re-acquiring needs three frames inside the
play range. Pausing (menu, lobby, match end, hidden tab) ends holds and sends nothing.

### 6. Calibration never blocks play

Neutral pose (1.2 s) then working range (2.6 s) record palm size, centre, range, hand label and
palm facing. Model hand labels assume a mirrored image, so the session swaps them for a camera
facing the player, and calibration flips them again if the shown palm's normal points away.
Players can skip, reuse a saved calibration, or fall back to touch/keyboard in one tap at any
step; a default range applies without calibration.

### 7. Privacy

No frame, image, landmark or pose leaves the device: the worker returns coordinates only, the
controller turns them into intents, and the room receives the same small intent messages as from
any other input (verified per frame in the online E2E). The self-view preview is optional and
local; nothing is recorded or stored except the calibration numbers in local settings.

## Consequences

- Gesture logic is testable without a camera or browser and identical in every environment.
- Real-camera behaviour still depends on the device, lighting and the model: this container
  verified real model output on real hand photos (V sign, fist, pointing finger, thumbs-up), not
  live people, physical phones, low light or real bystanders. Those remain owed (PHASE-05).
- Performance numbers measured here are software-rendered (SwiftShader, CPU delegate) and are
  not device benchmarks.
