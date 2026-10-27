# DEEP DIVE D06 — IMU, CAMERA, TOUCH AND GYRO DEVICE CONTROLS

**Execute with Phase 06.** The control system must be an actual product, not proof of API access.

## Input architecture
Every method emits ActionIntent with the same aim plane and cost/force caps. Write InputController with enable, calibrate, getAim, actionStart, actionHold, actionEnd, pause, dispose; adapters for Camera, Touch, Motion+Touch, Keyboard, Gamepad, Bot. Hot-swap safely during match, neutralize held effects and show short handover message; no duplicate listeners.

## Mobile motion mode
- Browser DeviceOrientation and DeviceMotion availability feature-detected; iOS-style requestPermission only within direct click and when API exists. When sensor unavailable or denied, switch to touch. Do not request at app startup.
- Calibrate neutral yaw/roll/tilt against current handheld pose; gently map relative change to 2D aim on arena plane. Dead zone to suppress noise; acceleration/velocity lowpass with fast response for deliberate gestures; recenter large button. Use gyro not raw compass heading as infallible absolute orientation; handle drift and screen rotation.
- Optionally use sharp short deliberate twist/flick only as one modifier when safe and reliable; no shaking phone, punching or whole-body swings. Primary abilities activated by touch to prevent accidental power.
- Disable game move triggers when tab backgrounded, permissions revoked or OS pauses sensors. Resume requires recenter confirmation.

## Touch mode
- Dominant hand selection. One-thumb aim surface, tap Pulse, hold Lift, large ability wheel, Guard accessible by a dedicated thumb-friendly button, swipe Sweep gesture in a safe touch region. Avoid two-finger gestures conflicting with iOS Safari browser gestures.
- Pointer events on gameplay hit layer, capture/release pointer IDs, prevent touch-action pan/zoom only where necessary; preserve browser scroll elsewhere. Large hitboxes >=44px where feasible.
- Handle accidental edge-swipe, notch/dynamic island, scale changes and CSS safe area inset.
- Landscape recommended; portrait must either adapt to full playability or offer safe rotate prompt plus accessible mode without breaking match.

## Fusion policy
Don't mix live camera and IMU as though frame spaces are comparable. Camera Stand = visual gestures + screen aiming. Motion = relative-device orientation + touch. Hybrid is OPTIONAL with an explicit sensor priority and timestamp/confidence arbitration. All input modes use bounded normalized aim and same gameplay effectiveness.
Implement capability matrix and UI compatibility test, not just feature detection alone.

## QoS
Target local aim response visibly immediate even if server round-trip is slower. Motion smoothing: separate 80–150ms low-frequency drift correction and ~30–60ms fast gesture response as measured trade-offs, not asserted exact values.
When sampling at variable intervals, integrate with actual frame timestamps but send bounded intents to fixed-tick authority; calibrate sign and mirror mapping on iOS vs Android.

## Test cases
Rotate iPhone 90°, switch from gyro to touch mid-LIFT, revoke sensor permission, deny camera, landscape safe area, multiple simultaneous taps, 1% sensor NaN/null, device asleep/restore, 4:3 tablet UI, desktop gamepad reconnect, low FPS, accessibility one-hand mode.
Synthesize sensor feed fixtures plus manual instructions for real iOS and Android; automated emulation is not proof of sensor permission APIs.

## Gate
On a phone with no usable sensors and no camera permissions, player can join remote match and complete 3 rounds with touch controls alone.
