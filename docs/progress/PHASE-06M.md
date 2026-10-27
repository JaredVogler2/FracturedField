# MILESTONE 06M — Continuous physical manipulation

**Status: IN PROGRESS — M1 (authority) done; the M2 camera mapper and the M3 task judge are
built and tested; their client integration (input adapters, the Hands Lab page) is next.**

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

### M1 — authority (done)

- **Protocol** (`@ff/protocol`, PROTOCOL 3, SIM 3): `HandState` (`grip` 0–1, `push` and `twist`
  −1–1) on `aim` intents, validated by the schema and clamped again by the authority; a `grip`
  event (start / end with the body's velocity); `grasp` in each player snapshot; the core's
  deliberate spin `s` in its entity snapshot.
- **Tuning** (`@ff/game-data → DEFAULT_RULES.hand`): engage 0.6 / release 0.35, reach 3.2 m,
  stiffness 6–40 s⁻² with damping ratio 0.7 and velocity matching, hold height 2.2 m, accelerations
  capped (hold 40, sweep 30, push 40 m/s², all inside the per-body field cap), 0.3 s stale hand,
  0.2 s regrip, spin 14 rad/s, Magnus 0.05 capped at 4 m/s², energy 4/s holding plus 0.6 per
  m/s of Δv given (a full swing-and-throw costs about a PULSE).
- **Simulation** (`@ff/sim → GameWorld`, tick step 4): grip engages on the nearest movable body
  in reach (the core favoured; never the core under the kickoff shield; not without energy for a
  quarter second of holding); the hold is a spring–damper to the force point that matches the
  hand's velocity, stiffer the more the hand is closed; opening lets go with the body's own
  velocity; twisting spins the held body and gives the core its curving spin; an open moving
  hand drags bodies only where it moves faster than they do; push / pull press away from or draw
  toward the hand. A stale hand, a disconnect, a pause, a goal or a reset lets go. A PULSE or a
  LIFT by the same player takes over from the grip.
- **Only a described hand acts.** A seat whose input describes no hand (keys, touch without
  hands-on, the bot) moves a force point, never a hand: it neither sweeps nor pushes. (Found
  while building M3: as first written, a seat without a hand channel counted as an open hand, so
  a keyboard force point rushing past the resting core dragged it to 7.75 m/s.)
- **The hand's velocity is smoothed** (`velocitySmoothing` 0.12 s) before a stroke or a carry
  follows it, and a stroke fades in from 1.5 to 3 m/s instead of kicking in at the threshold: a
  15 fps camera's tracking jitter on a hand held still otherwise read as strokes and walked a
  resting core out of the ring (seen in a browser trace: 3.4 m in 10 s).
- **Tests** (`packages/sim/test/hand.test.ts`, 12): grip engages above 0.6 (not at 0.5), carries
  the core to the hold height on the hand; swinging −8 → −2 m and opening throws the core along
  +x at > 5 m/s and ≤ 1.35 × the hand's top speed; a light grip (0.5) tracks a swaying hand ≥ 1.8×
  more loosely than a fist; hysteresis and the regrip delay; no grip out of reach or through the
  kickoff shield; a stale hand and a disconnect let go; a clockwise twist curves the thrown core
  to the right of its motion and an anticlockwise one to the left, symmetrically, within the cap,
  and the spin decays; an open hand sweeping past drags the core along its motion, more the
  faster it moves, never faster than the hand; push drives the core away, pull draws it in, the
  dead zone does nothing, both cost energy; holding still costs ≈ 4/s, a full throw 3–25 energy;
  running out of energy lets go; NaN / ±Infinity / ±1e308 hand values never reach the state;
  the same hand log gives the same state hash, and a checkpoint taken mid-grip continues
  identically. Plus (14 now): a force point with no hand channel rushing past at 12 m/s leaves the
  core at rest (< 0.05 m/s; it was 7.75 before the fix), and an open hand held still with ±6 cm
  of camera-like jitter for 5 s leaves a resting core within 0.1 m (it walked 1.14 m before).
- **Discrete play unchanged:** the D04 golden fixtures and the 100-tick physics golden hash
  exactly as before (hand state enters the state hash only when present).

### M2 — inputs (camera, mouse, touch and gamepad built; handheld motion not yet)

- **Camera mapper** (`@ff/gestures → ContinuousMapper`, pure, clocked by frame timestamps): grip
  from each finger's bend between the open palm and the fist (median of 3, 45 ms smoothing);
  push from the least-squares slope of the median-of-3 log palm size over ≥ 0.3 s and ≥ 5
  frames, less a 0.2 s⁻¹ jitter floor; twist from the knuckle line's image angle, zeroed on how
  the hand was held when it was first seen (or a calibrated neutral), less 4° of tremor, over
  50°. The gesture engine now reports the locked hand's features and knuckle angle.
- **Intent emitter** (`@ff/controls`): the hand rides on aim intents — clamped, sent on change,
  re-sent every 100 ms while an input describes one, open and still included (the authority's
  stale time is 300 ms, and only a present hand sweeps); when an input stops describing a hand an
  open hand is sent once, so whatever it held is let go at once.
- **Adapters** (`apps/web/src/input`), active when the seat is hands-on (the Hands Lab, the
  `handsOn` control setting, or `?hands=1`); only the device that owns the aim describes the
  hand, and a change of device lets go:
  - *camera* (`CameraController`): every tracked frame feeds the mapper; while an element or pick
    sign is shown the grip reads 0; fist holds, palm pushes and strokes no longer fire LIFT /
    PULSE / SWEEP (gripping, pushing and sweeping are the hand's own motion); pausing or losing
    the camera opens the hand;
  - *mouse*: the left button closes the hand (ramped at 10/s); the wheel pushes / pulls with an
    open hand (a rate: it eases back) and, while holding, turns the grip — which stays turned,
    like a knob, until the hand opens (a first trace showed a twist that eased back within half
    a second left a thrown core almost spinless); right button PULSE, middle GUARD;
  - *touch*: a finger that lands within 1.8 m of a body holds it until lifted; on open floor it
    is an open hand; a second finger turning around the first twists (60° = full);
  - *gamepad*: RT is an analog grip (it no longer PULSEs; A does), the right stick twists (x) and
    pushes / pulls (y);
  - *handheld motion*: not yet (ADR-0009 §4 row unbuilt).
- **Tests** (`packages/gestures/test/continuous.test.ts` 12, `packages/controls` +1): open → fist
  → open ramps grip through the engage and release grips at 30 / 15 / 8 fps; a relaxed,
  trembling hand stays well below the engage grip; an approach pushes (> 0.5), drawing back
  pulls, holding still settles inside the dead zone; at typical jitter < 5 % of still frames pass
  the push dead zone (at double jitter < 15 %, and weakly); a clockwise turn reads positive for
  either hand anywhere in the frame; a lost hand reads open at once and re-zeroes its twist on
  return; tremor stays inside the twist dead zone. Adapters: the camera mapper's thresholds equal
  the authority's; closing, pushing and turning a tracked hand become the seat's hand with no LIFT
  or PULSE fired; a thumbs-up never grips and still casts HEAT; pausing opens the hand; the mouse
  button grips and the wheel turns the grip, which stays turned until the hand opens; a touch
  whose pointer can no longer be captured still aims; a finger landing on a body holds it, one on
  open floor does not; turned off, a seat opens its hand once and then sends none; the pad's
  trigger and right stick map to grip, twist and push, it takes the seat over, and pausing or
  unplugging opens the hand.

### M3 — Hands Lab (built; browser evidence below)

- **Task judge** (`apps/web/src/lab/hands-tasks.ts`, pure): *place*, *throw*, *curve* and *clear*
  judged only from authoritative snapshots and events, on the authority's clock (snapshot
  ticks), so a slow or stalling page measures the same as a fast one. A try begins on the first
  frame that shows the task's bodies where it starts (frames from before the setup are ignored).
  A throw is a goal scored while the core is still flying from the release — let go at ≥ 3 m/s,
  not gripped or come to rest since — however long the flight; a curve is such a goal whose free
  flight bent ≥ 12° before any bounce. Tests (7): a gentle placement versus rolling through;
  stale frames from before the setup never judged; a long throw counts, a set-down then nudged
  in or a throw that came to rest does not; a bent flight versus a straight one (a bounce ends
  the measurement); a boulder swept out versus carried out, and the other boulder never judged.
- **Page** (`/lab/hands`, or `?mode=lab`): a local authority with `LAB_RULES` (an endless round,
  no kickoff push, no idle drift; holding and work cost no energy — the lab measures handling,
  not energy management). Its start screen says one sentence (*"Use your hand to move things"*)
  and offers every input; tabs for the four tasks (a task's setup lets go of anything held and
  puts its bodies at rest); a "what the game sees" panel (grip, push, twist, the body held, the
  input and the camera's tracking state); results (task, tries, seconds to first success,
  seconds the camera lost the hand, input, time) kept in this browser's storage and exported as
  JSON only on request; the ring and the lane drawn on the field; no scoreboard.
- **Browser tests** (`e2e/phase06m.spec.ts`, local SwiftShader, authority at half speed — test
  runs only): a mouse player completes *place*, *throw*, *curve* (one wheel notch turns the grip)
  and *clear* (open-hand strokes), and the export holds exactly `id, attempts, seconds,
  lostSeconds, input, at` per task — 1.5 min; a synthetic camera hand (landmarks through the real
  gesture engine, mapper and camera controller) completes all four — 1.1 min. The players are
  closed loops (they time a release by the core's position, and the camera player nudges its aim
  by eye over the ring), standing in for a person, not measuring one. Building them exposed and
  fixed: the authority's sweep without a hand (M1 above), camera jitter read as strokes, a mouse
  twist that faded before the throw, a judge clocked by the page instead of the authority, and a
  try judged from frames before its setup.
- **Not covered:** a touch or gamepad player completing the tasks in the browser (their adapters
  have unit tests only), and the people study.
