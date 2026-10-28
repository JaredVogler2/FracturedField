#!/usr/bin/env node
/**
 * Shader compatibility probe (D09: "test shader compatibility in Chrome and Safari"). Opens the
 * game's views in one Playwright engine and checks every shader the page compiles and every
 * program it links (COMPILE_STATUS / LINK_STATUS, with the driver's log on a failure), along with
 * console errors and page errors. The views: a bot match on each tier, and the Physics Lab's
 * reaction fixtures at the moment their effects are on screen, on high (drawn frame by frame).
 * Counts and errors only; nothing here is a timing.
 *
 * usage: node scripts/probe-shaders.mjs [chromium|webkit|firefox] [base-url]
 *
 * `webkit` on macOS is Playwright's build of the engine Safari uses; on Linux it is WebKit's own
 * port, with whatever GL the machine offers (software in a container), so it checks WebKit's
 * WebGL front end and shader validation, not Safari's GPU path (headless it runs the WPE build:
 * PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 spares the GTK libraries it does not use). Exits 1
 * on any failure.
 */
import { chromium, firefox, webkit } from '@playwright/test';

const [engineName = 'chromium', base = 'http://127.0.0.1:4173'] = process.argv.slice(2);
const engine = { chromium, firefox, webkit }[engineName];
if (!engine) {
  console.error('usage: node scripts/probe-shaders.mjs [chromium|webkit|firefox] [base-url]');
  process.exit(2);
}
const MATCH_SECONDS = Number(process.env.PROBE_MATCH_SECONDS ?? 25);
// The fixture moments of the D09 evidence, plus the lodestone (R4) for the magnet's flux.
const MOMENTS = (
  process.env.PROBE_MOMENTS ?? 'R1:60,R3:40,R4:20,R5:11+1,R6:40,R7:18,R8:5+1,R9:20,R10:28+1'
)
  .split(',')
  .map((m) => {
    const [, fx, t, steps] = /^(R\d+):(\d+)(?:\+(\d+))?$/.exec(m) ?? [];
    if (!fx) throw new Error(`PROBE_MOMENTS: cannot read ${m}`);
    return { fx, t: Number(t), steps: Number(steps ?? 0) };
  });

const browser = await engine.launch(
  engineName === 'chromium'
    ? { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
    : {},
);
console.log(`${engineName} ${browser.version()}`);

/** Wraps compileShader / linkProgram on both WebGL contexts to check each result at once. */
const hook = () => {
  const log = { gl: null, contexts: { asked: 0, made: 0 }, shaders: 0, programs: 0, failures: [] };
  window.__probe = log;
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = getContext.call(this, type, ...rest);
    if (/webgl/.test(type)) {
      log.contexts.asked++;
      if (c) log.contexts.made++;
    }
    return c;
  };
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const compile = proto.compileShader;
    proto.compileShader = function (shader) {
      compile.call(this, shader);
      log.shaders++;
      if (!log.gl) {
        const info = this.getExtension('WEBGL_debug_renderer_info');
        log.gl = {
          version: this.getParameter(this.VERSION),
          glsl: this.getParameter(this.SHADING_LANGUAGE_VERSION),
          renderer: this.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : this.RENDERER),
        };
      }
      if (!this.getShaderParameter(shader, this.COMPILE_STATUS) && !this.isContextLost()) {
        const src = this.getShaderSource(shader) ?? '';
        log.failures.push({
          what: 'compile',
          name: /#define SHADER_NAME (\S+)/.exec(src)?.[1] ?? '(unnamed)',
          info: this.getShaderInfoLog(shader),
        });
      }
    };
    const link = proto.linkProgram;
    proto.linkProgram = function (program) {
      link.call(this, program);
      log.programs++;
      if (!this.getProgramParameter(program, this.LINK_STATUS) && !this.isContextLost()) {
        log.failures.push({ what: 'link', info: this.getProgramInfoLog(program) });
      }
    };
  }
};

let failed = false;
/** One view in a fresh browser context: what it compiled and linked, and what went wrong. */
const visit = async (url, drive) => {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await ctx.addInitScript(hook);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 400));
  });
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('crash', () => errors.push('the page crashed'));
  try {
    await page.goto(url);
    await drive(page);
  } catch (e) {
    errors.push(`probe: ${e instanceof Error ? e.message : String(e)}`);
  }
  const log = await page
    .evaluate(() => window.__probe ?? null)
    .catch((e) => {
      errors.push(`probe: reading the page: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
  await ctx.close();
  return { log, errors };
};
const probe = async (label, url, drive) => {
  // A view that hands back no data at all (no hook, no context) says nothing about its shaders:
  // the machine or the harness dropped it (a software GL device still releasing the last view,
  // or the probe's script missing from the page, seen in Chromium only). Visit it again, up to
  // three times, and say so; a failed compile or link is never retried.
  let log;
  let errors;
  let visits = 0;
  do {
    ({ log, errors } = await visit(url, drive));
    visits++;
  } while (!log?.gl && errors.length === 0 && visits < 3);
  const note = visits > 1 ? ` (visit ${visits}: the earlier ones returned no data)` : '';
  const bad = !log || !log.gl || log.failures.length > 0 || errors.length > 0;
  failed ||= bad;
  console.log(
    `${bad ? 'FAIL' : 'ok  '} ${label}: ${log?.shaders ?? 0} shaders, ${log?.programs ?? 0} programs` +
      (!log
        ? ' (no data from the page)'
        : log.gl
          ? ''
          : ` (no WebGL context: ${log.contexts.made} of ${log.contexts.asked} made)`) +
      (log?.failures.length ? `, ${log.failures.length} failed` : '') +
      (errors.length ? `, ${errors.length} console/page errors` : '') +
      note,
  );
  if (log?.gl && label.startsWith('match low')) console.log(`     ${JSON.stringify(log.gl)}`);
  for (const f of log?.failures ?? []) console.log(`     ${f.what} ${f.name ?? ''}: ${f.info}`);
  for (const e of errors) console.log(`     ${e}`);
};

for (const q of ['low', 'medium', 'high']) {
  await probe(`match ${q}`, `${base}/?mode=bot&difficulty=easy&test=1&quality=${q}`, (page) =>
    page.waitForTimeout(MATCH_SECONDS * 1000),
  );
}
for (const { fx, t, steps } of MOMENTS) {
  await probe(
    `lab ${fx}:${t}${steps ? `+${steps}` : ''} high`,
    `${base}/lab?fx=${fx}&t=${t}&cam=close&quality=high&test=1&frames=manual`,
    async (page) => {
      let at = -1;
      for (let i = 0; i < 240 && at !== t; i++) {
        at = await page.evaluate(() => {
          const s = window.__ffLab?.state();
          return s && !s.loading ? s.t : -1;
        });
        if (at !== t) await page.waitForTimeout(250);
      }
      if (at !== t) throw new Error(`the lab is at tick ${at}, not ${t}`);
      const frame = () => page.evaluate(() => window.__ffLab.frame(1000 / 60));
      for (let i = 0; i < 4; i++) await frame();
      for (let i = 0; i < steps; i++) {
        await page.evaluate(() => window.__ffLab.step());
        await frame();
      }
      for (let i = 0; i < 4; i++) await frame();
    },
  );
}
await browser.close();
process.exit(failed ? 1 : 0);
