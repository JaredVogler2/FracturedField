/**
 * Phase 07D (D10): the wielders' moves follow the authority's events. Every accepted PULSE cast
 * by a seat plays one throw on that seat's wielder and none on the other's; the bot's casts play
 * on the bot's wielder. Moves are counted by the scene (`__ffWielders`, test runs only) as they
 * start from the events the client releases, the same events the effects, sounds and the debug
 * cast log (`__ffDebug.casts`) take.
 */
import { expect, test, type Page } from '@playwright/test';

interface Cast {
  n: number;
  slot: number;
  ability: string;
  phase: string;
}
interface WielderInfo {
  slot: number;
  played: Record<string, number | undefined>;
  frameMs?: number;
  frames?: number;
}
interface Seen {
  casts: Cast[];
  wielders: WielderInfo[];
}

/** The cast log and the wielders' counters, read together (no event can land between). */
const seen = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as {
      __ffDebug?: { casts(): unknown[] };
      __ffWielders?: () => unknown[];
    };
    return { casts: w.__ffDebug?.casts() ?? [], wielders: w.__ffWielders?.() ?? [] };
  }) as Promise<Seen>;
const phase = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __ffDebug?: { snapshot(): { match: { phase: string } } | null } }
      ).__ffDebug?.snapshot()?.match.phase ?? null,
  );
const total = (w: WielderInfo) => Object.values(w.played).reduce<number>((a, n) => a + (n ?? 0), 0);

test('wielders: each seat’s casts play on its own wielder, one move per cast', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/?mode=bot&difficulty=hard&test=1&quality=low&hands=0');
  await page.getByTestId('start-match').click();
  await expect.poll(async () => (await seen(page)).wielders.length, { timeout: 60_000 }).toBe(2);
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('playing');

  // From here on: casts logged after this point against moves started after it.
  const start = await seen(page);
  const from = Math.max(0, ...start.casts.map((c) => c.n));
  const played0 = start.wielders.map((w) => ({ ...w.played }));

  // Seat 0 (this player) pulses on the keyboard until three casts are accepted; the bot (seat 1)
  // plays on its own.
  const mine = async () =>
    (await seen(page)).casts.filter((c) => c.n > from && c.slot === 0 && c.ability === 'pulse')
      .length;
  for (let i = 0; i < 40 && (await mine()) < 3; i++) {
    if ((await phase(page)) === 'playing') await page.keyboard.press('Space');
    await page.waitForTimeout(900);
  }
  expect(await mine()).toBeGreaterThanOrEqual(3);

  // Let the last events reach the scene, then compare: every pulse cast is one throw on its own
  // wielder, and nothing else plays a throw (no hands in this match, so no grip releases).
  await page.waitForTimeout(500);
  const end = await seen(page);
  const after = end.casts.filter((c) => c.n > from);
  const pulses = (slot: number) =>
    after.filter((c) => c.slot === slot && c.ability === 'pulse' && c.phase === 'tap').length;
  const throws = (slot: number) =>
    (end.wielders[slot]!.played.throw ?? 0) - (played0[slot]!.throw ?? 0);
  console.log(
    `wielders: seat 0 cast ${pulses(0)} pulses, its wielder threw ${throws(0)}; the bot cast ${pulses(1)} pulses (${after.filter((c) => c.slot === 1).length} casts in all), its wielder threw ${throws(1)}`,
  );
  // The wielders' main-thread time per frame (both), on this machine's CPU: a cost check that
  // their posing never takes a noticeable share of a frame, not a phone measurement.
  const w0 = end.wielders[0]!;
  console.log(
    `wielders: ${(w0.frameMs ?? 0).toFixed(3)} ms per frame for both (running mean over ${w0.frames} frames)`,
  );
  expect(w0.frameMs ?? 0).toBeLessThan(4);
  expect(throws(0)).toBe(pulses(0));
  expect(throws(1)).toBe(pulses(1));
  // The bot casts too, and its wielder plays every one of them (a move each).
  const botMoves = total(end.wielders[1]!) - total({ slot: 1, played: played0[1]! });
  const botCasts = after.filter(
    (c) => c.slot === 1 && ['pulse', 'sweep', 'guard'].includes(c.ability),
  );
  expect(botMoves).toBeGreaterThanOrEqual(botCasts.length);
  expect(errors).toEqual([]);
});
