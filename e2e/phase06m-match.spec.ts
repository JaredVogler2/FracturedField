/**
 * Milestone 06M-M4 (ADR-0009) — continuous manipulation in real matches:
 *
 * 1. Camera control is hands-on by default: a player (a synthetic hand through the real gesture
 *    engine and camera controller) scores against the bot by gripping the core, swinging and
 *    letting go — no sign, no PULSE.
 * 2. Online, both seats play hands-on (mouse): each grips the core in turn through the room's
 *    authority, and both devices see every grip.
 *
 * The players are closed loops standing in for people (they watch the public snapshot); the local
 * authority runs at half speed in test 1 (test runs only) so the slow software-rendered page does
 * not decide the race.
 */
import { expect, test, type Page } from '@playwright/test';
import { cameraActive, drive, handFor, learnAim, type AimMap, type HandPose } from './camera';
import { debug, openRoom, projectAll, readyUp, snapshot, type Snap } from './helpers';

const coreOf = (s: Snap) => s.entities.find((e) => e.kind === 'core')!;

test('camera, hands-on by default: grip the core, swing, let go — and score against the bot', async ({
  page,
}) => {
  test.setTimeout(600_000);
  // A small canvas leaves the software-rendered page time to feed the camera controller.
  await page.setViewportSize({ width: 640, height: 360 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mode=bot&difficulty=easy&fast=1&test=1&quality=low&seed=12&timescale=0.5');
  await page.getByTestId('controls-camera').click();
  await cameraActive(page);
  await page.getByTestId('start-match').click();
  const playing = () =>
    expect
      .poll(async () => (await snapshot(page))?.match.phase, { timeout: 60_000 })
      .toBe('playing');
  await playing();
  const map: AimMap = await learnAim(page);
  const hand = (x: number, z: number, pose: Omit<HandPose, 'cx' | 'cy'>) => {
    const [cx, cy] = handFor(map, x, z);
    return drive(page, { size: 0.15, ...pose, cx, cy });
  };
  const scored = (s: Snap) => s.match.score[0] > 0 || s.match.roundWins[0] > 0;

  // A time budget (the bot may keep the core on its side for a while); only throws are counted.
  const deadline = Date.now() + 300_000;
  let throws = 0;
  /** One line per throw: where it was let go, how fast, and what became of it. */
  const report: string[] = [];
  while (Date.now() < deadline && throws < 12) {
    const s = (await snapshot(page))!;
    if (scored(s)) break;
    if (s.match.phase === 'matchEnd') {
      await page.getByTestId('rematch').click();
      await playing();
      continue;
    }
    const c = coreOf(s);
    // A core on this side of the field and not racing away (under the kickoff shield a closed
    // hand just waits: the grip engages once the shield is down).
    if (s.match.phase !== 'playing' || c.p[0] > 1 || Math.hypot(c.v[0], c.v[2]) > 4) {
      await page.waitForTimeout(400);
      continue;
    }
    // An open hand over the core, then a fist: the authority grips it.
    await hand(c.p[0], c.p[2], { shape: 'open' });
    await page.waitForTimeout(700);
    await hand(c.p[0], c.p[2], { shape: 'fist' });
    const held = await expect
      .poll(async () => (await snapshot(page))!.players[0]!.grasp, { timeout: 4_000 })
      .toBe(c.id)
      .then(
        () => true,
        () => false,
      );
    if (!held) {
      await hand(c.p[0], c.p[2], { shape: 'open' });
      continue;
    }
    // Bring it to a good spot first, as a person would — back near our own goal, on the
    // middle line, out of the rival's reach — then swing down the middle toward the rival gate
    // in a few frames and let go mid-swing (timed by watching the core, as by eye).
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      await hand(c.p[0] + ((-14 - c.p[0]) * i) / steps, c.p[2] + ((0 - c.p[2]) * i) / steps, {
        shape: 'fist',
      });
      await page.waitForTimeout(250);
    }
    const ready = await expect
      .poll(
        async () => {
          const t = (await snapshot(page))!;
          const k = coreOf(t);
          return t.players[0]!.grasp === k.id && k.p[0] < -12 && Math.abs(k.p[2]) < 1.5;
        },
        { timeout: 8_000 },
      )
      .toBe(true)
      .then(
        () => true,
        () => false,
      );
    if (!ready) {
      await hand(-14, 0, { shape: 'open' });
      continue;
    }
    for (let i = 1; i <= 4; i++) {
      await hand(-14 + (16 * i) / 4, 0, { shape: 'fist' });
      await page.waitForTimeout(120);
    }
    await expect
      .poll(async () => coreOf((await snapshot(page))!).p[0], { timeout: 6_000, intervals: [30] })
      .toBeGreaterThan(-4)
      .catch(() => undefined);
    await hand(2, 0, { shape: 'open' });
    throws++;
    const r = (await snapshot(page))!;
    const rc = coreOf(r);
    const line = `throw ${throws}: from (${rc.p[0].toFixed(1)}, ${rc.p[2].toFixed(1)}) at (${rc.v[0].toFixed(1)}, ${rc.v[2].toFixed(1)}) m/s, held ${r.players[0]!.grasp === rc.id}, rival hand at (${r.players[1]!.m.map((v) => v.toFixed(1)).join(', ')})`;
    // Watch the throw: a goal, or the core slowing down.
    await expect
      .poll(
        async () => {
          const t = (await snapshot(page))!;
          return scored(t) || t.match.phase !== 'playing' || Math.abs(coreOf(t).v[0]) < 1;
        },
        { timeout: 12_000 },
      )
      .toBe(true)
      .catch(() => undefined);
    const o = (await snapshot(page))!;
    const oc = coreOf(o);
    report.push(
      `${line} → ${scored(o) ? 'GOAL' : `${o.match.phase}, core at (${oc.p[0].toFixed(1)}, ${oc.p[2].toFixed(1)}) moving (${oc.v[0].toFixed(1)}, ${oc.v[2].toFixed(1)})`}`,
    );
  }
  const end = (await snapshot(page))!;
  console.log(`camera hands-on: scored after ${throws} throw(s)\n${report.join('\n')}`);
  expect(scored(end), 'the camera player scored by grip-and-throw').toBe(true);
  // Nothing but the hand: no sign or move was sent, only aims carrying the hand.
  const sent = (await debug(page, 'intents')) ?? [];
  expect(sent.filter((i) => i.action !== 'aim').map((i) => i.action)).toEqual([]);
  expect(errors).toEqual([]);
});

/**
 * Where seat `slot`'s open hand goes next on its way to the core, read from the page in one round
 * trip: the whole way to `QUICK_M` short of the core at once, then `STEP_M` at a time — slow
 * enough that the hand drags nothing (an open hand moving fast is a stroke, and would knock the
 * core away). Null once the hand is over the core.
 */
const STEP_M = 0.2;
const QUICK_M = 3.5;
const OVER_M = 0.6;
const nextReach = (p: Page, slot: 0 | 1) =>
  p.evaluate(
    ([slot, step, quick, over]) => {
      const hook = (
        window as unknown as {
          __ffDebug: {
            snapshot(): Snap | null;
            project(x: number, y: number, z: number): { x: number; y: number } | null;
          };
        }
      ).__ffDebug;
      const s = hook.snapshot()!;
      const core = s.entities.find((e) => e.kind === 'core')!;
      const [mx, mz] = s.players[slot]!.m;
      const dx = core.p[0] - mx;
      const dz = core.p[2] - mz;
      const d = Math.hypot(dx, dz);
      if (d < over) return { d, at: null };
      const go = d > quick ? d - quick : step;
      return { d, at: hook.project(mx + (dx / d) * go, 1.1, mz + (dz / d) * go) };
    },
    [slot, STEP_M, QUICK_M, OVER_M] as const,
  );

/**
 * Grips the core with the mouse the way a person reaches for it: with energy for a hold (an open
 * hand recovers it) and the core within reach of this seat's half, the open hand goes over the
 * core — quickly most of the way, slowly at the end — and closes on top of it. A closed hand takes
 * the first body that comes within its reach, so it never closes on the way. If it took something
 * else, or the core slipped away, it opens and reaches again. Then waits until every device sees
 * seat `slot` holding the core.
 */
async function mouseGrip(p: Page, slot: 0 | 1, others: Page[]) {
  const id = coreOf((await snapshot(p))!).id;
  const seat = async (q: Page) => (await snapshot(q))!.players[slot]!;
  const side = slot === 0 ? 1 : -1;
  for (let attempt = 0; attempt < 6 && (await seat(p)).grasp !== id; attempt++) {
    await expect
      .poll(
        async () => {
          const s = (await snapshot(p))!;
          const c = coreOf(s);
          return (
            s.players[slot]!.energy >= 80 && side * c.p[0] < 4 && Math.hypot(c.v[0], c.v[2]) < 1.5
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    // Over the core; a hand held back by the midline stops short, still within reach.
    let last = Infinity;
    let stalled = 0;
    for (let i = 0; i < 80; i++) {
      const r = await nextReach(p, slot);
      if (!r.at) break;
      stalled = r.d > last - 0.05 ? stalled + 1 : 0;
      last = r.d;
      if (stalled >= 3 && r.d < 2.6) break;
      await p.mouse.move(r.at.x, r.at.y);
    }
    await p.mouse.down();
    const held = await expect
      .poll(async () => (await seat(p)).grasp, { timeout: 8_000 })
      .toBe(id)
      .then(
        () => true,
        () => false,
      );
    if (!held) await p.mouse.up();
  }
  // The room's authority grips it, and every device sees the grip.
  for (const q of [p, ...others])
    await expect.poll(async () => (await seat(q)).grasp, { timeout: 10_000 }).toBe(id);
  return id;
}

/**
 * Carries what seat `p` holds to (x, z) in `steps`, button held. The waypoints are projected in
 * one round trip, so the carry — and the hold's energy cost — does not grow with the page's
 * frame time.
 */
async function mouseCarryTo(p: Page, x: number, z: number, steps: number) {
  const c = coreOf((await snapshot(p))!);
  const path = await projectAll(
    p,
    Array.from({ length: steps }, (_, i): [number, number, number] => [
      c.p[0] + ((x - c.p[0]) * (i + 1)) / steps,
      1.1,
      c.p[2] + ((z - c.p[2]) * (i + 1)) / steps,
    ]),
  );
  for (const at of path) {
    await p.mouse.move(at!.x, at!.y);
    await p.waitForTimeout(150);
  }
}

/** The round in play, or null between rounds. */
const roundInPlay = async (p: Page) => {
  const s = (await snapshot(p))!;
  return s.match.phase === 'playing' ? s.match.round : null;
};

/**
 * Runs one hand-held step within a single round of play. The room's clock runs in real time, so
 * on a slow machine a round may end during a step — which lets go of every grip and puts the core
 * back at the centre; the step then lets go and starts over in the next round. Any other failure
 * fails the test.
 */
async function withinARound<T>(p: Page, step: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    await expect.poll(() => roundInPlay(p), { timeout: 60_000 }).not.toBeNull();
    const round = await roundInPlay(p);
    const result = await step().then(
      (v) => ({ v }),
      (e: unknown) => ({ e }),
    );
    if ((await roundInPlay(p)) === round) {
      if ('e' in result) throw result.e;
      return result.v;
    }
    await p.mouse.up();
    if (tries >= 2) throw new Error('a round ended during every try of this step');
  }
}

test('online: both seats hands-on — each grips the core in turn, and both devices see it', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  // Standard rules (90 s rounds plus the golden rift; no goal is scored here): the short test
  // rounds ended the whole match mid-carry on a slow runner. Small canvases: two
  // software-rendered pages share the machine, and a page drawing slower than the authority's
  // stale time (0.6 s) could not hold anything.
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser, {
    query: '&hands=1',
    fast: false,
    viewport: { width: 640, height: 360 },
  });
  await readyUp(a, b);
  const marks = { a: await debug(a, 'mark'), b: await debug(b, 'mark') };

  // Seat 0 grips the core and carries it to the midline, then opens the hand.
  const core = await withinARound(a, async () => {
    const id = await mouseGrip(a, 0, [b]);
    await mouseCarryTo(a, 1.5, 0, 8);
    await expect
      .poll(async () => coreOf((await snapshot(b))!).p[0], { timeout: 15_000 })
      .toBeGreaterThan(-1);
    return id;
  });
  await a.mouse.up();
  for (const q of [a, b])
    await expect
      .poll(async () => (await snapshot(q))!.players[0]!.grasp, { timeout: 10_000 })
      .toBe(-1);

  // Seat 1 takes it: grips it on its own device and carries it back into its half.
  const taken = await withinARound(b, async () => {
    const id = await mouseGrip(b, 1, [a]);
    await mouseCarryTo(b, 6, 2, 8);
    await expect
      .poll(async () => coreOf((await snapshot(a))!).p[0], { timeout: 15_000 })
      .toBeGreaterThan(4);
    return id;
  });
  expect(taken).toBe(core);
  await b.mouse.up();
  await expect
    .poll(async () => (await snapshot(a))!.players[1]!.grasp, { timeout: 10_000 })
    .toBe(-1);

  // Every intent was accepted by the room (the hand channel validates), none refused.
  for (const [p, m] of [
    [a, marks.a],
    [b, marks.b],
  ] as const) {
    const acks = ((await debug(p, 'acks')) ?? []).filter((x) => x.n > (m as number));
    expect(acks.filter((x) => !x.accepted)).toEqual([]);
  }
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
