/**
 * S10: camera access denied — the player is told why and continues immediately with keyboard or
 * touch; the match is fully playable. (A real permission refusal: no auto-accept flag, and the
 * browser context holds no camera permission.)
 */
import { expect, test, type Page } from '@playwright/test';

test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-fake-device-for-media-stream',
    ],
  },
  permissions: [],
});

const snap = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __ffDebug?: { snapshot(): unknown } }).__ffDebug?.snapshot() ?? null,
  ) as Promise<{ match: { phase: string }; players: { m: [number, number] }[] } | null>;

test('no camera permission (headless browser cannot prompt) → message, fallback, playable', async ({
  page,
}) => {
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=3');
  await page.getByTestId('controls-camera').click();
  await expect(page.getByTestId('start-match')).toBeDisabled();
  await page.getByTestId('camera-start').click();
  await expect(page.getByTestId('camera-error')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('camera-fallback').click();
  await expect(page.getByTestId('camera-setup')).toBeHidden();
  await expect(page.getByTestId('controls-keyboard')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snap(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  const before = (await snap(page))!.players[0]!.m[1];
  await page.keyboard.down('KeyS');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyS');
  await expect
    .poll(async () => Math.abs(((await snap(page))?.players[0]?.m[1] ?? before) - before))
    .toBeGreaterThan(1);
});

test('the player blocks the camera (NotAllowedError) → "not allowed" + one-tap fallback (S10)', async ({
  page,
}) => {
  // The exact rejection a browser returns when the player taps "Block" on the permission prompt
  // (headless browsers cannot show that prompt, so the refusal is produced at the API boundary).
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
    });
  });
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=4');
  await page.getByTestId('controls-camera').click();
  await page.getByTestId('camera-start').click();
  await expect(page.getByTestId('camera-error')).toContainText('not allowed');
  await page.getByTestId('camera-fallback').click();
  await expect(page.getByTestId('start-match')).toBeEnabled();
});

test('Settings → Camera control: hand, sensitivity, sign hold time, self-view, forget calibration', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'ff.settings.v1',
      JSON.stringify({
        camera: {
          calibration: {
            palmScale: null,
            center: { x: 0.9, y: 0.55 },
            range: { x0: 0.4, x1: 1.4, y0: 0.2, y1: 0.85 },
          },
        },
      }),
    ),
  );
  await page.goto('/?test=1&quality=low');
  await page.getByRole('button', { name: 'Settings' }).click();
  const group = page.getByTestId('camera-settings');
  await expect(group).toContainText('Calibration saved');
  await group.getByLabel('Playing hand').selectOption('left');
  await group.getByLabel('Gesture sensitivity').fill('1.3');
  await group.getByLabel(/Hold a sign for/).fill('400');
  await group.getByLabel(/Show my camera/).check();
  await group.getByRole('button', { name: 'Forget calibration' }).click();
  await expect(group).toContainText('Not calibrated');
  const saved = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('ff.settings.v1') ?? '{}') as { camera: unknown }).camera,
  );
  expect(saved).toMatchObject({
    dominant: 'left',
    sensitivity: 1.3,
    dwellMs: 400,
    preview: true,
    calibration: null,
  });
});
