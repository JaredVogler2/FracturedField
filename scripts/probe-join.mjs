#!/usr/bin/env node
/**
 * What a guest page does while it joins a room (PR #3, round 3): a host creates a room, a guest
 * opens the invite and joins, as e2e/helpers.ts openRoom does. Prints, on each page's own clock,
 * every room API request, WebSocket open / HELLO / server message / close, and every long task
 * over a second, then when the guest's seat appeared. Needs the preview (4173) and a local room
 * worker (8787). To reproduce a slower machine, pin everything to fewer cores, e.g.
 * `taskset -c 0,1 node scripts/probe-join.mjs` with the servers started under the same taskset.
 *
 * usage: node scripts/probe-join.mjs [baseUrl] [width] [height] [seconds]
 */
import { chromium } from '@playwright/test';

const [base = 'http://127.0.0.1:4173', w = '960', h = '540', secs = '60'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Runs in each page before its own scripts: a log of network and long-task events. */
const instrument = () => {
  const log = [];
  window.__probe = log;
  const t = () => Math.round(performance.now());
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        log.push({ at: Math.round(e.startTime), ev: 'long task', ms: Math.round(e.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // no long-task timing in this browser
  }
  const kind = (data) =>
    typeof data === 'string' ? (/"t":"(\w+)"/.exec(data)?.[1] ?? '?') : 'bin';
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(url, protocols) {
      super(url, protocols);
      log.push({ at: t(), ev: 'ws new' });
      this.addEventListener('open', () => log.push({ at: t(), ev: 'ws open' }));
      this.addEventListener('message', (m) => {
        const k = kind(m.data);
        if (k !== 'snap' && k !== 'pong') log.push({ at: t(), ev: `ws ${k}` });
      });
      this.addEventListener('close', (c) =>
        log.push({ at: t(), ev: `ws closed ${c.code} ${c.reason}` }),
      );
    }
    send(data) {
      if (kind(data) === 'hello') log.push({ at: t(), ev: 'ws HELLO sent' });
      return super.send(data);
    }
    close(code, reason) {
      log.push({ at: t(), ev: `ws closed by page ${code ?? ''} ${reason ?? ''}` });
      return super.close(code, reason);
    }
  };
  const fetch0 = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0]);
    if (!url.includes('/api/')) return fetch0(...args);
    const path = url.replace(/^.*\/api\//, 'api/');
    log.push({ at: t(), ev: `fetch ${path}` });
    try {
      const r = await fetch0(...args);
      log.push({ at: t(), ev: `fetch ${path} → ${r.status}` });
      return r;
    } catch (e) {
      log.push({ at: t(), ev: `fetch ${path} failed (${e?.name})` });
      throw e;
    }
  };
};

const viewport = { width: Number(w), height: Number(h) };
const ctxA = await browser.newContext({ viewport });
const ctxB = await browser.newContext({ viewport });
await ctxA.addInitScript(instrument);
await ctxB.addInitScript(instrument);
const host = await ctxA.newPage();
const guest = await ctxB.newPage();

await host.goto(`${base}/?fast=1&test=1&quality=low`);
await host.getByTestId('play-online').click({ timeout: 60_000 });
await host.getByTestId('create-room').click({ timeout: 60_000 });
await host.getByTestId('online-lobby').waitFor({ timeout: 60_000 });
const code = (await host.getByTestId('room-code').textContent()).trim();
const t0 = Date.now();
await guest.goto(`${base}/?room=${code}&test=1&quality=low`);
await guest.getByTestId('join-room').click({ timeout: 60_000 });
console.log(`room ${code}: the guest clicked Join ${((Date.now() - t0) / 1000).toFixed(1)} s in`);
let seatedAt = null;
for (let i = 0; i < Number(secs); i++) {
  const slot = await guest.evaluate(() => window.__ffDebug?.slot?.() ?? null).catch(() => null);
  if (slot === 1) {
    seatedAt = Date.now() - t0;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const dump = async (page, name) => {
  const log = await page.evaluate(() => window.__probe ?? []);
  const long = log.filter((e) => e.ev === 'long task');
  const total = long.reduce((s, e) => s + e.ms, 0);
  const max = long.reduce((m, e) => Math.max(m, e.ms), 0);
  console.log(`\n${name}: ${long.length} long tasks, ${total} ms in all, the longest ${max} ms`);
  for (const e of log.sort((x, y) => x.at - y.at)) {
    if (e.ev === 'long task' && e.ms < 1000) continue;
    console.log(`  ${String(e.at).padStart(6)} ms  ${e.ev}${e.ms ? ` ${e.ms} ms` : ''}`);
  }
};
await dump(guest, 'GUEST');
await dump(host, 'HOST');
console.log(
  seatedAt === null
    ? `\nThe guest's seat did not appear within ${secs} s.`
    : `\nThe guest's seat appeared ${(seatedAt / 1000).toFixed(1)} s after it opened the invite (as the test sees it: the page must be free to answer).`,
);
await browser.close();
