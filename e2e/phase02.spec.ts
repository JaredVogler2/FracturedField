import { expect, test, type Page } from '@playwright/test';

interface Snap {
  tick: number;
  entities: { kind: string; p: [number, number, number]; v: [number, number, number] }[];
  players: { m: [number, number] }[];
  match: { phase: string; score: [number, number]; roundWins: [number, number]; round: number };
}

const snapshot = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __ffDebug?: { snapshot(): unknown } }).__ffDebug?.snapshot() ?? null,
  ) as Promise<Snap | null>;
const project = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(
    ([a, b, c]) =>
      (
        window as unknown as {
          __ffDebug: { project(x: number, y: number, z: number): { x: number; y: number } | null };
        }
      ).__ffDebug.project(a!, b!, c!),
    [x, y, z],
  );

/**
 * A scripted "player 1" that only uses the real mouse: it reads the public snapshot (what is on
 * screen), moves the pointer behind the core relative to the +X goal and clicks to PULSE.
 */
async function autopilotUntilGoal(page: Page, timeoutMs: number): Promise<'goal' | 'end'> {
  const deadline = Date.now() + timeoutMs;
  let goalsAtStart: number | null = null;
  while (Date.now() < deadline) {
    const s = await snapshot(page);
    if (!s) {
      await page.waitForTimeout(100);
      continue;
    }
    // Each round starts 0-0; a P1 goal shows as score[0] > 0 during the goal pause.
    const goals = s.match.score[0];
    goalsAtStart ??= goals;
    if (goals > goalsAtStart) return 'goal';
    if (s.match.phase === 'matchEnd') return 'end';
    const core = s.entities.find((e) => e.kind === 'core')!;
    const [cx, , cz] = core.p;
    const dx = 21.8 - cx;
    const dz = -cz;
    const d = Math.hypot(dx, dz) || 1;
    // Stand behind the core on its line to the goal (the game clamps us to our own half).
    const tx = Math.min(1.9, cx - (dx / d) * 1.4);
    const tz = cz - (dz / d) * 1.4;
    const p = await project(page, tx, 1.1, tz);
    if (p) await page.mouse.move(p.x, p.y);
    const m = s.players[0]!.m;
    const px = cx - m[0];
    const pz = cz - m[1];
    const reach = Math.hypot(px, pz);
    const align = (px * dx + pz * dz) / ((reach || 1) * d);
    const settled = Math.hypot(m[0] - tx, m[1] - tz) < 1.0;
    if (s.match.phase === 'playing' && settled && reach < 5.5 && align > 0.9 && p)
      await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(70);
  }
  throw new Error('autopilot did not score in time');
}

test('local duel: real mouse input scores, a match is won, and a rematch starts without a reload', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/?mode=duel&fast=1&test=1&quality=low&seed=4');
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');

  // Fast local rules: 1 goal wins a round, 2 rounds win the match. Player 2 stays idle.
  let goals = 0;
  for (let round = 0; round < 3; round++) {
    const outcome = await autopilotUntilGoal(page, 150_000);
    if (outcome === 'goal') {
      goals++;
      await expect(page.locator('.banner-title', { hasText: /^GOAL$/ })).toBeVisible();
    }
    const end = await snapshot(page);
    if (outcome === 'end' || end?.match.phase === 'matchEnd') break;
    await expect
      .poll(
        async () => {
          const p = (await snapshot(page))?.match.phase;
          return p === 'playing' || p === 'matchEnd';
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    if ((await snapshot(page))?.match.phase === 'matchEnd') break;
  }
  expect(goals).toBeGreaterThanOrEqual(1);

  const panel = page.getByTestId('match-end');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const final = await snapshot(page);
  expect(final?.match.roundWins[0]).toBe(2);
  await expect(panel).toContainText('PLAYER 1 WINS');

  await page.getByTestId('rematch').click();
  await expect(panel).toBeHidden();
  await expect
    .poll(async () => (await snapshot(page))?.match.roundWins, { timeout: 15_000 })
    .toEqual([0, 0]);
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 15_000 })
    .toBe('playing');
  expect(errors).toEqual([]);
});

test('vs bot: keyboard steering moves the force point and the match clock runs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low');
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  const before = (await snapshot(page))!.players[0]!.m;
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyD');
  const after = (await snapshot(page))!.players[0]!.m;
  expect(after[0]).toBeGreaterThan(before[0] + 1);
  await expect(page.getByTestId('clock')).not.toHaveText('1:30');
});

test('local duel: two keyboard adapters steer both seats simultaneously', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/?mode=duel&test=1&quality=low&seed=9');
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  const before = (await snapshot(page))!.players;
  await page.keyboard.down('KeyW'); // P1: screen up (-Z)
  await page.keyboard.down('ArrowDown'); // P2: screen down (+Z)
  await page.waitForTimeout(1200);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ArrowDown');
  const after = (await snapshot(page))!.players;
  expect(after[0]!.m[1]).toBeLessThan(before[0]!.m[1] - 1);
  expect(after[1]!.m[1]).toBeGreaterThan(before[1]!.m[1] + 1);
});

test('menu renders over the live attract match and opens controls and settings', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await page.getByRole('button', { name: 'Controls' }).click();
  await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
});
