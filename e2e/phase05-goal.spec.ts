/**
 * Phase 05 gate (D05): a camera player intentionally moves the core, scores, and plays on after a
 * rematch — with gesture input only. The "player" is a closed-loop stand-in for a person: it reads
 * the public snapshot (what is on screen), moves a synthetic hand in front of the camera
 * controller, and pushes its palm toward the camera to PULSE. Its landmarks go through the real
 * gesture engine and camera controller and become ordinary intents that the authority validates.
 * No keyboard, mouse or touch input is used. (Synthetic landmarks, not a live person.)
 */
import { expect, test, type Page } from '@playwright/test';
import { cameraActive, drive, learnAim, log, playing, snap, type AimMap } from './camera';

const GOAL_X = 21.8;
const OPEN = { size: 0.15, shape: 'open' } as const;
/** Seconds to lead the moving core by (aim smoothing + intent + force point travel). */
const LEAD_S = 0.5;
/** How long the palm stays pushed toward the camera. */
const PUSH_MS = 500;

/**
 * Steers behind the core on its line to the rival goal and pushes the palm when lined up. The
 * loop runs inside the page so it reacts every rendered frame, like a person watching the screen;
 * it reads only the public snapshot and moves only the synthetic hand.
 */
function cameraAutopilotUntilGoal(
  page: Page,
  map: AimMap,
  timeoutMs: number,
): Promise<{ outcome: 'goal' | 'end' | 'timeout'; pushes: number }> {
  return page.evaluate(
    async ({ map, timeoutMs, goalX, leadS, pushMs }) => {
      interface S {
        match: { phase: string; score: [number, number] };
        players: { m: [number, number] }[];
        entities: { kind: string; p: number[]; v?: number[] }[];
      }
      const w = window as unknown as {
        __ffDebug: { snapshot(): S | null };
        __ffCamera: { drive(p: unknown): Promise<void> };
      };
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const hand = (x: number, z: number) => {
        const dx = x - map.w0[0];
        const dz = z - map.w0[1];
        // Stay inside the default calibrated range (x 0.22–0.78, y 0.22–0.85 of the frame).
        return {
          cx: clamp(map.h0[0] + map.inv[0][0] * dx + map.inv[0][1] * dz, 0.24, 0.76),
          cy: clamp(map.h0[1] + map.inv[1][0] * dx + map.inv[1][1] * dz, 0.24, 0.83),
        };
      };
      const t0 = performance.now();
      let goalsAtStart: number | null = null;
      let lastPush = -Infinity;
      let pushes = 0;
      while (performance.now() - t0 < timeoutMs) {
        const s = w.__ffDebug.snapshot();
        const core = s?.entities.find((e) => e.kind === 'core');
        if (!s || !core) {
          await sleep(50);
          continue;
        }
        goalsAtStart ??= s.match.score[0];
        if (s.match.score[0] > goalsAtStart) return { outcome: 'goal' as const, pushes };
        if (s.match.phase === 'matchEnd') return { outcome: 'end' as const, pushes };
        // Lead the core by the hand → force point lag (a person aims where it is going, too).
        const cx = clamp(core.p[0]! + (core.v?.[0] ?? 0) * leadS, -20, 20);
        const cz = clamp(core.p[2]! + (core.v?.[2] ?? 0) * leadS, -11.5, 11.5);
        const dx = goalX - cx;
        const dz = -cz;
        const d = Math.hypot(dx, dz) || 1;
        const tx = Math.min(1.9, cx - (dx / d) * 1.4);
        const tz = cz - (dz / d) * 1.4;
        await w.__ffCamera.drive({ size: 0.15, shape: 'open', ...hand(tx, tz) });
        const m = s.players[0]!.m;
        const px = cx - m[0];
        const pz = cz - m[1];
        const reach = Math.hypot(px, pz);
        const align = (px * dx + pz * dz) / ((reach || 1) * d);
        const lined = Math.hypot(m[0] - tx, m[1] - tz) < 1.2 && reach < 5 && align > 0.85;
        if (s.match.phase === 'playing' && lined && performance.now() - lastPush > 900) {
          // Push the open palm toward the camera; the aim holds still while the push forms.
          await w.__ffCamera.drive({ size: 0.19 });
          await sleep(pushMs);
          await w.__ffCamera.drive({ size: 0.15 });
          lastPush = performance.now();
          pushes++;
        }
        await sleep(20);
      }
      return { outcome: 'timeout' as const, pushes };
    },
    { map, timeoutMs, goalX: GOAL_X, leadS: LEAD_S, pushMs: PUSH_MS },
  );
}

test('camera player: gesture input moves the core, scores a goal, and plays on after a rematch', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A small canvas leaves the software-rendered page enough main-thread time to feed the camera
  // controller at a realistic rate (~7–14 Hz here); at 960×540 it starves to ~3 Hz.
  await page.setViewportSize({ width: 640, height: 360 });
  // Fast rules: one goal wins a round, two rounds win the match. The authority runs at half
  // speed: the stand-in's hand goes through a software-rendered page and the camera pipeline,
  // the bot reacts every tick — the race must not depend on the test machine's speed.
  // The sign scheme (hands-on is the camera's default): a palm pushed toward the camera is PULSE.
  await page.goto(
    '/?mode=bot&difficulty=easy&fast=1&test=1&quality=low&seed=12&timescale=0.5&hands=0',
  );
  await page.getByTestId('controls-camera').click();
  await cameraActive(page);
  await page.getByTestId('start-match').click();
  await playing(page);
  const { mark } = await log(page);

  const map = await learnAim(page);
  const panel = page.getByTestId('match-end');
  const rematch = async () => {
    await page.getByTestId('rematch').click();
    await expect(panel).toBeHidden();
    await expect
      .poll(async () => (await snap(page))?.match.roundWins, { timeout: 15_000 })
      .toEqual([0, 0]);
    await playing(page);
  };

  // Play until the camera player scores. The bot may win a match first: then rematch and go on
  // (every match after the first is itself played through a rematch with gesture input only).
  let goals = 0;
  let matches = 1;
  let pushes = 0;
  while (goals === 0) {
    const r = await cameraAutopilotUntilGoal(page, map, 150_000);
    pushes += r.pushes;
    expect(r.outcome, 'the match neither produced a goal nor ended').not.toBe('timeout');
    if (r.outcome === 'goal') {
      goals++;
      await expect(page.locator('.banner-title', { hasText: /^GOAL$/ })).toBeVisible();
    } else {
      expect(matches, 'the camera player did not score in 4 matches').toBeLessThan(4);
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await rematch();
      matches++;
    }
  }
  const { acks, casts } = await log(page, mark);
  const accepted = acks.filter((a) => a.slot === 0 && a.action === 'pulse' && a.accepted);
  const pulses = casts.filter((c) => c.slot === 0 && c.ability === 'pulse');
  const hits = pulses.filter((c) => c.mag > 0);
  test.info().annotations.push({
    type: 'camera player (synthetic hand, closed loop)',
    description: `${matches} match(es): ${pushes} palm pushes → ${accepted.length} accepted PULSE casts, ${hits.length} struck the core → goal`,
  });
  // The camera player's pushes really moved the core (authoritative cast strength on it).
  expect(hits.length).toBeGreaterThan(0);

  // Hands off: the rest of the match plays out (the bot wins rounds against an idle player, or
  // the round clock runs out) until the match ends.
  await drive(page, null);
  await expect(panel).toBeVisible({ timeout: 240_000 });
  const final = await snap(page);
  expect(final?.match.roundWins[0]).toBeGreaterThanOrEqual(1);

  // Rematch: the camera keeps working in the new match — a palm push is accepted again.
  await rematch();
  await drive(page, { ...OPEN, cx: 0.5, cy: 0.5 });
  await page.waitForTimeout(800);
  const { mark: rematched } = await log(page);
  await expect
    .poll(
      async () => {
        const accepted = (await log(page, rematched)).acks.some(
          (a) => a.slot === 0 && a.action === 'pulse' && a.accepted,
        );
        if (!accepted) {
          await drive(page, { size: 0.19 });
          await page.waitForTimeout(PUSH_MS);
          await drive(page, { size: 0.15 });
          await page.waitForTimeout(700);
        }
        return accepted;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  await drive(page, 'stop');
  expect(errors).toEqual([]);
});
