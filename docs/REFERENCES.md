# RESEARCH & AUTHORITATIVE REFERENCES

Verified/consulted October 26, 2026. Claude Code should check CURRENT documentation during implementation and pin compatible library versions; never assume a tutorial's example code still builds.

- Vercel WebSockets GA (Oct 20, 2026): https://vercel.com/changelog/websocket-support-is-now-generally-available
- Vercel Functions WebSockets and multi-instance coordination: https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
- Cloudflare Durable Object WebSockets and hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Cloudflare Durable Object instance limits / CPU / WebSockets: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Stateful objects: https://developers.cloudflare.com/durable-objects/
- Rapier JS cross-platform deterministic constraints: https://rapier.rs/docs/user_guides/javascript/determinism/
- MediaPipe Hand Landmarker Web: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- MediaPipe Pose Landmarker Web: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Browser motion and device orientation: https://developer.mozilla.org/en-US/docs/Web/API/Device_orientation_events
- Browser motion permission from activation: https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static
- Browser camera getUserMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Three.js: https://threejs.org/docs/
- React Three Fiber: https://r3f.docs.pmnd.rs/
- WebRTC optional voice (do not block the game on voice): https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API

Important:
* Vercel native WebSocket availability does not imply guaranteed shared in-memory room across two Function instances. A single authoritative room host is required.
* Cloudflare Durable Object hibernation saves money for IDLE WebSocket sessions. An active ticking simulation may prevent hibernation, and sustained WASM physics load must be tested against plan constraints.
* Rapier determinism requires same version, fixed steps, deterministic setup and order; server-authority + interpolation does not depend on perfect speculative-client determinism.
* A mobile phone camera sees what it is pointed at. Handheld gyro play and full-body camera tracking are separate ergonomics; do not promise simultaneous camera/gyro wizardry unsupported by physics.
* Physical realism is bounded and game-oriented; it is not full fluid, combustion or N-body simulation.
