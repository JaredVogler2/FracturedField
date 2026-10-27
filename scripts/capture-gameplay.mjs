#!/usr/bin/env node
/**
 * Captures real gameplay moments from the running client (vs-bot match, scripted player using the
 * real mouse/keyboard path). Headless Chromium + SwiftShader: visuals only, never performance.
 *
 * usage: node scripts/capture-gameplay.mjs <baseUrl> <outDir> <prefix> [width] [height] [quality]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [
  base = 'http://127.0.0.1:4173',
  outDir = 'docs/visual-evidence/tmp',
  prefix = 'shot',
  w = '1920',
  h = '1080',
  quality = 'high',
] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/?mode=bot&difficulty=normal&test=1&seed=4&quality=${quality}`);
await page.getByTestId('start-match').click();

const snap = () => page.evaluate(() => window.__ffDebug?.snapshot() ?? null);
const project = (x, y, z) =>
  page.evaluate(([a, b, c]) => window.__ffDebug.project(a, b, c), [x, y, z]);
const shot = async (name) => {
  await page.screenshot({ path: `${outDir}/${prefix}-${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`saved ${outDir}/${prefix}-${name}.jpg`);
};
async function waitPhase(phase, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await snap();
    if (s?.match.phase === phase) return s;
    await page.waitForTimeout(100);
  }
  throw new Error(`phase ${phase} not reached`);
}
async function moveBehindCore(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await snap();
    const core = s.entities.find((e) => e.kind === 'core');
    const [cx, , cz] = core.p;
    const dx = 21.8 - cx;
    const dz = -cz;
    const d = Math.hypot(dx, dz) || 1;
    const p = await project(Math.min(1.9, cx - (dx / d) * 1.5), 1.1, cz - (dz / d) * 1.5);
    if (p) await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(90);
  }
}

await waitPhase('playing');
await page.waitForTimeout(400);
await shot('kickoff');
await moveBehindCore(1800);
await shot('approach');
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(160);
await shot('pulse');
await page.keyboard.press('KeyQ');
await page.waitForTimeout(350);
await shot('sweep');
await moveBehindCore(1500);
await page.mouse.down({ button: 'right' });
await page.waitForTimeout(700);
await shot('lift');
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(500);
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
await shot('guard');
console.log('errors:', JSON.stringify(errors));
await browser.close();
