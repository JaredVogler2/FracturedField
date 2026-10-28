#!/usr/bin/env node
/**
 * Draw calls through a stretch of live play (7C: the element effects against the render budget
 * in docs/3D_VISUAL_STANDARD.md). Samples the renderer's counters (all passes of the last frame
 * drawn) every 100 ms and reports the median, the 95th percentile and the peak, with the
 * authoritative effects alive at the peak. Software WebGL draws few frames a second, so the
 * samples are the frames it happened to draw: counts only, never timings.
 *
 * usage: node scripts/probe-draws.mjs [url] [seconds] [desktop|landscape|portrait]
 * The default url is the attract match behind the menu (two bots casting) on the low tier.
 */
import { chromium, devices } from '@playwright/test';

const [url = 'http://127.0.0.1:4173/?test=1&quality=low', secs = '60', deviceName = 'landscape'] =
  process.argv.slice(2);
const device = {
  desktop: { viewport: { width: 1920, height: 1080 } },
  landscape: {
    ...devices['iPhone 13'],
    deviceScaleFactor: 2,
    viewport: { width: 844, height: 390 },
  },
  portrait: { ...devices['iPhone 13'], deviceScaleFactor: 2 },
}[deviceName];
if (!device) throw new Error(`no device ${deviceName}`);

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext(device);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ffDebug?.renderStats?.().drawCalls > 0, null, {
  timeout: 120_000,
});
const samples = [];
const end = Date.now() + Number(secs) * 1000;
while (Date.now() < end) {
  const s = await page.evaluate(() => {
    const r = window.__ffDebug.renderStats();
    const effects = window.__ffDebug.snapshot()?.effects ?? [];
    return {
      draws: r.drawCalls,
      tris: r.triangles,
      tier: r.tier,
      effects: effects.map((e) => e.kind),
    };
  });
  samples.push(s);
  await page.waitForTimeout(100);
}
await browser.close();

const draws = samples.map((s) => s.draws).sort((a, b) => a - b);
const at = (p) => draws[Math.min(draws.length - 1, Math.floor(p * draws.length))];
const peak = samples.reduce((a, b) => (b.draws > a.draws ? b : a));
const tiers = [...new Set(samples.map((s) => s.tier))].join(', ');
const counts = (kinds) =>
  Object.entries(kinds.reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {}))
    .map(([k, n]) => `${k} ×${n}`)
    .join(', ') || 'none';
console.log(`${samples.length} samples over ${secs} s, ${deviceName}, tier ${tiers}`);
console.log(`draw calls: median ${at(0.5)}, p95 ${at(0.95)}, peak ${peak.draws}`);
console.log(`at the peak: ${peak.tris} triangles; effects alive: ${counts(peak.effects)}`);
const busiest = samples.reduce((a, b) => (b.effects.length > a.effects.length ? b : a));
console.log(
  `most effects alive at once: ${busiest.effects.length} (${counts(busiest.effects)}), ${busiest.draws} draws`,
);
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
