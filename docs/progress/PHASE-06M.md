# MILESTONE 06M — Continuous physical manipulation

**Status: IN PROGRESS — design accepted (ADR-0009); implementation starts with M1.**

Inserted by the owner's direction (October 2026) between Phase 06 and the rest of Phase 07:
*development should demonstrate that real people can intuitively bend physical objects with
their hands; then Phase 07 transforms the arena visually.* The core interaction becomes
continuous physical manipulation — grip, swing, throw, spin, sweep, push — instead of discrete
gesture-triggered spells. Design: docs/decisions/ADR-0009-continuous-manipulation.md.

Nothing in this milestone may weaken server authority: clients describe a hand (four bounded
numbers), the authority alone turns it into forces, under the same caps for every input method.

## Milestones and gates

| # | Scope | Gate (all automated unless stated) |
|---|---|---|
| M1 | **Authority.** Hand channel on `aim` intents (`grip`, `push`, `twist`), validated and clamped; per-seat hand state with 300 ms staleness decay; grip hold (continuous stiffness, hysteresis engage/release, release keeps velocity); open-hand coupling (bodies dragged toward the hand's velocity); push/pull pressure; twist spin and a bounded Magnus-like curve on the core; energy in proportion to work; snapshot fields for the gripped body and spin. | Sim tests: a swing-and-release throws the core along the swing at a speed bounded by the caps; a twist curves the core to the expected side and the curve decays; an open stroke transfers momentum in proportion to hand speed (and not through walls); a stale or lost hand releases; energy and per-seat caps hold for every input; deterministic replay; the D04 golden fixtures (discrete play) unchanged. |
| M2 | **Inputs.** Camera mapper (grip from calibrated finger closure, push from the filtered rate of apparent palm size, twist from the knuckle line's roll vs neutral); mouse, touch, gamepad and handheld-motion mappings (ADR-0009 §4). | Synthetic landmark suites: open → fist ramps grip monotonically with hysteresis; a wrist roll of ±45° maps to twist of the right sign and size and is invariant to hand position and mirroring; approach maps to push; tremor and noise at 30 / 15 / 8 fps stay below the engage threshold; dropout decays to open. Adapter unit tests for the other inputs. |
| M3 | **Hands Lab** (`/lab/hands`). A local authoritative sandbox (core, boulders, rings, a gate, a pillar) with four tasks — *place* (set the core down inside a ring), *throw* (through the gate), *curve* (around the pillar into the gate), *clear* (sweep a boulder out of a lane) — judged by the authority, timed, attempts counted, results kept on the device with a JSON export; a "what the game sees" panel (grip, push, twist, gripped body). Works with every input. | Browser tests: each task completed by a closed-loop synthetic camera hand and by mouse; the export contains only task metrics (no images, no landmarks). |
| M4 | **Match integration.** The camera scheme becomes hands-on (continuous) by default, the sign scheme stays selectable; on-field feedback for the hold (tether), spin and push; online play carries the hand channel; touch/mouse/gamepad gain grip-and-throw. | Browser tests: a camera player scores by gripping and throwing; an online match with both seats hands-on; the existing Phase 02–06 suites stay green. |
| Study | **People.** The protocol below, run by the owner or testers on their own devices. | Not automatable. Until it is run, this repository claims only what its tests show. |

## People study protocol (to be run by the owner / testers)

Goal: find out whether first-time players can manipulate objects with their hands without being
taught, and which mappings they find natural.

- **Participants:** 5–8 people who have not seen the game; mixed handedness; at least two on a
  phone front camera and two on a laptop webcam; ordinary indoor lighting.
- **Setup:** open `/lab/hands` (needs HTTPS or localhost), allow the camera, skip or run the
  20-second calibration as the participant chooses. Say only: *"Use your hand to move things.
  Try each task."* No demonstration.
- **Tasks:** place, throw, curve, clear — up to 2 minutes each, in that order, then once more in
  any order the participant likes.
- **Record (the lab records these on the device):** completion yes/no, time to first success,
  attempts before it, tracking-loss events. **Observe:** what people try first (open-palm pushes?
  grabbing?), what confuses them, fatigue.
- **Ask afterwards (1–5):** "It felt like I was holding things", "The objects did what I expected",
  "I could aim where I wanted", "It was tiring" — plus one open question: *what did you expect to
  happen that did not?*
- **Success bar for "intuitive":** ≥ 80 % complete *place* and *throw* within 2 minutes on the
  first try, median "felt like holding" ≥ 4, no task that more than half fail. Results go into
  this file with the date and device list.
- **Privacy:** no video, images or landmarks are recorded or uploaded; the lab's export holds only
  task metrics.

## Evidence so far

- ADR-0009 (design) — this commit. Implementation evidence is added per milestone above.
