import { expect, type Browser, type Page } from '@playwright/test';

export interface Snap {
  tick: number;
  entities: {
    kind: string;
    owner: number;
    p: [number, number, number];
    v: [number, number, number];
  }[];
  players: { m: [number, number]; energy: number; connected: boolean; hold: string | null }[];
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
  slot(): 0 | 1 | null;
  transport(): string;
  lobby(): { phase: string; seats: { connected: boolean; ready: boolean }[] } | null;
  matchEnd(): {
    winner: number;
    digest: string;
    reason: string;
    roundWins: [number, number];
  } | null;
}

type Win = Window & { __ffDebug?: DebugHook };

export const snapshot = (page: Page) =>
  page.evaluate(() => (window as Win).__ffDebug?.snapshot() ?? null);

export const project = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(([a, b, c]) => (window as Win).__ffDebug!.project(a!, b!, c!), [x, y, z]);

export const debug = <K extends keyof DebugHook>(page: Page, key: K) =>
  page.evaluate((k) => {
    const hook = (window as Win).__ffDebug;
    return hook ? (hook[k] as () => unknown)() : null;
  }, key) as Promise<ReturnType<DebugHook[K]> | null>;

const GOAL_X = 21.8;

/**
 * A scripted human stand-in that only uses the real mouse: it reads the public snapshot (what is
 * on screen), moves the pointer behind the core on its line to the rival goal and clicks to PULSE.
 * `slot` 0 attacks +X, slot 1 attacks -X (the game clamps each force point to its own half).
 */
export async function autopilotUntilGoal(
  page: Page,
  slot: 0 | 1,
  timeoutMs: number,
): Promise<'goal' | 'end'> {
  const deadline = Date.now() + timeoutMs;
  const goalX = slot === 0 ? GOAL_X : -GOAL_X;
  let goalsAtStart: number | null = null;
  while (Date.now() < deadline) {
    const s = await snapshot(page);
    if (!s) {
      await page.waitForTimeout(100);
      continue;
    }
    // Each round starts 0-0; a goal shows as score[slot] > 0 during the goal pause.
    const goals = s.match.score[slot];
    goalsAtStart ??= goals;
    if (goals > goalsAtStart) return 'goal';
    if (s.match.phase === 'matchEnd') return 'end';
    const core = s.entities.find((e) => e.kind === 'core')!;
    const [cx, , cz] = core.p;
    const dx = goalX - cx;
    const dz = -cz;
    const d = Math.hypot(dx, dz) || 1;
    const bx = cx - (dx / d) * 1.4;
    const tx = slot === 0 ? Math.min(1.9, bx) : Math.max(-1.9, bx);
    const tz = cz - (dz / d) * 1.4;
    const p = await project(page, tx, 1.1, tz);
    if (p) await page.mouse.move(p.x, p.y);
    const m = s.players[slot]!.m;
    const px = cx - m[0];
    const pz = cz - m[1];
    const reach = Math.hypot(px, pz);
    const align = (px * dx + pz * dz) / ((reach || 1) * d);
    const settled = Math.hypot(m[0] - tx, m[1] - tz) < 1.0;
    if (s.match.phase === 'playing' && settled && reach < 5.5 && align > 0.9 && p)
      await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(70);
  }
  throw new Error('autopilot did not score in time');
}

const VIEW = { width: 960, height: 540 };

/** Host creates a room, a second browser context (another "device") joins by invite link. */
export async function openRoom(
  browser: Browser,
  opts: { beforeNavigate?: (host: Page, guest: Page) => void } = {},
) {
  const ctxA = await browser.newContext({ viewport: VIEW });
  const ctxB = await browser.newContext({ viewport: VIEW });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(`A: ${e.message}`));
  b.on('pageerror', (e) => errors.push(`B: ${e.message}`));
  opts.beforeNavigate?.(a, b);

  // Host creates a room (fast test rules are honoured by development room services only).
  await a.goto('/?fast=1&test=1&quality=low');
  await a.getByTestId('play-online').click();
  await expect(a.getByTestId('room-service-health')).toHaveClass(/ok/);
  await a.getByTestId('create-room').click();
  await expect(a.getByTestId('online-lobby')).toBeVisible();
  const code = (await a.getByTestId('room-code').textContent())!.trim();
  expect(code).toMatch(/^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/);
  await expect(a).toHaveURL(new RegExp(`room=${code}`));

  // Guest opens the invite link on another "device" and joins with one click.
  await b.goto(`/?room=${code}&test=1&quality=low`);
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
