import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { throttle } from './throttle';

export interface Snap {
  tick: number;
  entities: {
    id: number;
    kind: string;
    owner: number;
    p: [number, number, number];
    v: [number, number, number];
    /** The core's deliberate spin (rad/s about +y), when it has one (ADR-0009). */
    s?: number;
  }[];
  players: {
    m: [number, number];
    energy: number;
    connected: boolean;
    hold: string | null;
    /** The body this seat's hand holds (-1: none). */
    grasp: number;
  }[];
  match: {
    phase: string;
    score: [number, number];
    roundWins: [number, number];
    round: number;
    paused: boolean;
  };
}

interface DebugHook {
  snapshot(): Snap | null;
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** The intents this page sent (bounded, numbered log): seat, source and action, no aim. */
  intents(): { n: number; slot: number; source: string; action: string; phase: string }[];
  /** Authority verdicts, numbered (see mark()). */
  acks(): { n: number; slot: number; action?: string; accepted: boolean; reason?: string }[];
  mark(): number;
  slot(): 0 | 1 | null;
  transport(): string;
  lobby(): { phase: string; seats: { connected: boolean; ready: boolean }[] } | null;
  matchEnd(): {
    winner: number;
    digest: string;
    reason: string;
    roundWins: [number, number];
  } | null;
  /** Renderer counters of the last frame, the rendering tier and texture-generation cost. */
  renderStats(): {
    drawCalls: number;
    triangles: number;
    programs: number;
    tier: 'low' | 'medium' | 'high';
    adaptive: boolean;
    /** Every tier rendered so far, with when it began (page performance.now() ms). */
    tierLog: { tier: 'low' | 'medium' | 'high'; at: number }[];
    surfaces: { generated: number; ms: number };
  };
}

type Win = Window & { __ffDebug?: DebugHook };

export const snapshot = (page: Page) =>
  page.evaluate(() => (window as Win).__ffDebug?.snapshot() ?? null);

export const project = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(([a, b, c]) => (window as Win).__ffDebug!.project(a!, b!, c!), [x, y, z]);

/** Several world points to screen in one round trip (a slow page answers once per frame). */
export const projectAll = (page: Page, points: [number, number, number][]) =>
  page.evaluate(
    (pts) => pts.map(([x, y, z]) => (window as Win).__ffDebug!.project(x, y, z)),
    points,
  );

export const debug = <K extends keyof DebugHook>(page: Page, key: K) =>
  page.evaluate((k) => {
    const hook = (window as Win).__ffDebug;
    return hook ? (hook[k] as () => unknown)() : null;
  }, key) as Promise<ReturnType<DebugHook[K]> | null>;

const GOAL_X = 21.8;

/** The force point's travel time to a lineup (s), the lead's floor (as e2e/touch.ts). */
const TRAVEL_S = 0.3;
const MAX_LEAD_S = 1;
const PULSE_GAP_S = 0.4;
const TICK_HZ = 30;

/**
 * A scripted human stand-in on the mouse: it reads the public snapshot (what is on screen), keeps
 * the pointer behind the core on its line to the rival goal and clicks to PULSE once lined up.
 * `slot` 0 attacks +X, slot 1 attacks -X (the game clamps each force point to its own half).
 *
 * It decides inside the page on every rendered frame, as the touch and camera players do, and
 * leads the core by a frame plus the force point's travel. The out-of-page version decided every
 * few frames, through round trips, on a core that had moved since: on a busy runner most of its
 * shots missed, and a round without a goal goes to whichever half the core is in when the golden
 * rift ends, so it lost rounds to an idle rival (PR #3, round 3; a headless model of the duel had
 * it winning 2–0 in 32 of 40 matches, this player in 40 of 40). The pointer events go to the
 * element under the point, as a real mouse's would (the HUD can cover the arena).
 */
export async function mouseAutopilotInPage(
  page: Page,
  slot: 0 | 1,
  wallMs: number,
): Promise<'goal' | 'end'> {
  const r = await page.evaluate(
    ({ slot, goalX, tickHz, travelS, maxLeadS, pulseGapS, wallMs }) => {
      const hook = (
        window as unknown as {
          __ffDebug: {
            snapshot(): Snap | null;
            project(x: number, y: number, z: number): { x: number; y: number } | null;
          };
        }
      ).__ffDebug;
      const canvas = document.querySelector('canvas');
      const mouse = (type: string, x: number, y: number, buttons: number) => {
        const el = document.elementFromPoint(x, y);
        if (!el || el !== canvas) return false;
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        return true;
      };
      const t0 = performance.now();
      let last = t0;
      let frameMs = 150;
      let goalsAtStart: number | null = null;
      let lastPulseTick = -1e9;
      return new Promise<'goal' | 'end' | 'time'>((resolve) => {
        const frame = (now: number) => {
          frameMs = frameMs * 0.8 + Math.min(1000, now - last) * 0.2;
          last = now;
          const s = hook.snapshot();
          if (!s) {
            requestAnimationFrame(frame);
            return;
          }
          // Each round starts 0-0; a goal shows as score[slot] > 0 during the goal pause.
          goalsAtStart ??= s.match.score[slot];
          if (s.match.score[slot] > goalsAtStart) return resolve('goal');
          if (s.match.phase === 'matchEnd') return resolve('end');
          if (now - t0 > wallMs) return resolve('time');
          const core = s.entities.find((e) => e.kind === 'core');
          const live = s.match.phase === 'playing';
          // In position during the kickoff countdown too; it clicks only in play.
          if ((live || s.match.phase === 'countdown') && core) {
            const leadS = Math.min(maxLeadS, frameMs / 1000 + travelS);
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
            if (p && mouse('pointermove', p.x, p.y, 0)) {
              const m = s.players[slot]!.m;
              const px = cx - m[0];
              const pz = cz - m[1];
              const reach = Math.hypot(px, pz);
              const align = (px * dx + pz * dz) / ((reach || 1) * d);
              const lined =
                live && Math.hypot(m[0] - tx, m[1] - tz) < 1.0 && reach < 5.5 && align > 0.9;
              if (lined && s.tick - lastPulseTick > pulseGapS * tickHz) {
                mouse('pointerdown', p.x, p.y, 1);
                mouse('pointerup', p.x, p.y, 0);
                lastPulseTick = s.tick;
              }
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
      pulseGapS: PULSE_GAP_S,
      wallMs,
    },
  );
  if (r === 'time') throw new Error('autopilot did not score in time');
  return r;
}

const VIEW = { width: 960, height: 540 };

/** Host creates a room, a second browser context (another "device") joins by invite link. */
export async function openRoom(
  browser: Browser,
  opts: {
    beforeNavigate?: (host: Page, guest: Page) => void;
    /** Device emulation for the guest (e.g. a phone with touch and no camera permission). */
    guest?: BrowserContextOptions;
    /** Extra query for both pages (e.g. `&hands=0` for the camera's sign scheme). */
    query?: string;
    /** Short test rounds (default); false plays the standard match clock. */
    fast?: boolean;
    /** Both pages' viewport (default 960 × 540). */
    viewport?: { width: number; height: number };
  } = {},
) {
  const q = opts.query ?? '';
  const view = opts.viewport ?? VIEW;
  const ctxA = await browser.newContext({ viewport: view });
  const ctxB = await browser.newContext(opts.guest ?? { viewport: view });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await throttle(a);
  await throttle(b);
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(`A: ${e.message}`));
  b.on('pageerror', (e) => errors.push(`B: ${e.message}`));
  opts.beforeNavigate?.(a, b);

  // Host creates a room (fast test rules are honoured by development room services only).
  await a.goto(`/?${opts.fast === false ? '' : 'fast=1&'}test=1&quality=low${q}`);
  await a.getByTestId('play-online').click();
  await expect(a.getByTestId('room-service-health')).toHaveClass(/ok/);
  await a.getByTestId('create-room').click();
  await expect(a.getByTestId('online-lobby')).toBeVisible();
  const code = (await a.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/);
  await expect(a).toHaveURL(new RegExp(`room=${code}`));

  // Guest opens the invite link on another "device" and joins with one click.
  await b.goto(`/?room=${code}&test=1&quality=low${q}`);
  await expect(b.getByTestId('room-code-input')).toHaveValue(code);
  await b.getByTestId('join-room').click();
  await expect(b.getByTestId('online-lobby')).toBeVisible();
  await expect.poll(() => debug(a, 'slot')).toBe(0);
  await expect.poll(() => debug(b, 'slot')).toBe(1);
  await expect(a.getByTestId('lobby-seat-1').locator('.seat-status')).toHaveText('not ready');
  await expect(b.getByTestId('lobby-seat-0').locator('.seat-status')).toHaveText('not ready');
  return { ctxA, ctxB, a, b, code, errors };
}

/** Both seats press READY and wait until the authoritative match is playing. */
export async function readyUp(
  a: Page,
  b: Page,
  opts: { hostAlreadyReady?: boolean } = {},
): Promise<void> {
  if (!opts.hostAlreadyReady) await a.getByTestId('ready').click();
  await expect(b.getByTestId('lobby-seat-0').locator('.seat-status')).toHaveText('ready');
  await b.getByTestId('ready').click();
  for (const p of [a, b]) {
    await expect
      .poll(async () => (await snapshot(p))?.match.phase, { timeout: 30_000 })
      .toBe('playing');
    await expect(p.getByTestId('online-lobby')).toBeHidden();
  }
}
