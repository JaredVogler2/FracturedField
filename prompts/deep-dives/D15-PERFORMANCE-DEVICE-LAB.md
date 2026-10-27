# DEEP DIVE D15 — HARD PERFORMANCE, MOBILE BROWSER, NETWORK AND PRIVACY GATES

**Execute with Phase 11 and revisit during Art stages.** The product must work on phone browsers, even with camera inference and multiple VFX. The aim is smooth responsiveness and accurate physical state, not synthetic 120fps screenshots.

## Instrumentation
Write a dev-only overlay recording frame FPS p50/p95 and long frames, current WebGL draw calls and geometries/textures, active particles and transparency overdraw approximations, physics tick p50/p95, Worker memory/cpu estimates, incoming/outgoing bytes per match, RTT and jitter, snapshot interpolation depth, camera inference runtime p50/p95 and pose confidence.
Export sanitized JSON performance report with device/browser, viewport, quality tier, seed and scenario. Do not export biometric data, frames or tokens.

## Four performance modes
- Desktop High: moderate DPR cap (e.g. 1.5–2.0), detailed geometry and controlled postprocessing, shadow map, full signature VFX, target 60fps.
- Mobile Medium: DPR ~1–1.4 adaptive, simpler shadows, particle pooling, limited bloom, 30–60fps.
- Mobile Low: DPR ~0.7–1, low particle counts, baked environment, no full-screen distortion, still readable and stylish at 30fps.
- Accessibility Reduce Motion: remove shakes, heavy camera moves and intense flashes independent of raw perf tier.
Never disable essential physics or gameplay for low tier; server remains identical.

## Stress matrix
- Idle match (baseline), both users continuous SWEEP, simultaneous gravity+fire+water, fracture burst, charged wet region with 20 objects, core portal goal cinematic, 10 rematches, 20 room reconnect attempts, camera on/off 10 times.
- Worst-case dense translucent particle overdraw on Safari, shader compile after first use, startup load via cellular throttling, 15% packet delay variation, 2% packet loss, background tab, WebGL context lost, device rotated, camera stream taken by another app.
- Test two clients in separate actual network regions if available, but don't claim geographically distributed testing when none run.
- Worker load: simulate 1/10/50 active match rooms using permitted infrastructure, measure tick processing vs 33.3ms budget; if DO architecture fails actual limits use long-lived stateful host with documented reason, not authority on client.

## Security attacks
Try fake score, replayed token/command, out-of-range aim, NaN intensity, high-frequency spam, forged player seat, room brute force, oversize packets, room invite link injection; enforce rate limit, max message size, schema validators and expiring tickets. No external storage of any camera landmarks.
Open source package audit and asset license manifest; review secrets/CSP and worker CORS/origin. Vite public env only public data.

## Automated & manual devices
Playwright automated web smoke and screenshots; Vitest sim property tests; network simulator; actual iPhone Safari and Android Chrome checklist with permission/gyro/physical camera. Never mark simulated sensor events as real mobile validation.
Use docs/ACCEPTANCE.md scenarios; label each PASS/FAIL/BLOCKED/NOT TESTED. Physics event log against two clients must yield same scoring and match outcome.

## Acceptance thresholds
Target desktop 60fps; midrange mobile >=30fps typical match, graceful drops but no sustained frame stalls. Server 30Hz p95 tick well under 33ms (prefer <10ms to accommodate overhead) under typical intended room budget. Network stays playable at ~100ms RTT while correcting after dropouts. Explicitly adjust ambition if measured devices prove targets unavailable.

## Gate
No P0/P1 defect open for privacy, authority, essential control, crash or severe unplayable phone FPS. Provide actual numbers and environment.
