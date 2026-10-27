#!/usr/bin/env node
/**
 * Captures Phase 04 element visuals from the real renderer: Physics Lab states of the D04 reaction
 * fixtures (deterministic: fixture + tick in the URL) and one live vs-bot match where seat 0 casts
 * with its own keyboard bindings. Headless Chromium + SwiftShader: visuals only, never performance.
 *
 * usage: node scripts/capture-elements.mjs <baseUrl> <outDir> [name|query ...]
 *   e.g. node scripts/capture-elements.mjs http://127.0.0.1:4173 docs/visual-evidence/tmp \
 *          "r5-charge|fx=R5&t=13&cam=close&regions=0"
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4173', outDir = 'docs/visual-evidence/tmp', ...specs] =
  process.argv.slice(2);
const labShots = specs.length
  ? specs
  : [
      'lab-r1-ice-ramp|fx=R1&t=40&cam=close&regions=0',
      'lab-r3-steam|fx=R3&t=30&cam=close&regions=0',
      'lab-r5-electrified-water|fx=R5&t=13&cam=close&regions=0',
      'lab-r6-flame-and-ice|fx=R6&t=30&cam=close&regions=0',
      'lab-r7-gravity-well|fx=R7&t=22&cam=close',
      'lab-r10-heated-stone|fx=R10&t=20&cam=close&regions=0',
    ];
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 810 } })).newPage();
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`saved ${outDir}/${name}.jpg`);
};
const labState = () => page.evaluate(() => window.__ffLab?.state() ?? null);

for (const spec of labShots) {
  const [name, query] = spec.split('|');
  await page.goto(`${base}/lab?test=1&${query}`);
  await page.getByTestId('lab').waitFor();
  const want = Number(new URLSearchParams(query).get('t') ?? 0);
  for (let i = 0; i < 150; i++) {
    const st = await labState();
    if (st && !st.loading && st.t >= want) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(1500);
  await shot(name);
}

// Live match: seat 0 soaks the floor (1), freezes it (3 = default pick FREEZE) and sets a flame (2).
await page.goto(`${base}/?mode=bot&difficulty=easy&test=1&quality=high&seed=12`);
await page.getByTestId('start-match').click();
const snap = () => page.evaluate(() => window.__ffDebug?.snapshot() ?? null);
for (let i = 0; i < 100; i++) {
  if ((await snap())?.match.phase === 'playing') break;
  await page.waitForTimeout(100);
}
await page.waitForTimeout(600);
for (const key of ['Digit1', 'Digit1', 'Digit3', 'KeyD', 'KeyD', 'Digit2']) {
  await page.keyboard.down(key);
  await page.waitForTimeout(key === 'KeyD' ? 500 : 120);
  await page.keyboard.up(key);
  await page.waitForTimeout(900);
}
await page.waitForTimeout(400);
await shot('match-elements-desktop');
console.log('errors:', JSON.stringify(errors));
await browser.close();
