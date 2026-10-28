/**
 * D09 failure criteria (7C): no WebGL context leak after ten rematches. Every match started from
 * the menu, and every return to it, mounts a new canvas with its own WebGL context; the view being
 * left must release its context, or contexts pile up until the browser drops the oldest ("Too
 * many active WebGL contexts") and the arena goes black. The page's contexts are counted as they
 * are made, with the ones still alive (neither lost nor collected) after every switch: exactly
 * one, the view on screen. Ten matches from the menu make twenty-one contexts, more than the
 * sixteen a page may keep, so the browser would also have had to drop one by the end.
 * (A rematch inside a match keeps its canvas: only the menu round trip makes contexts.)
 */
import { expect, test, type Page } from '@playwright/test';
import { debug, snapshot } from './helpers';

const MATCHES = 10;

interface GlWindow {
  __gl: () => { made: number; live: number };
}

/** Counts the WebGL contexts the page makes; weak references, so counting keeps none alive. */
async function countContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const made: WeakRef<WebGLRenderingContext | WebGL2RenderingContext>[] = [];
    const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')!
      .value as (this: HTMLCanvasElement, ...args: unknown[]) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, ...args: unknown[]) {
        const ctx = getContext.apply(this, args);
        const gl = ctx instanceof WebGLRenderingContext || ctx instanceof WebGL2RenderingContext;
        if (gl && !made.some((r) => r.deref() === ctx)) made.push(new WeakRef(ctx));
        return ctx;
      },
    });
    (window as unknown as GlWindow).__gl = () => ({
      made: made.length,
      live: made.filter((r) => {
        const c = r.deref();
        return c !== undefined && !c.isContextLost();
      }).length,
    });
  });
}

const contexts = (page: Page) => page.evaluate(() => (window as unknown as GlWindow).__gl());

test('ten matches from the menu and back: each view releases its WebGL context', async ({
  page,
}) => {
  test.setTimeout(840_000);
  await page.setViewportSize({ width: 640, height: 360 });
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/too many active webgl contexts|context lost|CONTEXT_LOST/i.test(text))
      problems.push(`${m.type()}: ${text}`);
  });
  await countContexts(page);
  await page.goto('/?test=1&quality=low');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => contexts(page), { timeout: 60_000 }).toEqual({ made: 1, live: 1 });
  for (let i = 1; i <= MATCHES; i++) {
    await page.getByTestId('play-bot').click({ timeout: 60_000 });
    await page.getByTestId('start-match').click({ timeout: 60_000 });
    await expect
      .poll(async () => (await snapshot(page))?.match.phase, { timeout: 60_000 })
      .toMatch(/^(countdown|playing)$/);
    // The menu's context went with the menu: only the match's is alive.
    await expect.poll(() => contexts(page)).toEqual({ made: 2 * i, live: 1 });
    await page.getByRole('button', { name: 'Pause' }).click({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Quit to menu' }).click({ timeout: 60_000 });
    await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => contexts(page)).toEqual({ made: 2 * i + 1, live: 1 });
  }
  // The menu's live arena (the attract match) still draws after all of that.
  await expect
    .poll(async () => (await debug(page, 'renderStats'))?.drawCalls ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(20);
  expect(problems).toEqual([]);
});
