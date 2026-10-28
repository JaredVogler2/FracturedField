#!/usr/bin/env node
/**
 * Tonal metrics of captured frames (Phase 07 visual review): numbers to track lighting revisions
 * alongside the critique — not a substitute for looking at the frames.
 *
 * For every .jpg/.png in <dir>: luma percentiles (sRGB-encoded luminance, 0–1), the fraction of
 * clipped pixels (all channels ≥ 250 of 255: blown highlights), and warm/cool separation (mean
 * (R−B) of the brightest 10 % minus that of the darkest 30 %: positive when the light is warm and
 * the shadows cool, as the art direction asks). Decoded in headless Chromium: no dependencies.
 *
 * usage: node scripts/frame-metrics.mjs <dir> [out.json]
 */
import { chromium } from '@playwright/test';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, out] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/frame-metrics.mjs <dir> [out.json]');
  process.exit(2);
}
const files = readdirSync(dir)
  .filter((f) => /\.(jpe?g|png)$/i.test(f))
  .sort();
const browser = await chromium.launch();
const page = await browser.newPage();
const results = {};
for (const f of files) {
  const mime = /\.png$/i.test(f) ? 'image/png' : 'image/jpeg';
  const data = `data:${mime};base64,${readFileSync(join(dir, f)).toString('base64')}`;
  results[f] = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, img.width, img.height).data;
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const enc = (y) => (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055);
    const n = px.length / 4;
    const luma = new Float32Array(n);
    const warm = new Float32Array(n);
    let clipped = 0;
    for (let i = 0; i < n; i++) {
      const r = px[i * 4];
      const gr = px[i * 4 + 1];
      const b = px[i * 4 + 2];
      luma[i] = enc(0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b));
      warm[i] = (r - b) / 255;
      if (r >= 250 && gr >= 250 && b >= 250) clipped++;
    }
    const order = Array.from(luma.keys()).sort((a, b) => luma[a] - luma[b]);
    const pct = (p) => luma[order[Math.min(n - 1, Math.floor(p * n))]];
    const meanWarm = (from, to) => {
      let s = 0;
      for (let i = Math.floor(from * n); i < Math.floor(to * n); i++) s += warm[order[i]];
      return s / Math.max(1, Math.floor(to * n) - Math.floor(from * n));
    };
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      p5: r3(pct(0.05)),
      p50: r3(pct(0.5)),
      p95: r3(pct(0.95)),
      range: r3(pct(0.95) - pct(0.05)),
      clippedPct: r3((100 * clipped) / n),
      warmCool: r3(meanWarm(0.9, 1) - meanWarm(0, 0.3)),
    };
  }, data);
}
await browser.close();
const pad = (s, w) => String(s).padEnd(w);
console.log(
  `${pad('frame', 46)}${pad('p5', 7)}${pad('p50', 7)}${pad('p95', 7)}${pad('range', 7)}${pad('clip%', 7)}warm-cool`,
);
for (const [f, m] of Object.entries(results))
  console.log(
    `${pad(f, 46)}${pad(m.p5, 7)}${pad(m.p50, 7)}${pad(m.p95, 7)}${pad(m.range, 7)}${pad(m.clippedPct, 7)}${m.warmCool}`,
  );
if (out) writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
