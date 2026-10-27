#!/usr/bin/env node
/**
 * Builds a Y4M video (Chrome's fake-camera file format) from real hand photos, so browser tests
 * can drive the REAL camera path — getUserMedia → vision worker → hand model → gestures → intents —
 * with genuine hand imagery. Photos are decoded by headless Chromium (no native image libraries).
 *
 * usage: node scripts/make-hand-video.mjs <out.y4m>
 *   images: apps/web/public/vision/testdata/ (VISION_TESTDATA=1 node scripts/prepare-vision-assets.mjs)
 */
import { chromium } from '@playwright/test';
import { closeSync, existsSync, openSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [out = 'test-results/hands.y4m'] = process.argv.slice(2);
const testdata = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web/public/vision/testdata',
);
const W = 320;
const H = 240;
const FPS = 15;
/** [image, seconds] — the file loops, so the sequence repeats during a test. */
const SEGMENTS = [
  ['victory', 2],
  ['fist', 3],
  ['pointing_up', 2],
  ['thumb_up', 2.5],
];

for (const [name] of SEGMENTS) {
  if (!existsSync(path.join(testdata, `${name}.jpg`))) {
    console.error(
      `missing ${name}.jpg — run VISION_TESTDATA=1 node scripts/prepare-vision-assets.mjs`,
    );
    process.exit(2);
  }
}
const browser = await chromium.launch();
const page = await browser.newPage();
const frames = {};
for (const [name] of SEGMENTS) {
  if (frames[name]) continue;
  // RGBA of the photo centred on a neutral wall-coloured frame (hand ≈ 80 % of the height).
  const rgba = await page.evaluate(
    async ({ url, w, h }) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#d9d6d0';
      g.fillRect(0, 0, w, h);
      const s = (h * 0.95) / img.naturalHeight;
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return Array.from(g.getImageData(0, 0, w, h).data);
    },
    {
      url: `data:image/jpeg;base64,${readFileSync(path.join(testdata, `${name}.jpg`)).toString('base64')}`,
      w: W,
      h: H,
    },
  );
  // RGBA → I420 (BT.601 limited range).
  const y = Buffer.alloc(W * H);
  const u = Buffer.alloc((W / 2) * (H / 2));
  const v = Buffer.alloc((W / 2) * (H / 2));
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 4;
      const r = rgba[k];
      const gg = rgba[k + 1];
      const b = rgba[k + 2];
      y[j * W + i] = Math.round(16 + 0.257 * r + 0.504 * gg + 0.098 * b);
      if (j % 2 === 0 && i % 2 === 0) {
        const c = (j / 2) * (W / 2) + i / 2;
        u[c] = Math.round(128 - 0.148 * r - 0.291 * gg + 0.439 * b);
        v[c] = Math.round(128 + 0.439 * r - 0.368 * gg - 0.071 * b);
      }
    }
  }
  frames[name] = Buffer.concat([y, u, v]);
}
await browser.close();

const fd = openSync(out, 'w');
writeSync(fd, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
let count = 0;
for (const [name, secs] of SEGMENTS) {
  for (let n = 0; n < Math.round(secs * FPS); n++) {
    writeSync(fd, 'FRAME\n');
    writeSync(fd, frames[name]);
    count++;
  }
}
closeSync(fd);
console.log(`wrote ${out}: ${count} frames, ${W}x${H} @ ${FPS} fps`);
