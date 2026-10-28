#!/usr/bin/env node
/**
 * Golden frames of the arena from the real running game (Phase 07 visual review, D07/D08/D11):
 * the menu's live attract arena (the first thing a player sees), the gameplay view at kickoff,
 * fixed cinematic shots (?test=1&shot=NAME), material zoom crops, the D08 lighting comparison,
 * phone views on the low and medium tiers, and element close-ups from the Physics Lab. Headless
 * Chromium + SwiftShader (software WebGL): visuals only — never performance evidence.
 *
 * usage: node scripts/capture-arena.mjs <baseUrl> <outDir> [tag]
 * ONLY=menu,kickoff,shots,core,light,phones,elements limits the sections captured.
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

/** Each page's recent console lines, printed when its frame will not render. */
const consoles = new WeakMap();

function watch(page) {
  const lines = [];
  consoles.set(page, lines);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    lines.push(`${m.type()}: ${m.text()}`);
    if (lines.length > 20) lines.shift();
    // A shader that fails to compile only logs: treat it as an error too.
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
// A frame of one flat colour (the canvas never drew) compresses to a few KB; a rendered arena is
// hundreds.
const BLANK_BYTES = 40_000;
/** Resolves once the page has rendered one whole frame after the call. */
const rendered = (page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const shot = async (page, name) => {
  const path = `${outDir}/arena-${name}-${tag}.jpg`;
  for (let attempt = 1; ; attempt++) {
    // Software GL under load can hold a frame back past any fixed wait (a shader compile blocks
    // the main thread), and the shot comes out blank: then let a whole frame render first. The
    // Physics Lab's manual frames draw only when asked: draw the same moment again (no time
    // passes), or every retake shoots the same blank canvas.
    if (attempt > 1) {
      await page.evaluate(() => window.__ffLab?.frame?.(0));
      await rendered(page);
    }
    let image = null;
    try {
      image = await page.screenshot({ type: 'jpeg', quality: 86, timeout: 60_000 });
    } catch (e) {
      // The compositor can miss a capture under load: try again.
      if (!/Unable to capture screenshot/.test(String(e))) throw e;
    }
    if (image && image.length > BLANK_BYTES) {
      writeFileSync(path, image);
      break;
    }
    if (attempt >= 3) {
      if (image) writeFileSync(path, image);
      errors.push(`${name}: ${image ? 'blank frame' : 'no screenshot'} after ${attempt} tries`);
      console.error(
        `${name}: no rendered frame; recent console:\n  ${consoles.get(page)?.join('\n  ')}`,
      );
      return;
    }
    await page.waitForTimeout(3000);
  }
  // The Physics Lab draws frame by frame: draw the same moment once more (no time passes), so the
  // counters hold the shot frame's own totals.
  const s = await page.evaluate(() => {
    if (window.__ffLab?.stats) {
      window.__ffLab.frame(0);
      return window.__ffLab.stats();
    }
    return window.__ffDebug?.renderStats?.() ?? null;
  });
  if (s) {
    stats[name] = {
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      geometries: s.geometries,
      textures: s.textures,
      ...(s.surfaces
        ? { surfaceTextures: s.surfaces.generated, surfaceGenMs: Math.round(s.surfaces.ms) }
        : { programs: s.programs }),
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

// The Rift Core close up (7C) with a camera that follows it, on the high and low tiers: at rest in
// the Hands Lab (no opponent, no kickoff nudge), then moving in a match once the bot has struck it.
// Its reacting states (heat, charge, wet) come from the Physics Lab (elements).
const hideUi = (page) =>
  page.addStyleTag({
    content:
      '.hud,.mode-chip,.pause-btn,.dev-hud,.touch-controls,.banner,.hands-lab{display:none!important}',
  });
const coreState = (page) =>
  page.evaluate(() => {
    const s = window.__ffDebug?.snapshot();
    const c = s?.entities.find((e) => e.kind === 'core');
    return s && c ? { phase: s.match.phase, speed: Math.hypot(...c.v) } : null;
  });
if (want('core')) {
  for (const q of ['high', 'low']) {
    {
      const ctx = await browser.newContext(desktop);
      const page = await ctx.newPage();
      watch(page);
      await page.goto(`${base}/lab/hands?test=1&shot=core&quality=${q}`);
      await startMatch(page);
      await hideUi(page);
      await page.waitForTimeout(3000);
      await shot(page, `core-${q}`);
      await ctx.close();
    }
    const { ctx, page } = await open(desktop, `quality=${q}&shot=core`);
    await startMatch(page);
    await hideUi(page);
    for (let i = 0; i < 120; i++) {
      const s = await coreState(page);
      if (s?.phase === 'playing' && s.speed > 4) break;
      await page.waitForTimeout(150);
    }
    await shot(page, `core-moving-${q}`);
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
// D09 (7C): an event's effect lasts a fraction of a second and a seek is silent, so "R5:10+1"
// seeks to tick 10, then steps one tick (its events play) and shoots ELEMENT_STEP_MS of render
// time later (default 150; the page draws frame by frame, so this is exact). ELEMENT_QUALITY picks the tier (default high) and
// ELEMENT_CAM the camera (close, the default, or broadcast: the whole field, e.g. for a goal);
// ELEMENT_VIEW="px,py,pz,tx,ty,tz" places the close camera by hand (a guard, a goal mouth), and
// ELEMENT_DEVICE=landscape or portrait shoots on a phone (iPhone 13 at 2x) instead of 1920 x 1080.
// "R9:20~12" sets the core spinning at 12 rad/s at that tick first (Physics Lab debug setter);
// "R1:150*700" plays on for 700 ms before the shot (the trail, a goal's collapse); "R3/control:71"
// replays the fixture's control variant (no reaction: e.g. the shot that hits the guard).
// ELEMENT_STRIP_MS="0,50,100,200" shoots a moment at each of those render times after its event
// instead of once (one page: a motion strip, e.g. a wielder's throw easing in and out).
if (want('elements')) {
  const elementTicks = (process.env.ELEMENT_TICKS ?? 'R6:30,R1:120,R3:90,R5:20')
    .split(',')
    .map((s) => {
      const [fxSpec, rest] = s.split(':');
      const [fx, variant = 'reaction'] = fxSpec.split('/');
      const [timed, playMs] = rest.split('*');
      const [tick, spin] = timed.split('~');
      const [t, steps] = tick.split('+');
      return [
        fx,
        variant,
        t,
        Number(steps ?? 0),
        spin === undefined ? null : Number(spin),
        playMs === undefined ? 0 : Number(playMs),
      ];
    });
  const quality = process.env.ELEMENT_QUALITY ?? 'high';
  const cam = process.env.ELEMENT_CAM ?? 'close';
  const stepMs = Number(process.env.ELEMENT_STEP_MS ?? 150);
  const strip = process.env.ELEMENT_STRIP_MS
    ? process.env.ELEMENT_STRIP_MS.split(',').map(Number)
    : null;
  const view = process.env.ELEMENT_VIEW ? `&view=${process.env.ELEMENT_VIEW}` : '';
  const deviceName = process.env.ELEMENT_DEVICE ?? 'desktop';
  const device = { desktop, landscape, portrait }[deviceName];
  if (!device) throw new Error(`ELEMENT_DEVICE: no device ${deviceName}`);
  const TICK_MS = 1000 / 30;
  const FRAME_MS = 1000 / 60;
  for (const [fx, variant, t, steps, spin, playMs] of elementTicks) {
    const ctx = await browser.newContext(device);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(
      `${base}/lab?fx=${fx}&v=${variant}&t=${t}&cam=${cam}&vectors=0&regions=0&impacts=0&quality=${quality}&test=1&frames=manual${view}`,
    );
    // At the tick asked for, with the fixture loaded (t is 0 before it is, too).
    let at = -1;
    for (let i = 0; i < 240 && at !== Number(t); i++) {
      at = await page.evaluate(() => {
        const s = window.__ffLab?.state();
        return s && !s.loading ? s.t : -1;
      });
      if (at !== Number(t)) await page.waitForTimeout(250);
    }
    if (at !== Number(t)) console.error(`${fx} ${variant}: the lab is at tick ${at}, not ${t}`);
    await page.addStyleTag({ content: '.lab-panel,.lab-tick{display:none!important}' });
    // The page draws only when asked (frames=manual), each frame at an exact render time: an
    // effect is caught at the age asked for, however slowly software GL draws. The first frames
    // compile the shaders and generate the surfaces.
    const frame = (ms) => page.evaluate((v) => window.__ffLab.frame(v), ms);
    const step = () => page.evaluate(() => window.__ffLab.step());
    // ELEMENT_WARM_FRAMES (default 6) more frames at the paused tick first: anything that eases
    // in over render time (the wielders' poses) settles before the moment.
    const warm = Number(process.env.ELEMENT_WARM_FRAMES ?? 6);
    for (let i = 0; i < warm; i++) await frame(FRAME_MS);
    // "~12": the core spinning at 12 rad/s at that tick (a debug-only setter, as a twist would).
    if (spin !== null) {
      await page.evaluate((v) => window.__ffLab.spin(v), spin);
      await frame(FRAME_MS);
    }
    // "+3": three ticks, each drawn as live play at 30 fps would draw it, and the shot
    // ELEMENT_STEP_MS of render time after the last (its events play on that step).
    for (let i = 0; i < steps; i++) {
      await step();
      if (i < steps - 1) await frame(TICK_MS);
    }
    const name = `element-${fx}${variant === 'reaction' ? '' : `-${variant}`}-t${t}${steps ? `+${steps}` : ''}${spin === null ? '' : `-spin${spin}`}${playMs ? `-play${playMs}` : ''}${quality === 'high' ? '' : `-${quality}`}${cam === 'close' ? '' : `-${cam}`}${view ? '-view' : ''}${deviceName === 'desktop' ? '' : `-${deviceName}`}`;
    if (strip && steps > 0) {
      // A motion strip: the same moment at each render time after its event.
      let elapsed = 0;
      for (const at of strip) {
        for (; elapsed < at - 1e-6; elapsed += FRAME_MS) await frame(FRAME_MS);
        await shot(page, `${name}-at${at}`);
      }
      console.log(`${fx} ${variant}: a strip of ${strip.length} frames to ${strip.at(-1)} ms`);
      await ctx.close();
      continue;
    }
    for (let ms = 0; steps > 0 && ms < stepMs; ms += FRAME_MS) await frame(FRAME_MS);
    // "*700": 700 ms of play first, a tick and a frame at a time (the trail, a goal's collapse).
    for (let i = 0; i < Math.round(playMs / TICK_MS); i++) {
      await step();
      await frame(TICK_MS);
    }
    const shown = await page.evaluate(() => window.__ffLab.state().t);
    console.log(`${fx} ${variant}: the frame shows tick ${shown}`);
    await shot(page, name);
    await ctx.close();
  }
}

await browser.close();
writeFileSync(`${outDir}/arena-stats-${tag}.json`, `${JSON.stringify(stats, null, 2)}\n`);
if (errors.length) {
  console.error('page errors:', errors);
  process.exit(1);
}
