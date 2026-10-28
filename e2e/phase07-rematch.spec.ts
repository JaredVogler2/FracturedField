/**
 * D09 failure criteria (7C): no WebGL context leak after repeated matches. Every match started from
 * the menu, and every return to it, mounts a new canvas with its own WebGL context; a view that
 * kept its context alive would pile them up until the browser starts dropping the oldest ("Too
 * many active WebGL contexts"), and the arena would go black. Six round trips here are twelve
 * contexts created; the browser keeps at most sixteen alive.
 */
import { expect, test } from '@playwright/test';
import { debug, snapshot } from './helpers';

const ROUND_TRIPS = 6;

test('six matches from the menu and back: no WebGL context piles up, the arena still renders', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 640, height: 360 });
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/too many active webgl contexts|context lost|CONTEXT_LOST/i.test(text))
      problems.push(`${m.type()}: ${text}`);
  });
  await page.goto('/?test=1&quality=low');
  for (let i = 0; i < ROUND_TRIPS; i++) {
    await page.getByTestId('play-bot').click({ timeout: 60_000 });
    await page.getByTestId('start-match').click({ timeout: 60_000 });
    await expect
      .poll(async () => (await snapshot(page))?.match.phase, { timeout: 60_000 })
      .toMatch(/^(countdown|playing)$/);
    await page.getByRole('button', { name: 'Pause' }).click({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Quit to menu' }).click({ timeout: 60_000 });
    await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  }
  // The menu's live arena (the attract match) still draws after all of that.
  await expect
    .poll(async () => (await debug(page, 'renderStats'))?.drawCalls ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(20);
  expect(problems).toEqual([]);
});
