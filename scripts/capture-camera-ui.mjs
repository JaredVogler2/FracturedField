#!/usr/bin/env node
/**
 * Captures the Phase 05 camera-control UI from the real app: the setup wizard with Chromium's fake
 * camera playing real hand photos (scripts/make-hand-video.mjs), practice, and the in-match status
 * chip with self-view while the model tracks the photo hand. Headless Chromium + SwiftShader:
 * visuals only, never performance.
 *
 * usage: node scripts/capture-camera-ui.mjs <baseUrl> <outDir> <hands.y4m>
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';

const [
  base = 'http://127.0.0.1:4173',
  outDir = 'docs/visual-evidence/tmp',
  video = 'node_modules/.cache/ff-e2e/hands.y4m',
] = process.argv.slice(2);
if (!existsSync(video)) {
  console.error(`missing ${video} — run: node scripts/make-hand-video.mjs ${video}`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: [
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${video}`,
  ],
});
const errors = [];
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  permissions: ['camera'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`saved ${outDir}/${name}.jpg`);
};
const camera = () => page.evaluate(() => window.__ffCamera?.status() ?? null);
const until = async (pred, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

// The photo hand reads as a left hand after the selfie label swap (see e2e/phase05.spec.ts).
await page.addInitScript(() =>
  localStorage.setItem(
    'ff.settings.v1',
    JSON.stringify({
      camera: {
        setup: 'close',
        facing: 'user',
        dominant: 'left',
        sensitivity: 1,
        dwellMs: 280,
        preview: true,
        calibration: {
          palmScale: null,
          center: { x: 0.67, y: 0.55 },
          range: { x0: 0.29, x1: 1.04, y0: 0.22, y1: 0.85 },
          hand: 'left',
          palmFacing: -0.5,
        },
      },
    }),
  ),
);
await page.goto(`${base}/?mode=bot&difficulty=easy&test=1&quality=high&seed=31`);
await page.getByTestId('controls-camera').click();
await page.getByTestId('camera-setup').waitFor();
await page.waitForTimeout(1500);
await shot('camera-1-choose');

await page.getByTestId('camera-start').click();
await until(async () => (await camera())?.state === 'running', 90_000);
await until(async () => (await camera())?.track?.state === 'tracking', 30_000);
await page.waitForTimeout(800);
await shot('camera-2-frame');

await page.getByRole('button', { name: 'Use saved calibration' }).click();
await until(async () => Object.keys((await camera())?.practiced ?? {}).length >= 2, 60_000);
await shot('camera-3-practice');

await page.getByRole('button', { name: 'Skip practice' }).click();
await page.getByTestId('start-match').click();
await until(
  async () =>
    (await page.evaluate(() => window.__ffDebug?.snapshot()?.match.phase ?? null)) === 'playing',
  30_000,
);
// Capture while the chip echoes a gesture the model recognised in play (the echo lasts 0.9 s).
await page
  .locator('.cam-last')
  .waitFor({ timeout: 60_000 })
  .catch(() => undefined);
await shot('camera-4-match-chip');
await page.getByRole('button', { name: 'Gestures' }).click();
await page.waitForTimeout(400);
await shot('camera-5-gesture-card');

const stats = (await camera())?.stats;
console.log(`camera stats (this container): ${JSON.stringify(stats)}`);
if (errors.length) console.log(`page errors: ${errors.join(' | ')}`);
await browser.close();
