/**
 * Phase 04 browser E2E: advanced-move loadouts reach the authority (local worker and the online
 * room), element casts change server-owned state, and the Physics Lab replays a D04 fixture in the
 * browser with the same outcome the regression suite asserts.
 */
import { expect, test, type Page } from '@playwright/test';
import { openRoom, readyUp } from './helpers';

interface ElementSnap {
  match: { phase: string };
  players: { cd: Record<string, number> }[];
  effects: { kind: string; owner: number }[];
}

const elementSnap = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __ffDebug?: { snapshot(): unknown } }).__ffDebug?.snapshot() ?? null,
  ) as Promise<ElementSnap | null>;

interface LabCheck {
  label: string;
  pass: boolean | null;
}
interface LabView {
  t: number;
  done: boolean;
  loading: boolean;
  checks: LabCheck[];
}

const labState = (page: Page) =>
  page.evaluate(() => {
    const lab = (window as unknown as { __ffLab?: { state(): LabView } }).__ffLab;
    if (!lab) return null;
    const s = lab.state();
    return { t: s.t, done: s.done, loading: s.loading, checks: s.checks };
  });

/** Presses a key until the authoritative snapshot satisfies `ok` (kickoff shield, lockouts). */
async function castUntil(page: Page, key: string, ok: (s: ElementSnap) => boolean) {
  await expect
    .poll(
      async () => {
        await page.keyboard.press(key);
        await page.waitForTimeout(150);
        const s = await elementSnap(page);
        return s ? ok(s) : false;
      },
      { timeout: 20_000, intervals: [100] },
    )
    .toBe(true);
}

test('loadout picks reach the local authority; WET and a picked move change the world', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=21');
  // Picking a third move replaces the older pick: freeze+charge (default) → gravity+magnetize.
  await page.getByTestId('loadout-gravity').click();
  await page.getByTestId('loadout-magnetize').click();
  await expect(page.getByTestId('loadout-gravity')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('loadout-magnetize')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('loadout-freeze')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('start-match').click();
  await expect.poll(async () => (await elementSnap(page))?.match.phase).toBe('playing');

  // The HUD shows the base kit, both element casts and exactly the two picks.
  await expect(page.locator('.player-panel.local .ab-name')).toHaveText([
    'Pulse',
    'Lift',
    'Sweep',
    'Guard',
    'Wet',
    'Heat',
    'Gravity',
    'Magnet',
  ]);

  // WET (key 1) puts a water pool owned by seat 0 into the authoritative world.
  await castUntil(page, 'Digit1', (s) => s.effects.some((e) => e.kind === 'pool' && e.owner === 0));
  // Pick 1 (key 3) is GRAVITY: accepted by the authority (cooldown running / well present).
  await castUntil(
    page,
    'Digit3',
    (s) =>
      (s.players[0]?.cd.gravity ?? 0) > 0 ||
      s.effects.some((e) => e.kind === 'well' && e.owner === 0),
  );
  // FREEZE was not picked, so seat 0 never has it on cooldown.
  const s = await elementSnap(page);
  expect(s?.players[0]?.cd.freeze ?? 0).toBe(0);
  expect(errors).toEqual([]);
});

test('physics lab: step, rewind and a full replay of R7 match the fixture expectations', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/lab?fx=R7&test=1&quality=low');
  await expect.poll(async () => (await labState(page))?.loading).toBe(false);
  await page.getByTestId('lab-step').click();
  await page.getByTestId('lab-step').click();
  await expect.poll(async () => (await labState(page))?.t).toBe(2);
  await page.getByTestId('lab-back').click();
  await expect.poll(async () => (await labState(page))?.t).toBe(1);

  // Reaction variant: the gravity well curves the wide shot into the goal.
  await page.getByTestId('lab-play').click();
  await expect.poll(async () => (await labState(page))?.done, { timeout: 60_000 }).toBe(true);
  const reaction = await labState(page);
  expect(reaction!.checks.length).toBeGreaterThan(0);
  expect(reaction!.checks.filter((c) => c.pass !== true)).toEqual([]);
  await expect(page.getByTestId('lab-log')).toContainText('WELL');

  // Control variant: the same shot without the well misses.
  await page.getByTestId('lab-variant-control').click();
  await expect.poll(async () => (await labState(page))?.loading).toBe(false);
  await page.getByTestId('lab-play').click();
  await expect.poll(async () => (await labState(page))?.done, { timeout: 60_000 }).toBe(true);
  const control = await labState(page);
  expect(control!.checks.filter((c) => c.pass !== true)).toEqual([]);
  expect(errors).toEqual([]);
});

test('online: a READY loadout is shown to the rival and applied by the room', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser);
  // Host picks gravity + magnet in the lobby, then readies: the guest sees the picks.
  await a.getByTestId('loadout-gravity').click();
  await a.getByTestId('loadout-magnetize').click();
  await a.getByTestId('ready').click();
  await expect(b.getByTestId('lobby-picks-0')).toHaveText('Gravity · Magnet');
  await expect(a.getByTestId('loadout-gravity')).toBeDisabled();
  await readyUp(a, b, { hostAlreadyReady: true });
  // The room applied the picks: the host's pick-1 key casts GRAVITY, visible on the guest device.
  await castUntil(a, 'Digit3', (s) => (s.players[0]?.cd.gravity ?? 0) > 0);
  await expect
    .poll(
      async () => {
        const s = await elementSnap(b);
        return (
          (s?.players[0]?.cd.gravity ?? 0) > 0 ||
          (s?.effects.some((e) => e.kind === 'well' && e.owner === 0) ?? false)
        );
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
