/**
 * Touch-only test player: reads the public snapshot (what is on screen) and plays with real touch
 * events only — a tap on the arena moves the force point there, a tap on PULSE casts. Taps that
 * would land on an overlay (HUD panel, buttons) are skipped, as a person would avoid them.
 */
import { devices, type BrowserContextOptions, type Page } from '@playwright/test';
import type { Snap } from './helpers';

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
/** Cap on the extra lead for the player's own step time (a slow page must not overshoot). */
const MAX_EXTRA_LEAD_S = 0.5;

/** What one autopilot step needs from the page. */
interface Step {
  s: Snap;
  /** Where to tap to steer (null when that point is under an overlay or off screen). */
  steer: { x: number; y: number } | null;
  /** The PULSE button's centre. */
  pulse: { x: number; y: number } | null;
  /** Settled behind the core, within reach and lined up with the rival goal. */
  lined: boolean;
}

/**
 * Reads everything one step needs in a single page round trip. On a software-rendered page each
 * round trip waits for a rendered frame, so separate snapshot, projection and hit-test reads —
 * plus a locator tap's actionability waits (two stable animation frames) — made the player's
 * reaction several frames long, and on a slow runner it lost every race to the bot.
 */
function readStep(page: Page, slot: 0 | 1, leadS: number): Promise<Step | null> {
  return page.evaluate(
    ({ slot, leadS, goalX }) => {
      const hook = (
        window as Window & {
          __ffDebug?: {
            snapshot(): Snap | null;
            project(x: number, y: number, z: number): { x: number; y: number } | null;
          };
        }
      ).__ffDebug;
      const s = hook?.snapshot() ?? null;
      if (!hook || !s) return null;
      const r = document.querySelector('[data-testid="tc-pulse"]')?.getBoundingClientRect();
      const pulse = r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      const core = s.entities.find((e) => e.kind === 'core');
      if (s.match.phase !== 'playing' || !core) return { s, steer: null, pulse, lined: false };
      // Steer behind where the core is heading, on its line to the rival goal.
      const gx = slot === 0 ? goalX : -goalX;
      const cx = Math.max(-20, Math.min(20, core.p[0] + core.v[0] * leadS));
      const cz = Math.max(-11.5, Math.min(11.5, core.p[2] + core.v[2] * leadS));
      const dx = gx - cx;
      const dz = -cz;
      const d = Math.hypot(dx, dz) || 1;
      const bx = cx - (dx / d) * 1.4;
      const tx = slot === 0 ? Math.min(1.9, bx) : Math.max(-1.9, bx);
      const tz = cz - (dz / d) * 1.4;
      const p = hook.project(tx, 1.1, tz);
      // A person avoids tapping on an overlay (HUD panel, button): skip that step.
      const steer = p && document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS' ? p : null;
      const m = s.players[slot]!.m;
      const px = cx - m[0];
      const pz = cz - m[1];
      const reach = Math.hypot(px, pz);
      const align = (px * dx + pz * dz) / ((reach || 1) * d);
      const settled = Math.hypot(m[0] - tx, m[1] - tz) < 1.0;
      return { s, steer, pulse, lined: settled && reach < 5.5 && align > 0.9 };
    },
    { slot, leadS, goalX: GOAL_X },
  );
}

/**
 * Plays seat `slot` with touch until `done(snapshot)` is true. Steers behind where the core is
 * heading, on its line to the rival goal (tap there), and taps PULSE when lined up. It leads the
 * core by its own step time as well, as a person anticipates their reaction time.
 */
export async function touchAutopilot(
  page: Page,
  slot: 0 | 1,
  done: (s: Snap) => boolean,
  timeoutMs: number,
): Promise<Snap> {
  const deadline = Date.now() + timeoutMs;
  let lastPulse = 0;
  let stepS = 0.25;
  while (Date.now() < deadline) {
    const t0 = Date.now();
    const r = await readStep(page, slot, LEAD_S + Math.min(stepS, MAX_EXTRA_LEAD_S));
    if (!r) {
      await page.waitForTimeout(100);
      continue;
    }
    if (done(r.s)) return r.s;
    if (r.s.match.phase !== 'playing') {
      await page.waitForTimeout(120);
      continue;
    }
    if (r.steer) await page.touchscreen.tap(r.steer.x, r.steer.y);
    if (r.lined && r.pulse && Date.now() - lastPulse > 400) {
      await page.touchscreen.tap(r.pulse.x, r.pulse.y);
      lastPulse = Date.now();
    }
    await page.waitForTimeout(60);
    stepS = stepS * 0.7 + ((Date.now() - t0) / 1000) * 0.3;
  }
  throw new Error('touch player did not finish in time');
}
