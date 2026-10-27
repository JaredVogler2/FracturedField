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
import { debug, openRoom, project, readyUp, snapshot, type Snap } from './helpers';

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
 * Grips the core with the mouse the way a person reaches for it: the hand closes first and then
 * moves onto the core, so it takes hold on arrival (within reach) instead of knocking the core
 * away — an open hand moving fast is a stroke. If the core slipped away meanwhile (it may still be
 * rolling) or the hand closed on something else, it opens and reaches again. Then waits until
 * every device sees seat `slot` holding the core.
 */
async function mouseGrip(p: Page, slot: 0 | 1, others: Page[]) {
  const id = coreOf((await snapshot(p))!).id;
  const grasp = async (q: Page) => (await snapshot(q))!.players[slot]!.grasp;
  for (let attempt = 0; attempt < 6 && (await grasp(p)) !== id; attempt++) {
    await p.mouse.down();
    const c = coreOf((await snapshot(p))!);
    const at = (await project(p, c.p[0], 1.1, c.p[2]))!;
    await p.mouse.move(at.x, at.y, { steps: 4 });
    const held = await expect
      .poll(() => grasp(p), { timeout: 8_000 })
      .toBe(id)
      .then(
        () => true,
        () => false,
      );
    if (!held) await p.mouse.up();
  }
  // The room's authority grips it, and every device sees the grip.
  for (const q of [p, ...others]) await expect.poll(() => grasp(q), { timeout: 10_000 }).toBe(id);
  return id;
}

/** Carries what seat `p` holds to (x, z) in `steps`, button held. */
async function mouseCarryTo(p: Page, x: number, z: number, steps: number) {
  const c = coreOf((await snapshot(p))!);
  for (let i = 1; i <= steps; i++) {
    const at = (await project(
      p,
      c.p[0] + ((x - c.p[0]) * i) / steps,
      1.1,
      c.p[2] + ((z - c.p[2]) * i) / steps,
    ))!;
    await p.mouse.move(at.x, at.y);
    await p.waitForTimeout(150);
  }
}

test('online: both seats hands-on — each grips the core in turn, and both devices see it', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser, { query: '&hands=1' });
  await readyUp(a, b);
  const marks = { a: await debug(a, 'mark'), b: await debug(b, 'mark') };

  // Seat 0 grips the core and carries it to the midline, then opens the hand.
  const core = await mouseGrip(a, 0, [b]);
  await mouseCarryTo(a, 1.5, 0, 8);
  await expect
    .poll(async () => coreOf((await snapshot(b))!).p[0], { timeout: 15_000 })
    .toBeGreaterThan(-1);
  await a.mouse.up();
  for (const q of [a, b])
    await expect
      .poll(async () => (await snapshot(q))!.players[0]!.grasp, { timeout: 10_000 })
      .toBe(-1);

  // Seat 1 takes it: grips it on its own device and carries it back into its half.
  expect(await mouseGrip(b, 1, [a])).toBe(core);
  await mouseCarryTo(b, 6, 2, 8);
  await expect
    .poll(async () => coreOf((await snapshot(a))!).p[0], { timeout: 15_000 })
    .toBeGreaterThan(4);
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
