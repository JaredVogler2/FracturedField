#!/usr/bin/env node
/**
 * Prepares the on-device camera-control assets in apps/web/public/vision/ (git-ignored):
 *  - the MediaPipe Tasks Vision WASM runtime (ES-module build, used from a module worker), copied
 *    from the pinned npm package;
 *  - the hand and pose landmark models, downloaded once and verified against pinned SHA-256
 *    hashes (a mismatch is deleted, never served).
 * Assets are self-hosted so camera play never contacts a third party at runtime. A failed
 * download only warns: the game builds and runs, and camera mode reports "unavailable".
 *
 * usage: node scripts/prepare-vision-assets.mjs
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, 'apps/web/node_modules/@mediapipe/tasks-vision');
const out = path.join(root, 'apps/web/public/vision');

/** Apache-2.0 models from the MediaPipe model zoo (float16 variants, version 1). */
const MODELS = [
  {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  },
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function copyRuntime() {
  const dir = path.join(out, 'wasm');
  mkdirSync(dir, { recursive: true });
  for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) {
    const src = path.join(pkg, 'wasm', f);
    if (!existsSync(src)) throw new Error(`missing ${src} — run pnpm install`);
    copyFileSync(src, path.join(dir, f));
  }
  const version = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
  writeFileSync(path.join(dir, 'VERSION'), `@mediapipe/tasks-vision ${version}\n`);
}

async function fetchModel({ file, url, sha256: want, dir: sub = 'models' }) {
  const dir = path.join(out, sub);
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file);
  if (existsSync(dest) && sha256(readFileSync(dest)) === want) return 'cached';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== want) throw new Error(`${file}: checksum mismatch (${got})`);
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
  return 'downloaded';
}

/**
 * Real hand photos from the MediaPipe test assets (Apache-2.0 project), used only by the browser
 * tests to check gesture shapes on genuine model output. Fetched only with VISION_TESTDATA=1 so
 * production builds never ship them.
 */
const TESTDATA = [
  ['thumb_up.jpg', '5d673c081ab13b8a1812269ff57047066f9c33c07db5f4178089e8cb3fdc0291'],
  ['victory.jpg', '84cb8853e3df614e0cb5c93a25e3e2f38ea5e4f92fd428ee7d867ed3479d5764'],
  ['pointing_up.jpg', 'ecf8ca2611d08fa25948a4fc10710af9120e88243a54da6356bacea17ff3e36e'],
  ['fist.jpg', '43fa1cabf3f90d574accc9a56986e2ee48638ce59fc65af1846487f73bb2ef24'],
].map(([file, sha]) => ({
  file,
  url: `https://storage.googleapis.com/mediapipe-assets/${file}`,
  sha256: sha,
  dir: 'testdata',
}));

copyRuntime();
let ok = true;
if (process.env.VISION_TESTDATA === '1') {
  for (const t of TESTDATA) {
    try {
      console.log(`vision testdata: ${t.file} ${await fetchModel(t)}`);
    } catch (e) {
      console.warn(`vision testdata: WARNING ${e instanceof Error ? e.message : String(e)}`);
    }
  }
} else rmSync(path.join(out, 'testdata'), { recursive: true, force: true });
for (const m of MODELS) {
  try {
    console.log(`vision assets: ${m.file} ${await fetchModel(m)}`);
  } catch (e) {
    ok = false;
    rmSync(path.join(out, 'models', m.file), { force: true });
    console.warn(`vision assets: WARNING ${e instanceof Error ? e.message : String(e)}`);
  }
}
if (!ok)
  console.warn('vision assets: camera control will report "unavailable" until assets are present');
