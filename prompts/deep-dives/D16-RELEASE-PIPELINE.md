# DEEP DIVE D16 — VERCEL + CLOUDFLARE PRODUCTION DEPLOYMENT, SMOKE TESTS & ROLLBACK

**Execute with Phase 12.** Deliver a publicly accessible Vercel frontend and genuine authoritative game rooms, following required auth scope and account access. Do not substitute fake links.

## Release plan
- Vercel Git integration for apps/web frontend where available, production branch main, preview branches independently; ensure correct monorepo root and install/build commands. Client build contains only public WSS URL and build ID; no auth signing secrets.
- Cloudflare Worker / Durable Objects for rooms, server-only token signer and binding secrets, environment-specific migrations/config, match TTL and room cleanup. Verify actual runtime limits for active 30Hz game loops; standby hibernation optional only.
- If benchmark disproved suitability of Workers, swap to documented always-on Node authoritative host. Avoid creating unapproved paid services. A game server cannot be simply assumed to run indefinitely in a Vercel stateless Function with shared in-memory state.
- Use secure HTTPS/WSS with appropriate allowed origins and host domain. No unauthenticated access to preexisting seat via room ID alone.

## Release readiness before prod
1. Fresh clone, pinned dependency install, typecheck/lint/unit/integration/build.
2. Run actual backend (staging), exercise two-client simulation with genuine WebSocket transport.
3. Publish Vercel preview and Cloudflare staging only with permitted credentials, verify protocol version compatibility, HTTPS secure context (camera/motion require it).
4. Reproduce real on-phone invitation and game round: host on cellular, guest on Wi-Fi, opposing actions, matching scores, lost connection rejoin, rematch.
5. On release create tested Vercel prod build, use project-approved Git integration/Deployment Checks or stage-then-promote in approved CLI process. Do not roll prod automatically if validations fail.
6. Check Worker/GPU errors and room billing assumptions, record live URLs, commit SHA, published build ID and device names. Copy-safe invite URL points to prod web.
7. Add rollback procedure for Vercel deployment and Worker code/migration compatibility, preserve room compatibility or terminate matches with explicit reason.
8. Monitor first full session telemetry anonymized: room created/joined, action acceptance/rejection, fps buckets if user opts in, server tick overrun, thrown exceptions, match ends. No camera images or biometrics.

## Cost forecast
In docs/OPERATIONS.md provide formula and estimates under actual provider pricing at release:
active room seconds × DO billable duration + request/messages + storage, Vercel bandwidth/assets, eventual egress. Note player-per-room 2, snapshot Hz and average payload, concurrent rooms scaling. Present example for 10, 100, 1,000 matches/day as ranges, cite current provider plan pricing; do not fabricate exact invoice. Add max active rooms and circuit breaker to avoid runaway spend.

## Optional newer alternative
Vercel WebSockets GA 2026-10-20 is a valid transport option, but functions need shared state coordination; simply broadcasting from one instance to another is not automatically a stateful authoritative game room. If reconsidering, explicitly verify duration/CPU affinity and server capacity, and benchmark architecture before migrating from one-room Durable Object.

## Operational runbook
Commands for dev, staging and prod deployments; environment matrix; health endpoints, inspect logs, suspected stuck room cleanup, preview/production protocol version, rollback and post-deploy smoke tests. Document required permissions but never print/paste tokens in repo.

## Gate
Real two-device end-to-end match over public HTTPS/WSS, not only a successful Vercel build. If credentials prevent deployment, report NOT DEPLOYED and leave a reproducible configured build.
