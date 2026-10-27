# ADR-0009 — Continuous physical manipulation is the core interaction

- **Status:** Accepted (product direction from the owner, October 2026). Implementation is
  milestone **06M** in docs/BUILD_STATUS.md; Phase 07 art (7B onward) resumes after it.
- **Supersedes:** the "discrete gesture → spell" emphasis of ADR-0007 §3 for camera play. The
  pipeline, privacy and tracking decisions of ADR-0007 stand.

## Context

The owner's direction: *development should first demonstrate that real people can intuitively
bend physical objects with their hands; only then should Phase 07 make the arena visually
extraordinary.* And: *the biggest improvement to the original design is continuous physical
manipulation rather than relying primarily on discrete gesture-triggered spells* — that is where
FRACTURE FIELD can differ from conventional elemental combat games.

As built through Phase 06, a hand moves a force point continuously, but everything that touches
a body is a discrete command recognised from a sign: a palm push fires PULSE, a held fist starts
LIFT, a stroke fires SWEEP. The player learns a vocabulary of signs and the game replays canned
impulses. Nothing the hand does *between* signs reaches the physics, so the hand never feels like
it is holding, pushing or throwing anything.

## Decision

### 1. One continuous hand channel on every input

Every input adapter reports, every input frame, a **hand state** alongside the aim it already
sends:

| Field | Range | Meaning |
|---|---|---|
| `aim` | arena [−1, 1]² | where the hand is over the field (unchanged) |
| `grip` | 0 … 1 | how closed the hand is (open palm 0, fist 1) |
| `push` | −1 … 1 | rate of moving toward the screen (+) or back (−) |
| `twist` | −1 … 1 | wrist roll from the calibrated neutral |

It rides on the existing `aim` intents (the stream that already flows at input rate), so there
is no new message type, no new rate limit and nothing camera-specific: the camera, a mouse, a
touch screen, a gamepad and a tilted phone all produce the same four numbers (§4). The
authority keeps the latest state per seat and decays it to "open, still" when it goes stale
(300 ms), so a lost connection or a lost hand can never leave a body gripped.

### 2. The authority turns the hand into forces — continuously, bounded, deterministic

Each fixed tick, from the server-side manipulator (which already moves toward `aim` at a capped
speed, so its velocity is known to the authority, never reported by the client):

- **Grip → hold.** Closing the hand near a movable body (within reach, the core preferred)
  grips it; the grip is a spring–damper from the body to the manipulator whose stiffness follows
  `grip` continuously (a light grip lags and sways, a fist carries firmly). Opening the hand
  releases with whatever velocity the body has: **throwing is not an ability, it is letting go
  of something you are swinging.** Engage/release use hysteresis (≥ 0.6 / ≤ 0.35) so a noisy
  half-closed hand does not flicker.
- **Twist → spin → curve.** Rolling the wrist while gripping spins the body about the vertical;
  a spinning core moving across the field curves (a bounded Magnus-like side force that decays
  with spin) — bend-it shots around a pillar come from the wrist, not a menu.
- **Open hand → drag the medium.** An open hand moving through the field drags nearby bodies
  toward its own velocity (falloff with distance, like moving your hand through water): a slow
  pass nudges, a fast swipe sweeps. SWEEP's effect becomes what any quick open-hand stroke does.
- **Push / pull.** Moving the open hand toward the screen presses bodies near the force point
  away along the view direction; drawing it back pulls them in. PULSE and DRAW become the strong
  and the gentle ends of one continuous motion.

Every force is an acceleration with a per-seat cap, scaled by mass the same way for every body,
and costs energy in proportion to the work it does (holding still is cheap, flinging is not).
Nothing is a teleport or a velocity override; two players' forces superpose under the same caps.
The authority validates and clamps every field (finite, in range, rate-limited with the aim
stream); a client can only describe a hand, never a force.

### 3. Discrete moves remain — as elements and as accessible shortcuts

GUARD, INFUSE/FREEZE/CHARGE and the advanced moves stay discrete (they create or transform
matter, which a sign expresses well). PULSE, LIFT and SWEEP remain as buttons/signs for
keyboard, touch and simplified play, and are equivalent to short scripted hand motions through
the same force model, so no input method gains power over another.

### 4. Input mapping

| Input | grip | push | twist |
|---|---|---|---|
| Camera | finger closure (calibrated open → fist) | palm approach rate (filtered d log size) | knuckle-line roll vs neutral |
| Mouse | button held (ramped) | wheel | wheel while gripping (shift) |
| Touch | finger held on the field near a body | — (flick = fast open-hand stroke) | two-finger rotate |
| Gamepad | right trigger (analog) | left trigger / stick click | right stick x |
| Handheld motion | thumb held | forward tilt rate | device roll rate |

### 5. Proving it with people, not with claims

"Intuitive" is a property of people, so it is validated with people:

- A **Hands Lab** (`/lab/hands`): a small authoritative sandbox (core, boulders, rings, a gate,
  a pillar) with four timed tasks — *place*, *throw*, *curve*, *clear* — success judged by the
  authority, results kept only on the device (exportable JSON). It works with every input above,
  so camera play can be compared with mouse and touch on the same tasks.
- A **study protocol** (docs/progress/PHASE-06M.md): 5–8 first-time participants, no
  instructions beyond "use your hand", completion rate and time per task, first-success attempt
  count, and a short questionnaire. Until it has been run by the owner or testers, the repository
  claims only what synthetic tests and this container verified.
- **Synthetic tests** in this repository: landmark sequences (opening/closing, wrist roll,
  approach, tremor, dropout) produce the expected hand state; hand-state sequences produce the
  expected physics (a swing-and-release throws, a twist curves, an open stroke transfers momentum
  in proportion to hand speed, caps and energy hold, results are deterministic).

## Consequences

- Camera play stops being a sign vocabulary; the hand's whole motion matters. The gesture state
  machines remain for the discrete moves and as the fallback scheme.
- The simulation gains a per-seat hand state and three continuous fields; snapshots gain the
  grip target and spin so clients can show what is held and how it will curve.
- The bot keeps using discrete moves until it is taught to swing and throw (Phase 10).
- Phase 07 art resumes after 06M. 7B's code (lighting, atmosphere, adaptive quality, the cheaper
  low tier) is kept; its gate is not passed until its captures and critique are done.
