# STEP-BY-STEP EXECUTION MAP (prompts and detailed work packages)

This file is the actionable sequence for Claude Code. Execute the top-level phase prompt AND its deep-dive companions in the order listed. Never bypass red gate results.

## Stage I — Working game first (P0)
| Step | Main prompt | Deep-dive companion(s) | Output |
|---|---|---|---|
| 1 | prompts/01-ARCHITECTURE-SPIKE.md | deep-dives/D01-REPOSITORY-CONTRACTS.md | Monorepo, verified WASM-in-Worker spike, rendering foundation |
| 2 | prompts/02-VERTICAL-SLICE.md | deep-dives/D02-CORE-ARENA-CAMERA.md | Two local-player end-to-end match, cinematic starter arena |
| 3 | prompts/03-REALTIME-MULTIPLAYER.md | deep-dives/D03-ROOM-AUTHORITY.md | Real two-device synchronized authoritative match |
| 4 | prompts/04-MATTER-ENERGY.md | deep-dives/D04-ELEMENT-REACTIONS.md | Forces/material reaction mechanics tested in real matches |

**P0 milestone: two independently controlled people can score a physics-driven match, on actual network transport, without camera, on desktop/touch.**

## Stage II — Magic controls and visual production (P1)
| Step | Main prompt | Deep-dive companion(s) | Output |
|---|---|---|---|
| 5 | prompts/05-CAMERA-GESTURES.md | deep-dives/D05-GESTURE-STATE-MACHINES.md | Reliable calibrated local hand/pose control |
| 6 | prompts/06-MOBILE-CONTROLS.md | deep-dives/D06-SENSOR-FUSION.md | iOS/Android touch/motion/stand modes, no permission dead ends |
| 7A | prompts/07-AAA-VISUALS.md | deep-dives/D07-ENVIRONMENT-ART.md | Production environment topology, models, PBR materials |
| 7B | prompts/07-AAA-VISUALS.md | deep-dives/D08-LIGHTING-ATMOSPHERE.md | Filmic lighting, cloud horizon, shadows and effects tiers |
| 7C | prompts/07-AAA-VISUALS.md | deep-dives/D09-CORE-ELEMENTAL-VFX.md | Eight causal elemental shaders and collision-linked feedback |
| 7D | prompts/07-AAA-VISUALS.md | deep-dives/D10-CHARACTERS-IK.md | Two credible reacting animated original wielders |
| 7E | prompts/07-AAA-VISUALS.md | deep-dives/D11-VISUAL-REVIEW-LOOP.md | 6 golden screenshots, measured critique, revisions |

**P1 milestone: a compelling hero screenshot AND a played match captured from the actual game, with premium-quality 3D visuals and live camera controls.**

## Stage III — Release experience (P1/P2)
| Step | Main prompt | Deep-dive companion(s) | Output |
|---|---|---|---|
| 8 | prompts/08-MODES-BALANCE.md | deep-dives/D12-SKILL-REPLAYABILITY.md | Strategies, combos, balance, training challenges |
| 9 | prompts/09-UX-AUDIO.md | deep-dives/D13-FEEDBACK-UX-AUDIO.md | Finished menus, lobby, tutorials, sound and response |
| 10 | prompts/10-SOLO-AI.md | deep-dives/D14-SOLO-BOT.md | Practice and realistic opponent with legal actions |
| 11 | prompts/11-PERF-QA-SECURITY.md | deep-dives/D15-PERFORMANCE-DEVICE-LAB.md | Instrumented device matrix and network red-team tests |
| 12 | prompts/12-DEPLOY-OPERATIONS.md | deep-dives/D16-RELEASE-PIPELINE.md | Tested Vercel client + authoritative hosted rooms |
| 13 | prompts/13-FINAL-REVIEW.md | all deep-dives’ acceptance evidence | Independent audit, defects, evidence, launch verdict |

## Policy for each substep
- Read main prompt, companion, docs/GAME_DESIGN.md, docs/CREATIVE_TARGET.md, docs/ARCHITECTURE.md, docs/ACCEPTANCE.md.
- Output actual implementation; record tests and screenshots. Never write a second planning document as substitute for code.
- Maintain "main" green as much as practical. Commit coherent steps and update docs/progress/STEP-N.md.
- Enforce a *red gate*: core round trip, scored match, physics equivalence, accessible touch, no footage upload, no fabricated cloud resources.
- If absent credentials/hardware prevent a cloud or phone action, fully implement all code that can be tested locally, record blocker unambiguously and continue only with tasks that don't conceal it.
- For graphics, repeat art critique and phone benchmark until rubric passes or list specific gaps; don't consider adding effects alone sufficient.

## Necessary cloud permissions
Vercel project create/deploy and domain optional; Cloudflare Workers + Durable Objects authorizations and secrets. Unless authenticated deployments are actually executed, production status remains NOT DEPLOYED. Do not ask user to paste secrets in a chat or repo.

## Architecture decisions to re-open on evidence
- CF Durable Object sustained Rapier load failure -> consider dedicated always-on authoritative game server.
- MediaPipe blocking main thread -> move inference to Web Worker/frame transfer or reduce inference FPS.
- WebGPU new API/platform instability -> production WebGL2 fallback; don't require latest alpha packages just for advanced shaders.
- 3D avatars too expensive -> bake animation or use animated stylized constructs, but keep distinct intentional silhouette quality.
