# PROMPT 06 — PHONE INPUT, GYRO, TOUCH AND ACCESSIBILITY

## Mission
Make FRACTURE FIELD enjoyable on ordinary iOS Safari and Android Chrome, even when camera tracking is not appropriate. Controls must be ergonomic, responsive, capability-aware, and competitively equivalent across modalities.

## Control mode selection
Build device-capability onboarding with explicit options:
A. CAMERA STAND: phone/tablet on stand sees 1–2 hands or upper body; screen shows large readable action cues.
B. HANDHELD MOTION: phone held like a magic wand, gyroscope/device orientation aims, accelerometer offers optional gesture modifier. Thumb touch triggers precise abilities; no assumption camera can see body.
C. TOUCH ARENA: one-finger aim/draw, tap pulse, swipe sweep, two-finger guard, long press lift; configurable minimal UI, orientation-friendly safe areas.
D. DESKTOP: pointer/WASD or gamepad; bindings can be reconfigured.
E. ACCESSIBLE SIMPLIFIED: tap-to-target and button skills without rapid movement or fine motor timing.
Optionally hybrid stand-camera + nearby watch/second controller later, but do not invent cross-device pairing as a basic requirement.

## Device APIs
- Feature-detect DeviceOrientationEvent and DeviceMotionEvent, only on secure origins. Implement iOS-style requestPermission within synchronous user-initiated button click. Denial leaves UI usable.
- Device orientation is not absolute translation; map tilt/yaw/pitch to calibrated local aim, not measured body movement. Account for screen angle, orientation change, drift, sensor gaps and null values.
- Motion spikes cannot be sole determinant of high-power moves; input game fairness clamps intensity and server validates cooldown/cost. Add optional sensitivity and a recenter control.
- Do not assume gyro exists on laptops/tablets. Input Adapter interface is stable and normalized before network transmission.
- Handle touch-action suppression inside arena only, browser viewport scrolling elsewhere. Respect safe-area insets, thumbs, landscape; prevent unwanted browser navigation.
- Use haptics only if API supported. Most Safari haptic vibration unavailable; gracefully fall back to audio/visual cue.
- Add optional Gamepad API with sensible mapping; handle connect/disconnect at runtime.

## Visual controller design
- Large unobtrusive dual-thumb controls: left thumb camera/aim zone, right radial ability selection + primary action (adapt if no virtual movement axis); customizable hand preference.
- HUD energy and cooldown always visible, but never cover core/goal. Pressed states have crisp subtle effects; haptic/audio/contrast equivalent.
- Motion mode includes horizon gauge, recenter cue and calibration animation; no spinning nauseating camera.
- Preserve game scene stable and readable independent of sensor yaw. Gyro controls the in-world force reticle—not camera viewpoint by default.
- Display input mode indicator and one-tap alternate control if sensor fails.
- Phones should run with both portrait and landscape? Prefer **landscape gameplay** with a friendly rotate suggestion, but still provide playable portrait compact UI or deliberate documented support policy and browser fallback.

## Fairness / anti-exploit
All input adapters generate ActionIntent {ability, phase, aim, intensity} bounded by same server rules. Gesture speed should not boost damage beyond caps, touch buttons cannot spam freely, no paid/rare hardware advantage. Rebinding/one-hand mode offers access to all basic moves. Auto-aim limited and equally accessible.

## Test plan
- iPhone Safari: permissions granted/denied, reload, orientation rotation, app background, camera and motion request separately, no insecure-origin promise.
- Android Chrome: permission and null sensor fields; touch/motion switching; orientation lock assumptions tested.
- Desktop Chrome/Safari/Firefox: keyboard/gamepad, camera-deprived, no touch emulation required.
- Simulated high sensor noise/recenter spikes; clamp aim and ensure no ghost attacks.
- Match can be completed using touch alone, single hand, or keyboard; game remains fun at 30 FPS.
- Touch tests account for resize, viewport safe area, 320–430 CSS px widths and tablet.
- Document actual physical tests vs browser device emulator.

## Acceptance
G07 G11 and G03/G04 no regressions. Every 2-player match can proceed when both deny camera+gyro.
