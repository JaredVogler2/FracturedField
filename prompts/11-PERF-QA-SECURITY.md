# PROMPT 11 — PERFORMANCE, ADVERSARIAL QA, PRIVACY AND SECURITY

## Mission
Test the game as an adversary, a low-end phone user, a network engineer and a skeptical QA analyst. Find all ways it breaks. Fix measurable problems, and produce evidence; no "runs great" without measurement.

## Benchmarks / observability
Create opt-in performance dashboard (dev builds only) tracking: browser FPS p50/p95, main thread long tasks, GPU draw calls/geometry/texture memory, WebGL shader compilation stalls, camera inference FPS/p95 latency, frame-to-action delay, authority tick processing time p50/p95/max, snapshot sizes, network RTT/jitter, out-of-order/dropped updates, confirmed authoritative scores.
- Benchmark presets: idle, one air field, simultaneous heat/water, freeze+fracture, overlapping gravity+electric, goal explosion, 10 consecutive rematches.
- Measurements on desktop, two representative iPhones and Android when accessible. Emulator stats are not physical-device evidence; say when absent.
- Profile memory after camera toggle 20 times, room reconnect loop, repeated restart, and WebGL context loss; ensure tracks stopped, event listeners removed, WASM worlds freed, WebSocket timers ended.
- Tune tier adaptation based on sustained FPS moving average with cooldown/hysteresis, not frequent thrashing.

## Core physics & networking attacks
- Fuzz 1,000 random seeded input streams: finite transforms, bounded energy/collider/body count, no spin/velocity blowups or tick stall.
- Simultaneous physics trigger race: goal-crossing plus freeze / score in same tick, duplicate collision events, stale region effects, sudden death expiration.
- Client attempts: send fake goal/win, future tick IDs, impossible forces, negative cost, NaN/Infinity/huge floats, invalid type, stale seq, fake reconnect token, token of other seat, room enumeration, >1,000 commands/s and oversized packets.
- Server verifies eligibility and rejects malicious attempts gracefully with no memory explosion. Per-IP + per-room + per-seat rates where appropriate; CPU budgeting.
- Test two clients over real vs simulated lag with 0/50/150/250ms RTT, jitter and disconnection; no divergent official scores, bounded correction, no rapid interpolation glitches.
- Test worker restart / idle hibernation restore semantics; active match recovery should be explicit: resume from checkpoint or legally terminate with notification; no quietly restarted score.
- Pin shared protocol version and reject incompatible build; inspect exceptions and surface recoverable issue.

## Privacy and consent
- Camera and motion permissions only after explicit user action; camera local-only; prove with network inspection.
- Do not store or transmit raw video, stills, voice, landmark streams or identity profiles. No covert analytics. Match events may be anonymous; transparency screen explains ephemeral sensor inference.
- All tokens expirations enforced, never in publicly shared room link if avoidable. Rotate/revoke after rejoin/seat release; protect logs.
- Verify origins for WS handshake, auth credentials and rate limits; Origin isn't auth. Validate untrusted strings rendered in UI and shared links; no injected HTML/scripts.
- Security headers: CSP (appropriate for WASM/assets), HSTS in production, referrer policy, permissions policy, restrictive camera use if embeddable. Avoid exposing debug routes or map of rooms.
- Dependency audit and license audit, no secrets in git, .env.example only; do not place server keys in VITE_ public build.
- Verify room TTL and user-requested leave cleanup.

## Accessibility / human factors
- All match-critical controls possible without camera or fast movement, single hand, reduced-motion, disabled vibration, captions.
- Images/flashes/vignette/shake may cause discomfort: implement brightness limiting, reduced flashes and no nausea-inducing tracking-to-camera pose; test settings persisted locally.
- Keyboard focus order and visible focus ring in menus, screen reader support for score change, rematch actions.
- Camera placed securely: no prompts to rapidly swing phone or physically risk collision with surroundings.
- Test mobile tab hidden/background/reload and OS camera revocation.

## Device/test matrix and proof
Maintain docs/QA_MATRIX.md with platform, version, resolution, permissions, control path, performance, networking, graphics, audio, and outcomes. Have automated Playwright smoke/E2E for create/join/both-ready/match/rematch with mocked gesture fixtures, unit+integration for physics and server rules, security fuzz tests. Real camera and device latency require real-device steps.

## Regression process
Every failing case becomes a reproducible test. Classify P0 crash/data leak/authority divergence; P1 broken ability/tracking/render; P2 polish. Fix P0/P1 before shipping. Provide prioritized bug list with stack trace, reproduction and remediation evidence.

## Acceptance
G01–G15. If cloud costs or device performance exceed design envelope, document and choose a meaningful user-facing degrade mode rather than shipping unpredictable stutters.
