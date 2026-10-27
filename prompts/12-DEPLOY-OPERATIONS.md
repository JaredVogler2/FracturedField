# PROMPT 12 — LIVE VERCEL RELEASE + AUTHORITATIVE GAME ROOMS

## Mission
Deploy a genuinely usable two-device FRACTURE FIELD to the internet. This must work from URLs on two physically distinct devices, not merely through localhost or a test harness. Vercel hosts the browser client; Cloudflare Worker/Durable Object hosts rooms by default. Keep cloud spending predictable.

## Release topology
- apps/web static Vite built output hosted by Vercel project, HTTPS. Set VITE_GAME_SERVER_URL to public wss:// Worker endpoint; validate correct deployment origin and protocol compatibility. Vite env vars are **public**; NEVER put token-signing secret in VITE env.
- apps/room-worker deployed by Wrangler to Cloudflare Worker with Durable Object binding configured and correct migration. Strong secrets only on server via Wrangler secrets / platform environment. Durable Object maps room ID/name to room state.
- Distinct development / staging / production environment names and URLs. Invite link points to exact correct frontend environment, no cross-environment room confusion.
- App returns valid create/join/health only as needed. Use stable Worker routing and allow websocket upgrades via intended hostname with WSS.
- Optional Vercel server-side WebSocket support is GA as of Oct 20 2026, but this project uses a single stateful room owner to prevent multi-instance state divergence and avoid running an active authoritative simulation in stateless function affinity assumptions. Document alternate transport only if implemented.

## Concrete tasks
1. Audit monorepo scripts, files, Vercel project root and build command, workspace install, Node/npm version, platform ESM/WASM bundling compatibility.
2. Create vercel.json only when necessary; proper SPA rewrites, caching for hashed assets, security header plan, redirect HTTP -> HTTPS. No global cache for room-sensitive responses.
3. Complete wrangler config with Durable Object bindings/migrations, compatibility date, resource budget/limits and staging/production separation. Provision through authorized credentials only; never claim deployed without provider response.
4. Document secret values and who generates them, *without publishing actual secrets*. E.g. TOKEN_SIGNING_SECRET, ALLOWED_ORIGINS, ROOM_TTL_MINUTES, room protocol version, VITE_GAME_SERVER_URL, feature flags, logs config. Provide .env.example and docs/OPERATIONS.md for safe configuration.
5. CI/CD: lightweight GitHub Actions build/test on PR and main; deploy preview web if integrated; controlled Worker staging deploy. Do not risk prod availability from every code push. Prefer Vercel Git integration for web deploy where available.
6. Production health/telemetry: anonymous structured event logs, per-room error and tick overrun metrics, crash boundary, network handshake failure, browser WebGL failure. No camera/raw landmark logs. Implement alerts only if monitoring service available.
7. Rate limits and abuse controls: room create throttle, TTL idle cleanup, max player count 2, seat ticket validation, origin checks, message sizes, idle WebSocket cleanup, avoid scraping/room enumeration. Evaluate pricing implications from active rooms ticking and WebSocket open duration.
8. Bandwidth/resource budget: quantify authoritative tick CPU, p95 snapshots size × Hz × 2 seats, approximate active room cost under selected plan as documented estimates with explicit assumptions and date; benchmark against plan caps.
9. Browser cache bust / protocol mismatch: if web client and Worker build versions differ show explicit "Refresh to update" instead of crash; robust phase rollout strategy.
10. Add automated public smoke test script using two separate clients pointing at staging deployment (no fake state). Verify no CORS/WS/origin TLS surprises.

## Manual live acceptance checklist
- Load HTTPS site on actual phone over cellular; create room.
- Open invite link on another browser/device on Wi-Fi and join, each device independently grants/denies permissions as chosen.
- Ready both seats, cast opposed abilities and verify same core positions to acceptable visual interpolation and exact same scoring result.
- Complete round and rematch; intentionally disconnect one device and rejoin via appropriate credentials.
- One device uses Camera Stand, the other touch/motion; no camera video is uploaded.
- Repeat with both denying camera + motion and verify successful full match.
- Test expired token/room full, backgrounding, rotation, safari screen lock and WebGL fallback.
- Record literal production/staging URLs, build IDs, test timestamp, devices, screenshots/logs, exact known untested items. DO NOT declare physical devices tested if none available.

## Deployment failure instructions
If Vercel or Cloudflare accounts aren't authenticated/authorized: prepare config, run builds and local staging suite, provide exact user commands and the minimal credentials/permissions needed; never invent a URL. If Durable Object CPU/memory/cost benchmarks fail: honor documented alternative to a long-running stateful game server and continue to deploy client to Vercel; never move physics to unauthenticated clients for ease of hosting.

## Acceptance
G13 with evidence; G04 G12 plus security / browser robustness. Deployment is NOT complete until both player URLs communicate through a real hosted authoritative match.
