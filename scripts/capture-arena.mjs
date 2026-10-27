#!/usr/bin/env node
/**
 * Golden frames of the arena from the real running game (Phase 07 visual review, D07/D08/D11):
 * the menu's live attract arena (the first thing a player sees), the gameplay view at kickoff,
 * fixed cinematic shots (?test=1&shot=NAME), material zoom crops, the D08 lighting comparison,
 * phone views on the low and medium tiers, and element close-ups from the Physics Lab. Headless
 * Chromium + SwiftShader (software WebGL): visuals only — never performance evidence.
 *
 * usage: node scripts/capture-arena.mjs <baseUrl> <outDir> [tag]
 * ONLY=menu,kickoff,shots,light,phones,elements limits the sections captured.
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base = 'http://127.0.0.1:4173', outDir = 'docs/visual-evidence/tmp', tag = 'r1'] =
  process.argv.slice(2);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (section) => !only || only.has(section);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

function watch(page) {
  page.on('pageerror', (e) => errors.push(e.message));
  // A shader that fails to compile only logs: treat it as an error too.
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|webgl|THREE/i.test(m.text())) errors.push(m.text());
  });
}

async function open(options, query) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  watch(page);
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
const landscape = {
  ...devices['iPhone 13'],
  deviceScaleFactor: 2,
  viewport: { width: 844, height: 390 },
};
const portrait = { ...devices['iPhone 13'], deviceScaleFactor: 2 };

// The main menu over the live attract arena: the first impression, desktop and phones.
if (want('menu')) {
  for (const [name, options, q] of [
    ['menu-desktop-high', desktop, 'high'],
    ['menu-phone-portrait-low', portrait, 'low'],
    ['menu-phone-landscape-medium', landscape, 'medium'],
  ]) {
    const ctx = await browser.newContext(options);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(`${base}/?test=1&seed=5&quality=${q}`);
    await page.getByRole('button', { name: 'Settings' }).waitFor({ timeout: 120_000 });
    await page.waitForTimeout(6000);
    await shot(page, name);
    await ctx.close();
  }
}

// Gameplay view at kickoff (high tier), behind the ready gate dismissed.
if (want('kickoff')) {
  const { ctx, page } = await open(desktop, 'quality=high');
  await startMatch(page);
  await page.waitForTimeout(2500);
  await shot(page, 'kickoff-high');
  await ctx.close();
}

// Fixed cinematic and material shots (high tier). The ready gate is dismissed first.
if (want('shots')) {
  for (const name of ['hero', 'gate', 'rim', 'wide', 'stone', 'brass', 'under', 'channel']) {
    const { ctx, page } = await open(desktop, `quality=high&shot=${name}`);
    await startMatch(page);
    await page.waitForTimeout(2500);
    // Hide the HUD for clean frames: these review the world, not the UI.
    await page.addStyleTag({
      content:
        '.hud,.mode-chip,.pause-btn,.dev-hud,.touch-controls,.banner{display:none!important}',
    });
    await page.waitForTimeout(400);
    await shot(page, name);
    await ctx.close();
  }
}

// D08 lighting comparison: the rejected variants (the selected one is every other frame).
if (want('light')) {
  for (const light of ['flat', 'dark']) {
    const { ctx, page } = await open(desktop, `quality=high&light=${light}`);
    await startMatch(page);
    await page.waitForTimeout(2500);
    await shot(page, `light-${light}-kickoff`);
    await ctx.close();
  }
  for (const light of ['flat', 'dark']) {
    const { ctx, page } = await open(landscape, `quality=medium&light=${light}`);
    await startMatch(page, true);
    await page.waitForTimeout(2500);
    await shot(page, `light-${light}-phone`);
    await ctx.close();
  }
}

// Phones: landscape on the low and medium tiers, portrait on low.
if (want('phones')) {
  for (const q of ['low', 'medium']) {
    const { ctx, page } = await open(landscape, `quality=${q}`);
    await startMatch(page, true);
    await page.waitForTimeout(2500);
    await shot(page, `phone-landscape-${q}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(portrait, 'quality=low');
    await startMatch(page, true);
    await page.waitForTimeout(2500);
    await shot(page, 'phone-portrait-low');
    await ctx.close();
  }
}

// D08: fire, ice and wet surfaces under the final light, from the Physics Lab's reaction fixtures
// (close camera, overlays off, a fixed tick): highlights must not clip and the materials must stay
// distinguishable. Defaults: R6 heat beside ice, R1 the ice ramp, R3 steam, R5 charge on the wet
// chain. Set ELEMENT_TICKS="R6:30,R1:120" to choose other moments.
if (want('elements')) {
  const elementTicks = (process.env.ELEMENT_TICKS ?? 'R6:30,R1:120,R3:90,R5:20')
    .split(',')
    .map((s) => s.split(':'));
  for (const [fx, t] of elementTicks) {
    const ctx = await browser.newContext(desktop);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(
      `${base}/lab?fx=${fx}&t=${t}&cam=close&vectors=0&regions=0&impacts=0&quality=high&test=1`,
    );
    for (let i = 0; i < 240; i++) {
      const at = await page.evaluate(() => window.__ffLab?.state().t ?? -1);
      if (at === Number(t)) break;
      await page.waitForTimeout(250);
    }
    await page.addStyleTag({ content: '.lab-panel,.lab-tick{display:none!important}' });
    await page.waitForTimeout(2500);
    await shot(page, `element-${fx}-t${t}`);
    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${outDir}/arena-stats-${tag}.json`, `${JSON.stringify(stats, null, 2)}\n`);
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
