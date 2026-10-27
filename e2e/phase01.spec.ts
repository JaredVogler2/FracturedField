import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const golden = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../packages/sim/test/golden/harness-100.json'),
    'utf8',
  ),
) as Record<string, unknown>;

test('browser runtime reproduces the 100-tick physics golden output exactly', async ({ page }) => {
  await page.goto('/spike');
  const pre = page.locator('#harness');
  await expect(pre).toContainText('"rapier"');
  const result = JSON.parse((await pre.textContent()) ?? '{}') as Record<string, unknown>;
  expect(result).toEqual(golden);
});

test('3D arena boots, renders WebGL and advances the shared simulation without errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  const hud = page.getByTestId('dev-hud');
  await expect(hud).toContainText('local · connected');
  const tickOf = async () => Number(await page.locator('[data-key="sim tick"]').textContent());
  const t1 = await tickOf();
  await page.waitForTimeout(3000);
  const t2 = await tickOf();
  expect(t2).toBeGreaterThan(t1);
  await expect(page.locator('[data-key="bodies"]')).toHaveText('3');
  // The canvas must contain a rendered image, not a blank clear colour.
  const shot = await page.locator('canvas').screenshot();
  expect(shot.byteLength).toBeGreaterThan(30_000);
  expect(errors).toEqual([]);
});

test('/sim-debug renders the collider overlay from the same physics data', async ({ page }) => {
  await page.goto('/sim-debug');
  await expect(page.getByTestId('dev-hud')).toContainText('local · connected');
  await expect(page.locator('canvas')).toBeVisible();
});
