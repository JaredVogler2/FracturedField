# MILESTONE 06M — Continuous physical manipulation

**Status: IN PROGRESS — M1 (authority), M2 (inputs: camera, mouse, touch, gamepad), M3 (the Hands
Lab) and M4 (match integration) are built and tested in this container (synthetic hands and
scripted players, software rendering); the people study — the milestone's real gate — has not
been run.**

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
  capped (hold 40, sweep 30, push 40 m/s², all inside the per-body field cap), 0.6 s stale hand,
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
  stale time is 600 ms, and only a present hand sweeps); when an input stops describing a hand an
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

### M4 — match integration (built; local evidence)

- **Camera control is hands-on by default** (setting `controls.cameraScheme`, default `hands`;
  `signs` keeps the sign vocabulary). The mouse, touch and a controller play hands-on when chosen
  (`controls.handsOn`); Settings → *Hands* sets both, and `?hands=1` / `?hands=0` overrides them
  for one page. In the hands scheme the camera's practice step asks for a closed and then an
  opened hand — measured against the authority's own grip thresholds — instead of PULSE, and
  the gesture reference lists what the hand does (hold, throw, spin, sweep, press) before the
  signs that remain (GUARD, WET, HEAT, the picks).
- **On-field feedback**, drawn from authoritative snapshots only: a team-coloured tether from a
  player's force point to the body their hand holds and a clasp around it; a swirl around the
  core while it carries a deliberate spin (it turns the way the core does, so it says which way
  the shot will bend); the local reticle tightens and brightens as the hand closes and widens
  with a push.
- **Online:** the room client copied only the intent fields it knew and dropped the hand — the
  channel never reached the room. Fixed; a network test (two clients through the real room
  authority over simulated links) grips the core with a hand kept alive at 60 ms and both
  clients see the grip; it fails without the fix.
- **Browser tests** (`e2e/phase06m-match.spec.ts`, local SwiftShader): a camera player, hands-on
  by default, scores against the bot by gripping, swinging and letting go — no sign or move
  sent, only aims carrying the hand. In its final form it scored in 3 of 3 runs (0.5–1.1 min,
  local authority at half speed), each time with one held throw down the middle at 13–21 m/s;
  in two runs an earlier swing had already lost its grip before the let-go, and the core stayed
  back. Earlier forms of the player failed: they stopped after too few tries, and let go past
  the reach limit from off-centre spots. They were fixed in the player (a time budget; a carry
  to a set-up spot first), not in the rules. Online, both seats hands-on with the mouse grip
  the core in turn through the room, both devices see each grip, and the room refuses no intent
  (1.4 min; it plays the standard match clock, see *CI on PR #3*). The camera tests of the sign
  scheme now select it explicitly (`hands=0`); the settings test covers the *Hands* group.
- **Not yet:** the bot still plays with discrete moves (Phase 10); the handheld-motion mapping;
  a touch or gamepad player in a match in the browser; anything on a physical device; the
  people study.


### CI on PR #3 (slower runners)

The browser job runs on slower machines than this container. Hands tests failed there in two
rounds, and each failure was reproduced here with the page's CPU throttled
(`E2E_CPU_THROTTLE=N`, `e2e/throttle.ts`):

- `3c1d5a8`: the online grip never held, and the Hands Lab's scripted mouse throw came out at
  3.7 m/s. The authority dropped a hand after 0.3 s without an update and a throttled page drew
  a frame every ~0.45 s, so every grip let go between frames — as a render hitch or a burst of
  network jitter would for a person. Fixed in `51b79c7`: the stale time is 0.6 s (a unit test
  with updates 0.45 s apart fails at 0.3 s), the online test reaches in with a closed hand, and
  the lab's scripted strokes keep their play speed.
- `51b79c7`: the online test's second carry stopped at x = 3.75 m (needed > 4). The room's match
  had ended mid-carry: the test played the short test rounds (25 s, two to win) and on a slow
  runner took longer than the whole match, so the authority let go of every grip and stopped
  (reproduced at 3× throttle: 3.74 m, `match_end` in the room's log). Throttled runs then showed
  two more weaknesses of the scripted mouse player, both in the test:
  - Its hand closed first and then travelled to the core (the `51b79c7` change), so it took the
    first body that came within reach on the way — a boulder — dragged it along and took it again
    on every retry, spending its energy; under the short rounds a mid-test round reset had been
    refilling that energy. It now reaches as a person does: with energy for a hold, the open hand
    goes over the core (quickly most of the way, 0.2 m at a time at the end, too slow to drag
    anything) and closes on top of it.
  - The room's clock runs in real time, so a slow enough machine outlasts any round. The test
    plays the standard clock (90 s rounds plus the golden rift; no goal is scored in it), and a
    step that a round end interrupts (every grip let go, the core back at the centre) starts over
    in the next round; any other failure fails the test. Its two pages use small canvases
    (640 × 360), which keep their frames well inside the stale time (0.23–0.35 s at 3× throttle
    here).

  After the fix the test passed 3 of 3 runs here (2.8 and 3.0 min at 3× throttle, 2.3 min at
  normal speed).
- `d150d2d`: the hands tests passed, but six other online tests failed where the guest joins the
  room (`openRoom`: the guest's seat never arrived, or the lobby never opened). None had failed
  before Phase 7B. CPU throttling did not reproduce it; pinning the browser, the preview server
  and the room worker to two of this machine's four cores (`taskset -c 0,1`) did, on the first
  run. (CI's runner has four virtual CPUs; the browser job there behaved like this machine with
  two.) A probe of the guest page (`scripts/probe-join.mjs`: WebSocket and fetch events, long
  tasks) showed the cause: the guest received its WELCOME and lobby within 50 ms, then its page
  froze for 22 s (two long tasks of 7.5 and 14.4 s) while it built the match scene, and when it
  woke its room client closed the healthy socket itself as "connection stalled" (no message for
  15 s; a frozen page cannot send pings, so no pongs come back). A CPU profile put 48 of the
  guest's 69 s of main-thread time in three.js's first-use program check, waiting on software
  WebGL to compile and link 47 shader programs (about 1 s each on two cores). Joining replaces the
  menu's canvas with a new WebGL context, so every program compiles a second time. The client's
  deadlines (connect 8 s, stall 4 s live / 15 s idle) and the room API's 8 s request timeout
  counted the page's own freeze as network silence. That is a product defect, not only a test
  one: a phone compiling shaders can freeze too. Depending on where the freeze lands, the client
  either dropped a link that had just been welcomed, or abandoned a socket whose WELCOME was
  already queued behind the timer and then reconnected into the next freeze.

  The deadlines now count only time the page was awake: a heartbeat counts at most 1 s
  (`MAX_BEAT_MS`), and the room API's timeout counts at most 0.5 s per 0.25 s tick. A dead link
  is still found: every heartbeat counts. `client-freeze.test.ts` covers a WELCOME queued behind
  a 20 s freeze, a 22 s freeze after WELCOME, a link that stays silent while the page is awake
  (found dead after 15 s of awake silence, freeze or not) and the awake connect timeout; the
  first three fail on the previous client. `awake-deadline.test.ts` covers the request timeout.
  With only this fix, pinned to two cores, the six tests went from 0 of 6 joining to 3 of 6
  passing: the other three were seated but ran out of time later, behind more compile freezes.
  A probe of the programs a page links (`scripts/probe-programs.mjs`) showed why there were so
  many: 52 on the low tier, 17 of
  them a second time when the core appeared. The core's point light was mounted with the core's
  visual (when the first snapshot listed the core), and three.js compiles the number of point
  lights into every lit program, so every lit material compiled twice. The light is now mounted
  with the scene (`CoreLight` in `Entities.tsx`), follows the core and is dark while there is
  none: 40 programs, each compiled once. With both fixes, pinned to two cores, five of the six
  passed in one run. The sixth, leaving mid-match, did everything it checks and then ran out of
  its 120 s budget: over that test the guest builds its scene three times (menu, match, menu
  again), each a full compile. Its budget is now 180 s, as the refresh test's is; no assertion
  changed. It then passed (1.7 min).

  On four cores the full browser suite then passed 42 of 44. Both failures had also failed on
  `main`'s own last run (the PR #2 merge), and neither involves this change:
  - **Hands Lab, mouse:** the first task's core never reached its start. The lab placed the task
    50 ms after its panel appeared, but the sim worker drops a placement made before its world
    exists, which on a slow page is still the case when Start is pressed. Later tasks, started by
    hand once play runs, were never affected. The panel now starts a task once the snapshot shows
    the match playing. This is a product fix: on a slow device a player saw the same. Pinned to
    two cores the test then passed twice.
  - **The first online duel** lost a round on territory. Its host is a scripted mouse player that
    lines up behind the core within 1 m at 1.4 m (up to 35° off) and pulses from as far as 20 m,
    where a goal needs about 7°. Most of its shots rebound off the end wall, and a round without
    a goal goes to whichever half the core is in when the golden rift ends: a coin flip. A
    headless model of this duel (the real sim, the player's rule with its page delays, 30 matches
    each) has the host winning 2–0 in 27 of 30 matches on a busy page and 23 of 30 on a slower
    one. The fix is the next CI item: run this player inside the page, deciding every frame, as
    the touch and camera players already do.

  Joining still compiles every program a second time, because each match view creates its own
  WebGL context. Keeping one renderer across the menu and matches would remove that freeze too.
  That is a performance item for later (D15), not part of this fix.
