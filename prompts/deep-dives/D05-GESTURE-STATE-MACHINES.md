# DEEP DIVE D05 — CAMERA GESTURE CONTROL AS A ROBUST INPUT PRODUCT

**Execute with Phase 05.** Deliver local on-device hand/pose inference, actionable gestures and resilient detection; no demo that only draws landmarks.

## 1. User setup
Design a 3-screen wizard: Select camera / place device and frame body or hands / calibrate & practice. Use selfie camera default, mirror preview while preserving correct world left/right mapping. Make privacy notice short: "Your camera remains on your device. Only game controls are shared." No camera permission until tapped. Detect permission errors and offer touch mode without blocking.
- Mode 1: stand mounted upper-body: MediaPipe Pose 1 person + Hand Landmarker up to 2 hands, when device and performance allow.
- Mode 2: close-up hand tracking: Hand Landmarker only.
- Mode 3: skip camera and play with touch/gyro/keyboard.

## 2. Landmark pipeline
Define normalized HandFrame, PoseFrame, TrackConfidence and GameGestureEvent with timestamp, per-hand handedness, palm center, fingertip distances, forearm projected vector, shoulder centers. Use calibrated scale from palm/wrist dimensions; avoid claiming true depth from 2D. Make source entirely local.
- Inference off main render loop; implement transferable frame strategy in Worker where browser/browser API allows; if unavailable, throttle synchronous detectForVideo with performance budget and document fallback. No per-frame transfer of full-resolution pixels across processes if it bottlenecks.
- Two independent loops: render 30–60Hz, inference 12–30Hz, command send 10–20Hz. Timestamp interpolation/smoothing must not lag cast feel by >~150ms on supported test hardware.
- Handle landmark timeout, inconsistent handedness, frame freezing and occlusion.

## 3. Calibrated gesture machine
State progression: SEARCH -> NEUTRAL -> CANDIDATE -> ACTIVE -> HOLD -> RELEASE -> COOLDOWN. Define enter/exit thresholds separately, confidence gating, debounce >2 frames, minimum activation interval, latch and explicit END on lost hand >500ms (tune by tests). Use asymmetric smoothing for fast motion vs idle aiming.
- PULSE: open palm to deliberate palm extension relative to torso or calibrated baseline, with velocity/hysteresis and cooldown. Must not fire when moving camera, changing focus or shaking.
- LIFT: pinch or closed-hand selection then vertically raise hand for held force. If tracking disappears issue END.
- DRAW: pinch then move hand toward torso; aim anchored at selected world target and show tether.
- SWEEP: sustained open palm lateral motion with consistent signed velocity; emit one vortex cast rather than dozens of commands per swipe.
- GUARD: two-hand cross or accessible palm-up hold alternative; never force crossover physical contortions.
- INFUSE: element selected from a large touch-accessible radial wheel or stable second hand pose; requires confirmation, cannot trigger accidentally when adjusting device.
- FOCUS: hold stable pose 700ms then deliberate release; timer visible to user.
Implement unit gesture recognition against synthetic sequences plus optional LOCAL recorded fixtures; no copying raw hand streams to server.

## 4. Mapping screen to world
Camera image coordinates -> mirrored/calibrated normalized normalized aim -> ray intersection with arena aim plane -> legal target clamp. Player can shift aim across whole arena without physically leaning/jumping. Separate aim confidence from ability activation. Opponent's camera landmarks NEVER needed locally.
Display latency telemetry per local process stage only in dev mode.

## 5. Anti-false-positive test suite
Fixture categories: neutral hands, hand wave greeting, rapid camera pan, blur, shadow, shaky hand, crossed bystander, partially occluded hand, one hand goes off frame, left and right hand mirrored, high/low gesture speed, pinch flicker, two gestures near-simultaneous, two different camera aspect ratios.
Assert false-positive cast under idle <1 per 5 minutes of synthetic idle fixtures (target), verified cancel on tracking drop, precise cast count not repeated, accurate sign of vortex, no invalid NaN aim.

## 6. Real multiplayer integration
Local gesture resolver -> input adapter -> canonical ActionIntent -> server validation -> world. No video/landmarks transmitted; multiplayer must show both wielders' accepted actions by action events. Both players independently choose camera/touch modes.

## Gate
Camera user can intentionally move the core, score a goal and rematch with gesture input; camera denial/dropout cannot trap or unfairly freeze match. Record actual device/lighting conditions.
