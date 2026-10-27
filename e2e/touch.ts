/**
 * Touch-only test player: reads the public snapshot (what is on screen) and plays with real touch
 * events only — a tap on the arena moves the force point there, a tap on PULSE casts. Taps that
 * would land on an overlay (HUD panel, buttons) are skipped, as a person would avoid them.
 */
import { devices, type BrowserContextOptions, type Page } from '@playwright/test';
import { project, snapshot, type Snap } from './helpers';

/** A phone held in landscape: touch screen, coarse pointer, no camera permission, no sensors. */
export const PHONE_LANDSCAPE: BrowserContextOptions = {
  ...devices['iPhone 13'],
  viewport: { width: 844, height: 390 },
  permissions: [],
};

export const PHONE_PORTRAIT: BrowserContextOptions = {
  ...devices['iPhone 13'],
  permissions: [],
};

const GOAL_X = 21.8;
/** Seconds to lead the moving core by (tap → intent → force point travel), as a person would. */
const LEAD_S = 0.4;

/** True when the point is on the 3D canvas (not under a HUD panel or a button). */
const onArena = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.tagName === 'CANVAS', [x, y]);

/**
 * Plays seat `slot` with touch until `done(snapshot)` is true. Steers behind where the core is
 * heading, on its line to the rival goal (tap there), and taps PULSE when lined up.
 */
export async function touchAutopilot(
  page: Page,
  slot: 0 | 1,
  done: (s: Snap) => boolean,
  timeoutMs: number,
): Promise<Snap> {
  const goalX = slot === 0 ? GOAL_X : -GOAL_X;
  const deadline = Date.now() + timeoutMs;
  let lastPulse = 0;
  while (Date.now() < deadline) {
    const s = await snapshot(page);
    if (!s) {
      await page.waitForTimeout(100);
      continue;
    }
    if (done(s)) return s;
    if (s.match.phase !== 'playing') {
      await page.waitForTimeout(120);
      continue;
    }
    const core = s.entities.find((e) => e.kind === 'core')!;
    const cx = Math.max(-20, Math.min(20, core.p[0] + core.v[0] * LEAD_S));
    const cz = Math.max(-11.5, Math.min(11.5, core.p[2] + core.v[2] * LEAD_S));
    const dx = goalX - cx;
    const dz = -cz;
    const d = Math.hypot(dx, dz) || 1;
    const bx = cx - (dx / d) * 1.4;
    const tx = slot === 0 ? Math.min(1.9, bx) : Math.max(-1.9, bx);
    const tz = cz - (dz / d) * 1.4;
    const p = await project(page, tx, 1.1, tz);
    if (p && (await onArena(page, p.x, p.y))) await page.touchscreen.tap(p.x, p.y);
    const m = s.players[slot]!.m;
    const px = cx - m[0];
    const pz = cz - m[1];
    const reach = Math.hypot(px, pz);
    const align = (px * dx + pz * dz) / ((reach || 1) * d);
    const settled = Math.hypot(m[0] - tx, m[1] - tz) < 1.0;
    if (settled && reach < 5.5 && align > 0.9 && Date.now() - lastPulse > 400) {
      await page.getByTestId('tc-pulse').tap();
      lastPulse = Date.now();
    }
    await page.waitForTimeout(60);
  }
  throw new Error('touch player did not finish in time');
}
