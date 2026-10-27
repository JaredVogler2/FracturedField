/**
 * Touch-only test players: they read the public snapshot (what is on screen) and play with touch
 * only — a tap on the arena moves the force point there, a tap on PULSE casts. Taps that would
 * land on an overlay (HUD panel, buttons) are skipped, as a person would avoid them.
 *
 * - `touchAutopilot` taps with real touch events from outside the page (one page round trip per
 *   step): for flows where reaction time does not decide anything (an online match's rounds).
 * - `touchAutopilotInPage` runs inside the page and decides on every rendered frame, tapping by
 *   dispatching touch pointer events to the elements a finger would land on: for a race against
 *   the bot, where round trips on a software-rendered page would make it react frames late.
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
/** Authoritative ticks per second (snapshot ticks → seconds of play). */
const TICK_HZ = 30;
/** Seconds of play from a tap to the force point arriving and a PULSE landing. */
const TRAVEL_S = 0.3;
/** Cap on the lead, in seconds of play (a slow page must not overshoot). */
const MAX_LEAD_S = 1;
/**
 * Seconds of play the in-page player may take per decision — an attentive person's reaction. In
 * a local test run it re-paces the authority to keep within it, so how fast the test machine
 * renders never decides the race (rules and physics are unchanged).
 */
const STEP_PLAY_S = 0.1;
/** Seconds of play between two PULSE taps (its cooldown is 0.35 s). */
const PULSE_GAP_S = 0.4;

/** What one autopilot step needs from the page. */
interface Step {
  s: Snap;
  /** Where to tap to steer (null when that point is under an overlay or off screen). */
  steer: { x: number; y: number } | null;
  /** The PULSE button's centre. */
  pulse: { x: number; y: number } | null;
  /** Settled behind the core, within reach and lined up with the rival goal. */
  lined: boolean;
  /** Why not lined up: the force point is still travelling, the core is too far, or the angle. */
  miss: 'travel' | 'far' | 'angle' | null;
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
      if (s.match.phase !== 'playing' || !core)
        return { s, steer: null, pulse, lined: false, miss: null };
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
      const miss = !settled ? 'travel' : reach >= 5.5 ? 'far' : align <= 0.9 ? 'angle' : null;
      return { s, steer, pulse, lined: miss === null, miss };
    },
    { slot, leadS, goalX: GOAL_X },
  );
}

/**
 * Plays seat `slot` with real touch events until `done(snapshot)` is true. Steers behind where
 * the core is heading, on its line to the rival goal (tap there), and taps PULSE when lined up.
 * It leads the core by its own reaction time as well, as a person anticipates theirs — measured
 * in seconds of play (snapshot ticks per wall second), so a test-speed authority or a slow
 * machine changes how long a step takes, never where the player aims.
 */
export async function touchAutopilot(
  page: Page,
  slot: 0 | 1,
  done: (s: Snap) => boolean,
  timeoutMs: number,
): Promise<Snap> {
  const deadline = Date.now() + timeoutMs;
  let lastPulse = 0;
  /** Wall seconds per step, and seconds of play per wall second (both smoothed). */
  let stepS = 0.25;
  let rate = 1;
  let prev: { tick: number; at: number } | null = null;
  const stats = { steps: 0, lined: 0, pulses: 0, blocked: 0, travel: 0, far: 0, angle: 0 };
  const report = (s: Snap) =>
    console.log(
      `touch player: ${stats.steps} steps of ${Math.round(stepS * 1000)} ms ` +
        `(${(stepS * rate).toFixed(2)} s of play), ${stats.lined} lined up, ` +
        `${stats.pulses} PULSE taps; not lined: ${stats.travel} travelling, ${stats.far} far, ` +
        `${stats.angle} angle; ${stats.blocked} steers under an overlay; ` +
        `score ${s.match.score.join('-')}, ` +
        `rounds ${s.match.roundWins.join('-')}`,
    );
  while (Date.now() < deadline) {
    const t0 = Date.now();
    const r = await readStep(page, slot, Math.min(MAX_LEAD_S, stepS * rate + TRAVEL_S));
    if (!r) {
      await page.waitForTimeout(100);
      continue;
    }
    if (prev && r.s.tick > prev.tick && t0 > prev.at) {
      const measured = (r.s.tick - prev.tick) / TICK_HZ / ((t0 - prev.at) / 1000);
      rate = rate * 0.8 + Math.min(2, measured) * 0.2;
    }
    prev = { tick: r.s.tick, at: t0 };
    if (done(r.s)) {
      report(r.s);
      return r.s;
    }
    if (r.s.match.phase !== 'playing') {
      await page.waitForTimeout(120);
      continue;
    }
    stats.steps++;
    if (r.steer) await page.touchscreen.tap(r.steer.x, r.steer.y);
    else stats.blocked++;
    if (r.lined) stats.lined++;
    else if (r.miss) stats[r.miss]++;
    if (r.lined && r.pulse && Date.now() - lastPulse > 400) {
      await page.touchscreen.tap(r.pulse.x, r.pulse.y);
      lastPulse = Date.now();
      stats.pulses++;
    }
    await page.waitForTimeout(60);
    stepS = stepS * 0.7 + ((Date.now() - t0) / 1000) * 0.3;
  }
  throw new Error('touch player did not finish in time');
}

/**
 * The same player inside the page, for a race against the bot: every rendered frame it reads the
 * snapshot and taps — touch pointer events dispatched to the element a finger would land on (the
 * arena canvas, the PULSE button), whose own handlers do the rest. It takes its place behind the
 * core during the kickoff countdown, as the bot does. In a local test run it also re-paces the
 * authority so a frame stays within STEP_PLAY_S of play. Returns when seat `slot` scores or wins
 * a round, or the match ends; throws after `playSeconds` of play or `wallMs`.
 */
export async function touchAutopilotInPage(
  page: Page,
  slot: 0 | 1,
  limits: { playSeconds: number; wallMs: number },
): Promise<Snap> {
  const r = await page.evaluate(
    ({ slot, goalX, tickHz, travelS, maxLeadS, stepPlayS, pulseGapS, playSeconds, wallMs }) => {
      const hook = (
        window as unknown as {
          __ffDebug: {
            snapshot(): Snap | null;
            project(x: number, y: number, z: number): { x: number; y: number } | null;
            timeScale?(v: number): void;
          };
        }
      ).__ffDebug;
      const canvas = document.querySelector('canvas');
      const tap = (el: Element, x: number, y: number) => {
        const init: PointerEventInit = {
          pointerId: 71,
          pointerType: 'touch',
          isPrimary: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
          bubbles: true,
          cancelable: true,
          composed: true,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', init));
        el.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
      };
      const stats = { frames: 0, lined: 0, pulses: 0, blocked: 0, frameMs: 150, playPerFrame: 0 };
      const t0 = performance.now();
      let last = t0;
      let rate = 1;
      let tick0: number | null = null;
      let prev: { tick: number; at: number } | null = null;
      let asked = 0;
      let lastPulseTick = -1e9;
      return new Promise<{ s: Snap; outcome: 'done' | 'time'; stats: typeof stats }>((resolve) => {
        const frame = (now: number) => {
          stats.frameMs = stats.frameMs * 0.8 + Math.min(1000, now - last) * 0.2;
          last = now;
          const s = hook.snapshot();
          if (!s) {
            requestAnimationFrame(frame);
            return;
          }
          tick0 ??= s.tick;
          if (prev && s.tick > prev.tick && now > prev.at)
            rate =
              rate * 0.8 +
              Math.min(2, (s.tick - prev.tick) / tickHz / ((now - prev.at) / 1000)) * 0.2;
          prev = { tick: s.tick, at: now };
          stats.playPerFrame = (stats.frameMs / 1000) * rate;
          const done =
            s.match.score[slot] > 0 || s.match.roundWins[slot] > 0 || s.match.phase === 'matchEnd';
          if (done || (s.tick - tick0) / tickHz > playSeconds || now - t0 > wallMs) {
            resolve({ s, outcome: done ? 'done' : 'time', stats });
            return;
          }
          // Keep each decision within stepPlayS of play (test runs; a no-op elsewhere).
          const want = Math.min(1, Math.max(0.1, stepPlayS / (stats.frameMs / 1000)));
          if (Math.abs(want - asked) > 0.03) {
            hook.timeScale?.(want);
            asked = want;
          }
          const core = s.entities.find((e) => e.kind === 'core');
          // It gets into position during the kickoff countdown too, as the bot does (waiting for
          // play to start let the bot reach the core first at every kickoff); it casts in play.
          const live = s.match.phase === 'playing';
          if ((live || s.match.phase === 'countdown') && core && canvas) {
            if (live) stats.frames++;
            // The same decision as the out-of-page player (readStep).
            const leadS = Math.min(maxLeadS, stats.playPerFrame + travelS);
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
            if (p && document.elementFromPoint(p.x, p.y) === canvas) tap(canvas, p.x, p.y);
            else stats.blocked++;
            const m = s.players[slot]!.m;
            const px = cx - m[0];
            const pz = cz - m[1];
            const reach = Math.hypot(px, pz);
            const align = (px * dx + pz * dz) / ((reach || 1) * d);
            const lined =
              live && Math.hypot(m[0] - tx, m[1] - tz) < 1.0 && reach < 5.5 && align > 0.9;
            const button = document.querySelector('[data-testid="tc-pulse"]');
            if (lined) stats.lined++;
            if (lined && button && s.tick - lastPulseTick > pulseGapS * tickHz) {
              const b = button.getBoundingClientRect();
              tap(button, b.x + b.width / 2, b.y + b.height / 2);
              lastPulseTick = s.tick;
              stats.pulses++;
            }
          }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
    },
    {
      slot,
      goalX: GOAL_X,
      tickHz: TICK_HZ,
      travelS: TRAVEL_S,
      maxLeadS: MAX_LEAD_S,
      stepPlayS: STEP_PLAY_S,
      pulseGapS: PULSE_GAP_S,
      ...limits,
    },
  );
  const st = r.stats;
  console.log(
    `touch player (in page): ${st.frames} frames of ${Math.round(st.frameMs)} ms ` +
      `(${st.playPerFrame.toFixed(2)} s of play each), ${st.lined} lined up, ` +
      `${st.pulses} PULSE taps, ${st.blocked} steers under an overlay; ` +
      `score ${r.s.match.score.join('-')}, rounds ${r.s.match.roundWins.join('-')}`,
  );
  if (r.outcome === 'time') throw new Error('touch player did not finish in time');
  return r.s;
}
