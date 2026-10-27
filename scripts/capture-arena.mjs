#!/usr/bin/env node
/**
 * Golden frames of the arena from the real running game (Phase 07 visual review, D07/D11):
 * the gameplay view at kickoff, fixed cinematic shots (?test=1&shot=NAME), material zoom crops,
 * and phone views on the low and medium tiers. Headless Chromium + SwiftShader (software WebGL):
 * visuals only — never performance evidence.
 *
 * usage: node scripts/capture-arena.mjs <baseUrl> <outDir> [tag]
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:4173', outDir = 'docs/visual-evidence/tmp', tag = 'r1'] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

async function open(options, query) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // A shader that fails to compile only logs: treat it as an error too.
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|webgl|THREE/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${base}/?mode=bot&difficulty=easy&test=1&seed=5&${query}`);
  return { ctx, page };
}

async function startMatch(page, tap = false) {
  const start = page.getByTestId('start-match');
  // Software WebGL can keep the main thread busy for a long time (shader compiles, texture
  // generation): allow the first interaction plenty of time.
  await (tap ? start.tap({ timeout: 120_000 }) : start.click({ timeout: 120_000 }));
  for (let i = 0; i < 160; i++) {
    const phase = await page.evaluate(() => window.__ffDebug?.snapshot()?.match.phase ?? null);
    if (phase === 'playing' || phase === 'countdown') return;
    await page.waitForTimeout(250);
  }
  throw new Error('match never started');
}

// Renderer counters per frame (all passes, deterministic for a scene and tier) and the texture
// generation cost on this machine's CPU: the load/perf report. SwiftShader frame times are not
// recorded — they say nothing about a real GPU.
const stats = {};
const shot = async (page, name) => {
  const path = `${outDir}/arena-${name}-${tag}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 86 });
  const s = await page.evaluate(() => window.__ffDebug?.renderStats?.() ?? null);
  if (s) {
    stats[name] = {
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      geometries: s.geometries,
      textures: s.textures,
      surfaceTextures: s.surfaces.generated,
      surfaceGenMs: Math.round(s.surfaces.ms),
    };
  }
  console.log(`saved ${path}`, s ? `(${s.drawCalls} draws, ${s.triangles} tris)` : '');
};

const desktop = { viewport: { width: 1920, height: 1080 } };

// Gameplay view at kickoff (high tier), behind the ready gate dismissed.
{
  const { ctx, page } = await open(desktop, 'quality=high');
  await startMatch(page);
  await page.waitForTimeout(2500);
  await shot(page, 'kickoff-high');
  await ctx.close();
}

// Fixed cinematic and material shots (high tier). The ready gate is dismissed first.
for (const name of ['hero', 'gate', 'rim', 'wide', 'stone', 'brass', 'under', 'channel']) {
  const { ctx, page } = await open(desktop, `quality=high&shot=${name}`);
  await startMatch(page);
  await page.waitForTimeout(2500);
  // Hide the HUD for clean frames: these review the world, not the UI.
  await page.addStyleTag({
    content: '.hud,.mode-chip,.pause-btn,.dev-hud,.touch-controls{display:none!important}',
  });
  await page.waitForTimeout(400);
  await shot(page, name);
  await ctx.close();
}

// D08 lighting comparison: the rejected variants (the selected one is every other frame).
for (const light of ['flat', 'dark']) {
  const { ctx, page } = await open(desktop, `quality=high&light=${light}`);
  await startMatch(page);
  await page.waitForTimeout(2500);
  await shot(page, `light-${light}-kickoff`);
  await ctx.close();
}

// Phones: landscape on the low and medium tiers, portrait on low.
const landscape = {
  ...devices['iPhone 13'],
  deviceScaleFactor: 2,
  viewport: { width: 844, height: 390 },
};
for (const q of ['low', 'medium']) {
  const { ctx, page } = await open(landscape, `quality=${q}`);
  await startMatch(page, true);
  await page.waitForTimeout(2500);
  await shot(page, `phone-landscape-${q}`);
  await ctx.close();
}
for (const light of ['flat', 'dark']) {
  const { ctx, page } = await open(landscape, `quality=medium&light=${light}`);
  await startMatch(page, true);
  await page.waitForTimeout(2500);
  await shot(page, `light-${light}-phone`);
  await ctx.close();
}
{
  const { ctx, page } = await open(
    { ...devices['iPhone 13'], deviceScaleFactor: 2 },
    'quality=low',
  );
  await startMatch(page, true);
  await page.waitForTimeout(2500);
  await shot(page, 'phone-portrait-low');
  await ctx.close();
}

await browser.close();
writeFileSync(`${outDir}/arena-stats-${tag}.json`, `${JSON.stringify(stats, null, 2)}\n`);
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
