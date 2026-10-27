#!/usr/bin/env node
/**
 * Captures the online flow from two independent browser contexts (two "devices") against a local
 * room service: lobby on both seats, then live play from each seat's own camera. Headless Chromium
 * + SwiftShader: visuals only, never performance.
 *
 * usage: node scripts/capture-online.mjs <baseUrl> <outDir>
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [base = 'http://127.0.0.1:4173', outDir = 'docs/visual-evidence/tmp'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const host = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const guest = await (
  await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  })
).newPage();
for (const [n, p] of [
  ['host', host],
  ['guest', guest],
])
  p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
const shot = async (p, name) => {
  await p.screenshot({ path: `${outDir}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`saved ${outDir}/${name}.jpg`);
};
await host.goto(`${base}/?test=1&quality=medium`);
await host.getByTestId('play-online').click();
await host.waitForTimeout(800);
await shot(host, 'online-menu-desktop');
await host.getByTestId('create-room').click();
await host.getByTestId('online-lobby').waitFor();
const code = (await host.getByTestId('room-code').textContent()).trim();
await host.waitForTimeout(600);
await shot(host, 'online-lobby-host-desktop');
await guest.goto(`${base}/?room=${code}&test=1&quality=low`);
await guest.getByTestId('join-room').waitFor();
await guest.waitForTimeout(600);
await shot(guest, 'online-invite-guest-portrait');
await guest.getByTestId('join-room').click();
await guest.getByTestId('online-lobby').waitFor();
await host.getByTestId('ready').click();
await guest.waitForTimeout(800);
await shot(guest, 'online-lobby-guest-portrait');
await shot(host, 'online-lobby-host-ready-desktop');
await guest.getByTestId('ready').click();
const phase = (p) => p.evaluate(() => window.__ffDebug?.snapshot()?.match.phase ?? null);
for (let i = 0; i < 100 && (await phase(host)) !== 'playing'; i++) await host.waitForTimeout(100);
await host.waitForTimeout(1200);
await shot(host, 'online-play-host-desktop');
await shot(guest, 'online-play-guest-portrait');
console.log('errors:', JSON.stringify(errors));
await browser.close();
