#!/usr/bin/env node
/**
 * Captures the Phase 06 control UI from the real app (production build): the ready-gate control
 * picker, touch play in landscape and portrait, the in-match mode switcher, motion mode with its
 * gauge and recenter prompt (synthetic orientation readings), simplified and left-handed layouts,
 * a 4:3 tablet, the rebinding panel and the controller notice. Browser device emulation in
 * headless Chromium + SwiftShader: visuals only — not physical phones, never performance.
 *
 * usage: node scripts/capture-controls-ui.mjs <baseUrl> <outDir>
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4173', outDir = 'docs/visual-evidence/tmp'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const BOT = `${base}/?mode=bot&difficulty=easy&test=1&quality=low&seed=21`;
const PHONE = { ...devices['iPhone 13'], deviceScaleFactor: 2, permissions: [] };
const LANDSCAPE = { ...PHONE, viewport: { width: 844, height: 390 } };

async function open(options, url = BOT, init) {
  const ctx = await browser.newContext(options);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return { ctx, page };
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${outDir}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`saved ${outDir}/${name}.jpg`);
};

const playing = async (page) => {
  for (let i = 0; i < 120; i++) {
    const phase = await page.evaluate(() => window.__ffDebug?.snapshot()?.match.phase ?? null);
    if (phase === 'playing') return;
    await page.waitForTimeout(250);
  }
  throw new Error('match never started');
};

const startMatch = async (page, tap = true) => {
  const start = page.getByTestId('start-match');
  await (tap ? start.tap() : start.click());
  await playing(page);
  await page.waitForTimeout(1500);
};

/** Synthetic orientation readings at ~30 Hz while window.__tilt holds angles. */
const sensor = () => {
  window.__tilt = { alpha: 0, beta: 0, gamma: 0 };
  setInterval(() => {
    if (window.__tilt)
      window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', window.__tilt));
  }, 33);
};

// 1–3: phone in landscape, touch.
{
  const { ctx, page } = await open(LANDSCAPE);
  await page.waitForTimeout(1500);
  await shot(page, 'controls-1-ready-gate-phone');
  await startMatch(page);
  await shot(page, 'controls-2-touch-landscape');
  // Cast GUARD in live play: its button shows the cooldown draining (a lit band, label dimmed).
  const energy = () => page.evaluate(() => window.__ffDebug?.snapshot()?.players[0]?.energy ?? 0);
  for (let attempt = 0; attempt < 10; attempt++) {
    await playing(page);
    const before = await energy();
    await page.getByTestId('tc-guard').tap();
    // Only the thumb cluster: a full software-rendered frame takes longer than the cooldown.
    await page.screenshot({
      path: `${outDir}/controls-2b-cooldown-guard.jpg`,
      type: 'jpeg',
      quality: 88,
      clip: { x: 640, y: 180, width: 204, height: 210 },
    });
    if ((await energy()) < before - 20) break;
    await page.waitForTimeout(1500);
  }
  await page.getByTestId('mode-chip').tap();
  await page.waitForTimeout(300);
  await shot(page, 'controls-3-mode-menu');
  await ctx.close();
}

// 4–5: motion mode (sensor permission granted; synthetic readings), gauge and recenter prompt.
{
  const { ctx, page } = await open(
    { ...LANDSCAPE, permissions: ['accelerometer', 'gyroscope', 'magnetometer'] },
    BOT,
    sensor,
  );
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await page.getByTestId('controls-motion').tap();
  await page.waitForTimeout(2000);
  await startMatch(page);
  await page.evaluate(() => {
    window.__tilt = { alpha: 0, beta: -9, gamma: 0 }; // turned right
  });
  await page.waitForTimeout(1200);
  await page.getByTestId('motion-recenter').tap();
  await page.waitForTimeout(250);
  await shot(page, 'controls-4-motion');
  await page.evaluate(() => {
    for (const hidden of [true, false]) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    }
  });
  await page.waitForTimeout(500);
  await shot(page, 'controls-5-motion-recenter-prompt');
  await ctx.close();
}

// 6: phone in portrait, touch.
{
  const { ctx, page } = await open(PHONE);
  await startMatch(page);
  await shot(page, 'controls-6-touch-portrait');
  await ctx.close();
}

// 7: simplified (one-hand) mode, 8: left-handed thumb cluster.
{
  const { ctx, page } = await open(LANDSCAPE);
  await page.getByTestId('controls-accessible').tap();
  await startMatch(page);
  await shot(page, 'controls-7-simplified');
  await ctx.close();
}
{
  const left = () => {
    const raw = localStorage.getItem('ff.settings.v1');
    const s = raw ? JSON.parse(raw) : {};
    s.controls = { ...(s.controls ?? {}), hand: 'left' };
    localStorage.setItem('ff.settings.v1', JSON.stringify(s));
  };
  const { ctx, page } = await open(LANDSCAPE, BOT, left);
  await startMatch(page);
  await shot(page, 'controls-8-left-hand');
  await ctx.close();
}

// 9: 4:3 tablet.
{
  const { ctx, page } = await open({
    viewport: { width: 1024, height: 768 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1.5,
  });
  await startMatch(page);
  await shot(page, 'controls-9-tablet-4x3');
  await ctx.close();
}

// 10: desktop rebinding panel, 11: controller notice in a desktop match.
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 720 } }, `${base}/`);
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByTestId('rebind-pulse').click();
  await page.waitForTimeout(300);
  await shot(page, 'controls-10-rebind');
  await ctx.close();
}
{
  const pad = () => {
    const p = {
      id: 'Test pad (STANDARD GAMEPAD)',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    window.__pad = p;
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () => [p, null, null, null],
    });
  };
  const { ctx, page } = await open({ viewport: { width: 1280, height: 720 } }, BOT, pad);
  await startMatch(page, false);
  await page.evaluate(() => {
    const e = new Event('gamepadconnected');
    Object.defineProperty(e, 'gamepad', { value: window.__pad });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(400);
  await shot(page, 'controls-11-gamepad-desktop');
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
