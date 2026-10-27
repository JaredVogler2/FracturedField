# PHASE 05 — Camera-based control: hands and body gestures (with D05)

**Status: COMPLETE (local) — physical devices, live people and real lighting NOT TESTED.** Each
player can control their seat with their own device camera: on-device hand (and, on a stand,
pose) landmarks feed a pure gesture engine whose output enters the game exactly like keyboard or
touch input — the same reticle and the same `ActionIntent`s, validated by the authority. No video,
image or landmark leaves the device. Verified here: real model inference on real hand photos
through Chromium's fake camera, synthetic-landmark gesture suites at camera rates from 30 to
4 fps, a camera-driven player that scores and rematches, dropout release on the server, and the
online no-media-uplink check. Not verified: phones/webcams in hand, live people, low light, real
bystanders, or device performance (see "Honest limits").

## What was built

| Area | Implementation |
|---|---|
| Gesture engine | `packages/gestures` (`@ff/gestures`, DOM-free TS): aspect-corrected hand features (`features.ts`), hysteretic median-smoothed shape classifier (`shapes.ts`: open, fist, point, V, three, thumbs-up, OK), calibration (`calibration.ts`), `GestureEngine` (`engine.ts`: tracking lock, coast/release, aim with One Euro smoothing, per-gesture recognisers), synthetic hands and timelines for tests (`synthetic.ts`, `@ff/gestures/synthetic`), live `SyntheticCamera` for closed-loop browser tests. |
| Vocabulary | Aim = open palm in the calibrated range; PULSE = palm pushed toward the camera; SWEEP = one decisive stroke (direction from the stroke); GUARD = palm up and held, or two palms together; LIFT = held fist; WET = V sign; HEAT = thumbs-up; picks = pointing finger / OK sign (tap or hold per ability). Rationale in ADR-0007 §3. |
| Inference | `apps/web/src/input/camera/vision.worker.ts` — MediaPipe Tasks Vision 1.0.1 `HandLandmarker` (VIDEO, 2 hands) + optional `PoseLandmarker` lite (stand mode) in a **module worker**; GPU/CPU delegate choice with software-GL detection, start-up benchmark and runtime fallback; bitmaps closed immediately. Assets self-hosted under `/vision/` with SHA-256 pins (`scripts/prepare-vision-assets.mjs`, run by the web `dev`/`build` scripts). |
| Camera session | `camera-session.ts` — `getUserMedia` with every failure classified (denied/blocked, not found, in use, insecure context, unsupported, model unavailable, inference failed, revoked) and recoverable; hidden `<video>`; `requestVideoFrameCallback` pump with one frame in flight; adaptive resolution (640/480/320) and rate; pause with the tab; track-ended → revoked; stats (fps, inference ms, capture → landmarks latency, delegate). |
| Input adapter | `camera-controller.ts` — `CameraController` feeds frames to the engine and drives a `SeatInput` (same reticle clamp, `ActionEdge`s and intents as keyboard/touch, source `camera`); screen aim → arena through the current camera's ground axes; calibration adoption (label flip, playing hand); nothing sent in calibration, practice or pause; pause/mode change/dispose end holds. |
| UX | `ui/camera/CameraControl.tsx` — 3-step wizard (choose: Close hands / Camera stand with put-the-device-down warning, playing hand, front/rear camera, privacy line; frame: live self-view + tracking text; calibrate: neutral + range with progress, or use saved calibration; practice: PULSE and GUARD checklist + gesture card), in-match status chip (tracking state, last gesture echo, help card, optional self-view), error panels with retry and one-tap touch/keyboard fallback at every step. Settings → Camera control: playing hand, sensitivity, sign hold (dwell) time, self-view, forget calibration. Online lobby and vs-bot ready gate offer camera as a control choice; READY waits for the camera setup. |
| Test hooks (`?test=1` only) | `__ffCamera` (status, wizard step, synthetic timeline playback, live synthetic hand) and `__ffDebug` verdict/cast logs with arrival times; `__ffVision.classify` for still-image model checks. Grant no authority. |

## D05 gesture suite (synthetic landmarks, `pnpm test`)

`packages/gestures/test/` — 46 tests: every gesture positive / negative /
borderline, exact cast counts, dropout → END (150 ms kept, 800 ms released), bystander lock,
left-handed play, a camera not facing the player, 4:3 and portrait 9:16 frames, slow motions,
greeting waves, a 120 ms fist flicker, a sideways thumb, a hand entering the frame large, two
signs in quick succession, camera pan / dolly (torso) rejection, malformed landmarks (no NaN),
calibration success and soft failure, 20 minutes of idle aiming with no cast, and:

Detection table from `pnpm benchmark:gestures` (synthetic hands, frame clock — deterministic,
not a device measurement). Latency is from the start of the motion to the recognised event; signs
include the default 280 ms hold (dwell). The unit suite asserts the same properties per rate
(40 pushes, every sign, six strokes, latency bounds).

| fps | PULSE detected | PULSE onset → event median / max | signs (onset → event) | strokes detected / max |
|---|---|---|---|---|
| 30 | 80/80 | 267 / 433 ms | lift 333, wet 333, heat 400, pick1 333, pick2 333 ms | 6/6 · 333 ms |
| 24 | 80/80 | 292 / 458 ms | lift 367, wet 367, heat 450, pick1 367, pick2 367 ms | 6/6 · 375 ms |
| 20 | 80/80 | 350 / 500 ms | lift 350, wet 350, heat 400, pick1 350, pick2 350 ms | 6/6 · 350 ms |
| 15 | 80/80 | 333 / 533 ms | lift 400, wet 400, heat 467, pick1 400, pick2 400 ms | 6/6 · 400 ms |
| 12 | 80/80 | 333 / 583 ms | lift 450, wet 450, heat 533, pick1 450, pick2 450 ms | 6/6 · 417 ms |
| 10 | 80/80 | 400 / 600 ms | lift 400, wet 400, heat 500, pick1 400, pick2 400 ms | 6/6 · 400 ms |
| 8 | 80/80 | 375 / 500 ms | lift 575, wet 575, heat 575, pick1 575, pick2 575 ms | 6/6 · 500 ms |
| 6 | 80/80 | 333 / 500 ms | lift 700, wet 533, heat 700, pick1 533, pick2 533 ms | 6/6 · 500 ms |
| 5 | 80/80 | 400 / 600 ms | lift 800, wet 600, heat 600, pick1 600, pick2 600 ms | 6/6 · 600 ms |
| 4 | 80/80 | 500 / 750 ms | lift 1200, wet 950, heat 950, pick1 950, pick2 950 ms | 4/6 · 750 ms |

A still hand with **doubled** landmark noise produced **0 casts in 10 minutes** at each of 30, 15
and 8 fps (budget: < 1 per 5 minutes).

**Bug found and fixed this phase:** the original PULSE recogniser compared against the second-
lowest size in a 300 ms window. At 15 fps — a typical mobile inference rate — that window slid past
the still-hand samples before the push was confirmed, so a 0.2 s push was **missed** (the suite
only covered 30, 8 and 4 fps). PULSE now measures the rise from the last moment the hand was
still small (two consecutive samples) within 0.55 s, with the post-push size taken as the minimum
over the sustain frames; motion uses a steadier palm `size` (four wrist → knuckle distances
averaged) because the single-distance `scale` turned doubled landmark noise into false pushes.
SWEEP no longer counts the resting anchor sample against its direction or speed (it missed every
stroke at ≤ 6 fps). The suite now covers 30, 24, 20, 15, 12, 10, 8, 6 and 5 fps (plus 4 fps).

`apps/web/src/input/camera/camera-controller.test.ts` (8): push → one PULSE intent from source
`camera`; LIFT ends on opening and on dropout; picks follow the loadout (hold start/end vs tap);
WET/HEAT modifiers; stroke direction through the view axes; calibration label flip adopts the true
hand (and without it the same frames do nothing); nothing sent while paused / practising /
calibrating and pausing ends a held LIFT; screen → arena spans each seat's legal half.

## Browser evidence (Playwright, production build, headless Chromium + SwiftShader)

Seven Phase 05 tests (`e2e/phase05.spec.ts`, `e2e/phase05-goal.spec.ts`, `e2e/phase05-denied.spec.ts`):

1. **Real camera path** — Chromium's fake camera plays a Y4M built from four real MediaPipe test
   photos (V sign, fist, pointing finger, thumbs-up); frames go `getUserMedia` → vision worker →
   the real hand model (CPU delegate) → gesture engine. Practice registers WET, LIFT, PICK 1 and
   HEAT from the model's own landmarks; in the match the V sign puts a seat-0 water pool into the
   authoritative world.
2. **Synthetic gestures through the same controller** (no camera): an open hand moves the force
   point across the midline; a palm push casts exactly one authoritative PULSE; a held fist starts
   a server LIFT hold that is still on when the hand vanishes and is released by the camera's END
   (the authority accepts both the start and the END — an END after a server-side release would be
   refused); after 2 s lost the chip offers **Recalibrate** (S12) and "Back to the match" returns.
3. **Online, both players on camera** — two browser contexts (two "devices") join a room through
   local workerd; each picks camera control; each device receives both seats' camera-driven PULSE
   casts from the room; every frame either device sent is a small JSON game message (hello / ping
   / ready / intent / rematch / leave, < 600 bytes, never binary, no landmark/image/video/frame
   data) and camera PULSEs arrive as ordinary `intent`s with `source: camera` (G06, G15).
4. **Camera player scores and rematches (D05 gate)** — a closed-loop stand-in learns the hand →
   force-point mapping by moving its synthetic hand, then steers behind the core and pushes its
   palm; only camera gestures are used. It scores against the easy bot (if the bot wins a match
   first it rematches and continues), the match plays out, and after a rematch a palm push is
   accepted again.
5. **No permission** (a headless browser cannot prompt) → error panel → one-tap keyboard fallback
   → the match is playable (S10).
6. **"Block" on the permission prompt** (`NotAllowedError` at the API boundary) → "not allowed" →
   one-tap fallback (S10).
7. **Settings → Camera control** — playing hand, sensitivity, sign hold time, self-view and
   "Forget calibration" persist.

Full suite on the final code: `pnpm exec playwright test` — **20/20 passed** in 13.6 min, 0 flaky (phase01 ×3, phase02 ×4, phase03 ×3, phase04 ×3, phase05 ×7). In that run the camera stand-in scored in its first match with 6 palm pushes → 6 accepted PULSE casts, all 6 striking the core (earlier runs: 3–11 pushes; one run lost the first match to the bot and scored in the second).

## Latency (quantified per stage, this container only)

Per stage, as measured in this container (4 vCPU, headless Chromium, SwiftShader software WebGL,
MediaPipe on the CPU delegate). These are **not device numbers**: the page's own software
rendering occupies the main thread in ~70 ms tasks even at 640×360 (≈ 300 ms at 1280×720 in a dev
build), which delays every main-thread step.

| Stage | Measured | Source |
|---|---|---|
| Camera frame captured → landmarks back on the main thread | 164 ms at 6 fps (model 110 ms per frame) with the page at 640×360; 364–474 ms at 3 fps with the page at 1280×720 | real camera E2E (`latencyMs` stat, real photos, CPU delegate) |
| Landmarks → gesture recognised (motion onset → event) | PULSE median 267 ms at 30 fps, 333 ms at 15 fps; signs = the 280 ms hold + 50–120 ms at 30 fps (+ up to 250 ms at 12 fps) | `pnpm benchmark:gestures` (synthetic clock) |
| Gesture recognised → authority verdict back on the page, local worker | 64 ms (other runs 72–85 ms; 331–340 ms when the page rendered at 1280×720) | synthetic E2E (`__ffDebug` verdict arrival − gesture time) |
| Gesture recognised → room verdict back on the page, local workerd over WebSocket | host 654 ms, guest 747 ms — two pages at 960×540 sharing 4 vCPUs, both main threads saturated by software rendering (not network latency: local loopback RTT p50 ≈ 2 ms) | online E2E, both seats |
| Hand lost → server hold released and visible in snapshots | 0.67 s (hold visible until 2.97 s, hand lost at 2.30 s); 0.5 s of it is the designed release delay | synthetic E2E sampled trace (engine releases at +500 ms by design) |

Not measured: the same chain on phones/laptops with GPU inference and hardware rendering, or over
the internet to a deployed room. D05's "≤ ~150 ms smoothing lag on supported test hardware" can
only be checked on real hardware (Phase 11 / D15 device lab).

## Visual evidence (actual renders, `docs/visual-evidence/phase-05/`)

Captured with `node scripts/capture-camera-ui.mjs <baseUrl> <outDir> <hands.y4m>` from the
production build (headless Chromium + SwiftShader; fake camera playing the photo-hand Y4M). The
hand in the self-view is one of MediaPipe's public test photos (the `mediapipe-assets` bucket of
the Apache-2.0 MediaPipe project), fetched only for tests and never shipped in a production build.

- `camera-1-choose` — step 1: privacy line, Close hands / Camera stand, playing hand, camera,
  Start camera / Skip. `camera-2-frame` — step 2: mirrored self-view of the (photo) hand,
  "Tracking your hand · steady · N fps". `camera-3-practice` — step 3: PULSE/GUARD checklist and
  the gesture card with the seat's real picks. `camera-4-match-chip` — in match: status chip with
  the last recognised gesture, optional self-view, and a seat-0 water pool created by the photo V
  sign. `camera-5-gesture-card` — the in-match gesture reference.
- **Iteration 1 critique:** the ready gate behind the wizard showed through the translucent panel
  (its text overlapped the wizard's title and options), and the chip echoed internal names
  ("PICK1"). **Fixed:** the setup panel is opaque over the standard blurred backdrop, and the echo
  names the move ("FREEZE"). Re-captured after the fix.
- Remaining (Phase 09 UX pass): an animated instructional silhouette per gesture (the prompt's
  20–45 s onboarding) is text-only today; the frame guide overlay is faint.

## Honest limits

- **No physical-device, live-person or lighting tests.** The only real camera input was Chromium's
  fake camera playing a Y4M built from four MediaPipe test photos (`scripts/make-hand-video.mjs`):
  real imagery and real inference, but static shapes on a plain wall, one hand, no motion blur, no
  low light, no bystanders. Landscape/portrait, low light, one hand / two hands, a nearby second
  person and real phones remain owed (D05 device tests; Phase 11/D15 device lab).
- Gesture thresholds were tuned on synthetic hands and checked on real photos for shapes only;
  PULSE / SWEEP motion thresholds have not been validated on real people's motion.
- Performance numbers here are SwiftShader + CPU delegate (no GPU) and are not device benchmarks;
  the browser test page itself renders at only ~6–14 fps here, which starves timers.
- Stand mode's pose model is wired (torso gates for camera pan/dolly) but was not exercised with a
  real upper-body image.
- Download size: nothing camera-related loads until the player taps "Start camera"; then the
  browser fetches the WASM runtime (11.8 MB) and the hand model (7.8 MB), plus the pose model
  (5.8 MB) in stand mode, cached afterwards. Smaller/quantised models are a Phase 11 option.
- DRAW and FOCUS have no gesture because the authority does not implement them (ADR-0007 §3).
- Remote online play with cameras on two physical devices needs the deployed Worker (Phase 12).

## Commits

- `8a65379` Phase 05 (1/3): @ff/gestures — local gesture engine with synthetic-landmark suite
- `24fbd69` Phase 05 (2/3): on-device camera control end to end
- Phase 05 (3/3): report, ADR-0007, visual evidence, build status (this commit)

## Next instruction

Phase 06 — mobile sensors and touch (prompts/06 + D06): handheld gyro / accelerometer control as
its own configuration (never assuming the handheld camera sees both hands), sensor fusion and
calibration, permission flows, and touch controls tuned for phones — all normalised to the same
`ActionIntent` stream.
