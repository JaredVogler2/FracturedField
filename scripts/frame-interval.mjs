#!/usr/bin/env node
/**
 * Frame interval of a paused match (a static scene, so builds compare like for like): opens a
 * bot match on an emulated phone (iPhone 13 landscape, DPR 3) at the given quality tier, pauses it
 * and measures requestAnimationFrame intervals for 5 s, `RUNS` times.
 *
 * In this container the browser renders with SwiftShader (software): the numbers compare one
 * build with another on the same machine. They are never device or GPU performance.
 *
 * usage: node scripts/frame-interval.mjs <baseUrl> [quality=low]   (RUNS=3)
 */
import { chromium, devices } from '@playwright/test';

const [base = 'http://127.0.0.1:4173', quality = 'low'] = process.argv.slice(2);
const runs = Number(process.env.RUNS ?? 3);
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = [];
for (let r = 0; r < runs; r++) {
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    deviceScaleFactor: 3,
    viewport: { width: 844, height: 390 },
  });
  const page = await ctx.newPage();
  await page.goto(`${base}/?mode=bot&difficulty=easy&test=1&seed=5&quality=${quality}`);
  await page.getByTestId('start-match').tap({ timeout: 120_000 });
  for (let i = 0; i < 160; i++) {
    const phase = await page.evaluate(() => window.__ffDebug?.snapshot()?.match.phase ?? null);
    if (phase === 'playing') break;
    await page.waitForTimeout(250);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  const ms = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const t0 = last;
        const step = (t) => {
          out.push(t - last);
          last = t;
          if (t - t0 < 5000) requestAnimationFrame(step);
          else resolve(out);
        };
        requestAnimationFrame(step);
      }),
  );
  const sorted = [...ms].sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  results.push({
    mean: Math.round(mean),
    median: Math.round(sorted[Math.floor(sorted.length / 2)]),
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    frames: ms.length,
  });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ quality, runs: results }));
