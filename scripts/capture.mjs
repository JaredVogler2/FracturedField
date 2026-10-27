#!/usr/bin/env node
/**
 * Captures real screenshots of the running client with Playwright (headless Chromium; WebGL2 via
 * SwiftShader software rendering — frame rates from this harness are NOT device performance).
 *
 * usage: node scripts/capture.mjs <url> <out.png> [width] [height] [waitMs] [--console]
 */
import { chromium } from '@playwright/test';

const [url, out, w = '1920', h = '1080', wait = '6000', ...flags] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: capture.mjs <url> <out.png> [width] [height] [waitMs]');
  process.exit(2);
}
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 1,
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(wait));
const jpeg = /\.jpe?g$/i.test(out);
await page.screenshot({ path: out, ...(jpeg ? { type: 'jpeg', quality: 82 } : {}) });
const hud = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="dev-hud"]');
  return el ? el.textContent : null;
});
console.log(`saved ${out}`);
if (hud) console.log(`HUD: ${hud}`);
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (flags.includes('--console')) for (const l of logs) console.log(l);
else for (const l of errors) console.log(l);
await browser.close();
