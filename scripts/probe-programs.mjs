#!/usr/bin/env node
/**
 * Every shader program a page links, in order, with three's SHADER_NAME and the defines that set
 * it apart (PR #3, round 3: the core's light recompiled every lit material when it appeared). A
 * material compiled twice shows up twice with slightly different sources. Software WebGL, so
 * counts only, never timings that mean anything for a GPU.
 *
 * usage: node scripts/probe-programs.mjs [url] [seconds]
 */
import { chromium } from '@playwright/test';

const [url = 'http://127.0.0.1:4173/?mode=bot&difficulty=easy&test=1&quality=low', secs = '60'] =
  process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
await ctx.addInitScript(() => {
  const programs = [];
  window.__programs = programs;
  const sources = new WeakMap();
  const gl = WebGL2RenderingContext.prototype;
  const shaderSource = gl.shaderSource;
  gl.shaderSource = function (shader, source) {
    sources.set(shader, source);
    return shaderSource.call(this, shader, source);
  };
  const attachShader = gl.attachShader;
  gl.attachShader = function (program, shader) {
    const list = sources.get(program) ?? [];
    list.push(sources.get(shader) ?? '');
    sources.set(program, list);
    return attachShader.call(this, program, shader);
  };
  const linkProgram = gl.linkProgram;
  gl.linkProgram = function (program) {
    const [vs = '', fs = ''] = sources.get(program) ?? [];
    const all = vs + fs;
    const name = /#define SHADER_NAME (\S+)/.exec(all)?.[1] ?? '(unnamed)';
    const defines = [
      ...new Set(
        all.match(
          /#define (USE_\w+|INSTANCING\w*|STANDARD|PHYSICAL|FLAT_SHADED|DOUBLE_SIDED)\b/g,
        ) ?? [],
      ),
    ]
      .map((d) => d.replace('#define ', ''))
      .filter((d) => !/^USE_(SHADOWMAP|SIZEATTENUATION)$/.test(d));
    programs.push({ at: Math.round(performance.now()), name, defines, chars: all.length });
    return linkProgram.call(this, program);
  };
});
const page = await ctx.newPage();
await page.goto(url);
await page.waitForTimeout(Number(secs) * 1000);
const programs = await page.evaluate(() => window.__programs);
console.log(`${programs.length} programs linked in ${secs} s`);
for (const p of programs)
  console.log(
    `  ${String(p.at).padStart(6)} ms  ${p.name} [${p.defines.join(' ')}] ${p.chars} chars`,
  );
await browser.close();
