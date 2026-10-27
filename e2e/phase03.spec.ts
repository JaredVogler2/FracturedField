/**
 * Phase 03 browser E2E: two independent browser contexts (separate storage, separate sockets —
 * two "devices") play through the real room service (`wrangler dev` / workerd Durable Object).
 * Nothing is injected: each page only uses its own mouse/keyboard and reads its own public view.
 */
import { expect, test } from '@playwright/test';
import { autopilotUntilGoal, debug, openRoom, project, readyUp, snapshot } from './helpers';

test('online duel: create → invite → join → ready → both act → goals → identical result → rematch', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser);
  await readyUp(a, b);

  // Player 2 acts on their own device: a GUARD raised with B's keyboard exists in A's world.
  await b.keyboard.press('KeyF');
  await expect
    .poll(
      async () =>
        (await snapshot(a))?.entities.some((e) => e.kind === 'guard' && e.owner === 1) ?? false,
      { timeout: 10_000 },
    )
    .toBe(true);
  // B's mouse steers seat 1's force point as seen from device A (mirrored camera on B).
  const t = await project(b, 9, 1.1, -4);
  expect(t).not.toBeNull();
  await b.mouse.move(t!.x, t!.y);
  await expect
    .poll(
      async () => {
        const m = (await snapshot(a))?.players[1]?.m;
        return m ? Math.hypot(m[0] - 9, m[1] + 4) : 99;
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(1.2);

  // Player 1 scores with real mouse input until the (fast-rules) match is decided.
  for (let i = 0; i < 4; i++) {
    const outcome = await autopilotUntilGoal(a, 0, 150_000);
    if (outcome === 'end') break;
    await expect
      .poll(
        async () => {
          const p = (await snapshot(a))?.match.phase;
          return p === 'playing' || p === 'matchEnd';
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    if ((await snapshot(a))?.match.phase === 'matchEnd') break;
  }

  await expect.poll(() => debug(a, 'matchEnd'), { timeout: 30_000 }).not.toBeNull();
  await expect.poll(() => debug(b, 'matchEnd'), { timeout: 30_000 }).not.toBeNull();
  const endA = (await debug(a, 'matchEnd'))!;
  const endB = (await debug(b, 'matchEnd'))!;
  expect(endA.digest).toBe(endB.digest);
  expect(endA.winner).toBe(0);
  expect(endA.roundWins).toEqual([2, 0]);
  expect(endB.roundWins).toEqual([2, 0]);
  await expect(a.getByTestId('match-end')).toContainText('YOU WIN');
  await expect(b.getByTestId('match-end')).toContainText('RIVAL WINS');

  // A rematch needs both players.
  await a.getByTestId('rematch').click();
  await expect(a.getByTestId('rematch')).toHaveText(/Waiting/);
  await expect(b.getByTestId('match-note')).toHaveText(/rival wants a rematch/i);
  await b.getByTestId('rematch').click();
  for (const p of [a, b]) {
    await expect(p.getByTestId('match-end')).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(async () => (await snapshot(p))?.match.roundWins, { timeout: 15_000 })
      .toEqual([0, 0]);
  }
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('online duel: a refresh resumes the same seat mid-match; the rival is paused, not awarded the win', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { ctxA, ctxB, a, b, code, errors } = await openRoom(browser);
  await readyUp(a, b);

  // Watch A while B reloads: the pause (and its toast) may be short on a fast machine.
  const pauseSeen = expect
    .poll(async () => (await snapshot(a))?.match.paused, { timeout: 20_000, intervals: [50] })
    .toBe(true);
  const toastSeen = expect
    .poll(() => a.getByTestId('rival-away').isVisible(), { timeout: 20_000, intervals: [50] })
    .toBe(true);
  await b.reload();
  await pauseSeen;
  await toastSeen;

  // B is back in seat 1 without any clicks (seat ticket kept in this tab's sessionStorage).
  await expect.poll(() => debug(b, 'slot'), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => debug(b, 'transport'), { timeout: 30_000 }).toBe('connected');
  await expect(b).toHaveURL(new RegExp(`room=${code}`));
  await expect.poll(async () => (await snapshot(a))?.match.paused, { timeout: 10_000 }).toBe(false);
  await expect(a.getByTestId('rival-away')).toBeHidden();
  expect(await debug(a, 'matchEnd')).toBeNull();
  await expect(b.getByTestId('online-lobby')).toBeHidden();

  // The resumed device controls seat 1 again.
  const t = await project(b, 10, 1.1, 5);
  expect(t).not.toBeNull();
  await b.mouse.move(t!.x, t!.y);
  await expect
    .poll(
      async () => {
        const m = (await snapshot(a))?.players[1]?.m;
        return m ? Math.hypot(m[0] - 10, m[1] - 5) : 99;
      },
      { timeout: 10_000 },
    )
    .toBeLessThan(1.2);
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('online duel: leaving mid-match forfeits and the rival is told', async ({ browser }) => {
  test.setTimeout(120_000);
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser);
  await readyUp(a, b);
  await b.keyboard.press('Escape');
  await b.getByRole('button', { name: /Leave match/ }).click();
  await expect(b.getByTestId('main-menu')).toBeVisible();
  await expect(b).not.toHaveURL(/room=/);
  await expect(a.getByTestId('match-end')).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('match-end')).toContainText('YOU WIN');
  await expect(a.getByTestId('match-note')).toContainText('forfeit');
  await expect(a.getByTestId('rematch')).toBeDisabled();
  const end = (await debug(a, 'matchEnd'))!;
  expect(end.reason).toBe('forfeit');
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
