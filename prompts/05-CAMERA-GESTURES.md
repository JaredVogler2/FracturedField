# PROMPT 05 — CAMERA-BASED BENDING: HANDS / BODY GESTURES

## Mission
Enable **each player to use their own device camera** to directly manipulate the shared 3D world. Camera control must feel magical, legible, forgiving, and not need a separate AI inference API. Do not confuse detecting landmarks with interpreting actions.

## Hardware mode constraints
- Dedicated CAMERA STAND mode: rear or front camera pointed at player with visible hands / upper torso, device set on a desk or stand. Warn before setup that users must put the device down and step into frame; no holding phone for whole-body gesture play.
- CLOSE HANDS mode: front-facing phone/webcam can see one or two hands at short distance; optimize for seated players and constrained spaces.
- Webcam desktop mode: face/shoulders/hands tracked. Avoid making face recognition a prerequisite or computing identity.
- Mobile HANDHELD mode with phone gyro/touch is a separate control path; do not silently require its camera to see both user hands while device is held.

## Inference pipeline
1. User actively grants camera permission via getUserMedia HTTPS. Provide preview + camera flip/mirror setting and foreground lifecycle.
2. Use MediaPipe @mediapipe/tasks-vision Hand Landmarker, optionally Pose Landmarker for broad arm gestures, browser-side only. Choose sensible numHands=2 per device and numPoses=1 per device (one player/device). Discuss upside/downside of Pose tracking when hands partially hidden.
3. Run adaptive video inference: 15–30Hz if sustainable, off main thread via worker and supported frame path where possible. MediaPipe synchronous video detection must not block render; fallback to lower infer resolution/rate on devices without transferable pipeline.
4. Canonical LandmarksFrame timestamp, confidence, handedness, wrist, fingertips, palms, shoulders/elbows; prevent stale frame reuse and mirrored-space inversion.
5. Calibrate for approximate depth, neutral stance, dominant hand, working motion range, mirror mode, face-to-camera orientation. Do not treat 2D camera pixels as precise 3D position or infer actual distance from one uncalibrated frame.
6. Implement GestureFSM per action: idle -> candidate -> activated(start) -> held(hold) -> released(end) -> cooldown. Temporal hysteresis, EWMA smoothing, minimum hold frames, reliable dropout behavior.
7. Explicit intent resolver maps movements to normalized actions **without** direct arbitrary server force values. Aiming from normalized screen offsets projected onto arena aim plane; show preview in 3D and track confidence.
8. No gesture action while permission dialog, tab background, hand lost > threshold, or calibration screen. On loss send END/cancel of active hold intent.
9. Lock tracking to local player only; a bystander in frame should not steal player 1 control. Include re-acquire and prompt.

## Gesture vocabulary (designed for accidental firing prevention)
- Aim: open dominant palm points toward target via stable wrist/finger vector + aim reticle; optional dwell smoothing.
- PULSE: stable open palm -> deliberate short palm push toward camera, or quick arm extension if Pose supported; velocity threshold + cooldown + explicit on-screen confirmation. Guard against fast accidental camera jitter.
- DRAW: pinch thumb/index together to attach closest valid target, hand pull toward torso; hold maintains field at capped rate; release drops.
- LIFT: pinch/open raising hand gradually vertically, with world mapping / explicit target selection; hold to lift.
- SWEEP: splayed hand horizontal swipe; path curvature and sign set vortex direction; throttled repeat.
- GUARD: two palms briefly held close with forearms crossed, OR a one-hand palm-still alternate for single-hand players; make action accessible rather than requiring contortions.
- INFUSE: thumb+index hold and controlled second-hand orientation or on-screen element wheel, with dominant hand follow-through; no 8 elaborate gestures.
- FOCUS: hands held stable near center for 0.7s then release; accessible tap-and-hold fallback.
Confidence/thresholds are configurable, user-sensitive after calibration and testable using prerecorded synthetic landmark fixtures.

## Interfaces and overlays
- Camera preview small/optional, local-only; skeletal line guide optional and off by default; show "Tracking: 2 hands, stable" vs "Lost hand" with non-invasive icon.
- Teach one gesture at a time in 20–45s onboarding, show animated instructional silhouette and then require a successful practice Pulse / Shield.
- Sensitivity slider and dominant hand, mirror, one-hand mode, seated mode, safe range; adjustable dwell duration.
- Calibration pass/fail must not block PLAY: one button switches to touch control.
- Focus under fatigue: all moves available from simpler gestures/hotkeys.

## Privacy / performance
Do not upload raw media, fingerprints, face image, landmarks history or identity embeddings. Current landmark frame is ephemeral RAM and discarded. Diagnostic mode stores artificial landmark samples only unless user explicitly saves a test video LOCALLY; no cloud.
GetUserMedia errors: denied, not found, NotReadable, NotAllowed, insecure context, unsupported, background/revoked; each recoverable.
Energy efficiency: monitor inference time and render FPS, reduce camera workload when screen is busy.

## Verification
- Synthetic landmark sequences for every gesture with positive, negative and borderline cases; activation/release rate under jitter/occlusion.
- Two browser sessions each with its own camera stream in real match (if feasible), prove no media uplink; network inspector verifies only ActionIntent.
- Camera denied + lost mid-LIFT -> release, fall back to touch, no stuck persistent server force.
- Mirrored vs unmirrored reticle and left vs right handed calibration.
- Device tests: landscape/portrait, low light, one hand, nearby second person.
- Quantify latency from captured landmark timestamp -> local aim -> server accepted action.

## Acceptance
G06, S10, S12, G15; no lost-hand ghost gestures. Real camera-driven gameplay, not just displaying a hand skeleton.
