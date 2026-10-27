import { expect, test } from '@playwright/test';
import { debug, snapshot } from './helpers';

/**
 * Phase 07B (D08) — adaptive rendering quality in the real game. Headless Chromium renders WebGL
 * in software (SwiftShader), far below 40 fps at the high tier: with quality "auto" the renderer
 * must step down on its own, keep the match running and log nothing. Test runs keep a fixed tier
 * unless they opt in with `adaptive=1` (reproducible captures and tests).
 */
test('adaptive quality: a slow renderer steps down from high on its own; the match plays on', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|webgl|THREE/i.test(m.text())) errors.push(m.text());
  });
  await page.goto('/?mode=bot&difficulty=easy&test=1&adaptive=1&seed=5');
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 60_000 })
    .toMatch(/countdown|playing/);
  const first = await debug(page, 'renderStats');
  expect(first?.adaptive).toBe(true);
  expect(first?.tier).toBe('high');
  // Down within the hold (≥ 5 s of a low smoothed rate), not instantly.
  const t0 = Date.now();
  await expect
    .poll(async () => (await debug(page, 'renderStats'))?.tier, { timeout: 60_000 })
    .not.toBe('high');
  expect(Date.now() - t0).toBeGreaterThan(4000);
  // Still slow: it keeps stepping (after the cooldown) down to low, and stays there.
  await expect
    .poll(async () => (await debug(page, 'renderStats'))?.tier, { timeout: 60_000 })
    .toBe('low');
  const tick = (await snapshot(page))!.tick;
  await expect
    .poll(async () => (await snapshot(page))!.tick, { timeout: 10_000 })
    .toBeGreaterThan(tick);
  expect(errors).toEqual([]);
});

test('a fixed quality (settings or a test run) never adapts', async ({ page }) => {
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=high&seed=5');
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 60_000 })
    .toMatch(/countdown|playing/);
  await page.waitForTimeout(15_000);
  const stats = await debug(page, 'renderStats');
  expect(stats?.adaptive).toBe(false);
  expect(stats?.tier).toBe('high');
});
