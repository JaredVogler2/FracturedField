/**
 * Phase 05 browser E2E — camera control.
 *
 * 1. REAL camera path: Chromium's fake camera plays a video built from real hand photos; frames go
 *    through getUserMedia → the vision worker → the real hand model → the gesture engine → intents,
 *    and the authoritative world changes. (Real imagery and real inference; not a live person.)
 * 2. Synthetic landmark timelines through the same camera controller drive a live match: PULSE,
 *    a LIFT hold, and a long tracking dropout that releases the hold on the server (S12).
 * 3. Online: both players use their own camera; each device sees both players' camera casts,
 *    and every frame either device sends is a small game message — no video, image or landmark
 *    data leaves a device (G06/G15).
 */
import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  camera,
  cameraActive,
  castByGesture,
  drive,
  handFor,
  learnAim,
  log,
  play,
  snap,
} from './camera';
import { HAND_VIDEO } from './global-setup';
import { openRoom } from './helpers';

test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...(existsSync(HAND_VIDEO) ? [`--use-file-for-fake-video-capture=${HAND_VIDEO}`] : []),
    ],
  },
  permissions: ['camera'],
});

/** Saved calibration for the real-photo hand: after the selfie label swap it reads as 'left'. */
const PHOTO_CALIBRATION = {
  camera: {
    setup: 'close',
    facing: 'user',
    dominant: 'left',
    sensitivity: 1,
    dwellMs: 280,
    preview: true,
    calibration: {
      palmScale: null,
      center: { x: 0.67, y: 0.55 },
      range: { x0: 0.29, x1: 1.04, y0: 0.22, y1: 0.85 },
      hand: 'left',
      palmFacing: -0.5,
    },
  },
};

test('real camera path: real hand photos through the hand model become authoritative casts', async ({
  page,
}) => {
  test.skip(!existsSync(HAND_VIDEO), 'real-hand test video unavailable (offline?)');
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A small canvas keeps the software-rendered page responsive enough to pace the camera pipeline.
  await page.setViewportSize({ width: 640, height: 360 });
  await page.addInitScript(
    (s) => localStorage.setItem('ff.settings.v1', JSON.stringify(s)),
    PHOTO_CALIBRATION,
  );
  // The sign scheme (hands-on is the camera's default): signs cast moves.
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=31&hands=0');
  await page.getByTestId('controls-camera').click();
  await expect(page.getByTestId('camera-setup')).toContainText('stays on this device');
  await page.getByTestId('camera-start').click();
  await expect.poll(async () => (await camera(page))?.state, { timeout: 90_000 }).toBe('running');
  await page.getByRole('button', { name: 'Use saved calibration' }).click();
  // Practice: the model sees the photos' V sign, fist, pointing finger and thumbs-up.
  await expect
    .poll(
      async () => {
        const p = (await camera(page))?.practiced ?? {};
        return ['wet', 'lift', 'pick1', 'heat'].filter((g) => p[g] !== undefined).sort();
      },
      { timeout: 90_000 },
    )
    .toEqual(['heat', 'lift', 'pick1', 'wet']);
  const stats = (await camera(page))?.stats;
  test.info().annotations.push({
    type: 'camera pipeline (this container, software rendering)',
    description: `${stats?.fps} fps · model ${Math.round(stats?.inferMs ?? 0)} ms · capture→landmarks ${Math.round(stats?.latencyMs ?? 0)} ms · ${stats?.delegate}`,
  });
  await page.getByRole('button', { name: 'Skip practice' }).click();
  await expect(page.getByTestId('camera-chip')).toBeVisible();
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snap(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  // The V sign is WET: a pool owned by seat 0 appears in the authoritative world, and the
  // pointing finger casts the first pick (FREEZE) — both decided by the authority.
  await expect
    .poll(
      async () => {
        const s = await snap(page);
        return Boolean(
          s?.effects.some((e) => e.kind === 'pool' && e.owner === 0) &&
          (s.players[0]?.cd.freeze ?? 0) >= 0,
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  expect(errors).toEqual([]);
});

test('synthetic gestures drive the match; a long dropout releases a held LIFT on the server', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 640, height: 360 });
  // The sign scheme (hands-on is the camera's default): a held fist is LIFT.
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=7&hands=0');
  await page.getByTestId('controls-camera').click();
  // No real camera needed: the synthetic frames enter the same controller the camera feeds.
  await cameraActive(page);
  await page.getByTestId('start-match').click();
  await expect
    .poll(async () => (await snap(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');

  // Hand at the player's right edge (image left) aims near the midline, close to the core.
  const at = { cx: 0.24, cy: 0.5, size: 0.15 };
  const aiming = play(page, { seconds: 2, keys: [{ t: 0, hand: { ...at, shape: 'open' } }] });
  await expect
    .poll(async () => (await snap(page))?.players[0]?.m[0] ?? -99, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await aiming;

  // PULSE: push the open palm toward the camera — the authority casts PULSE for seat 0.
  const push = {
    seconds: 2.2,
    keys: [
      { t: 0, hand: { ...at, shape: 'open' } },
      { t: 0.8, hand: { size: 0.15 } },
      { t: 1.0, hand: { size: 0.19 } },
      { t: 1.6, hand: { size: 0.19 } },
      { t: 2.0, hand: { size: 0.15 } },
    ],
  };
  const { mark: pushed } = await castByGesture(page, 'pulse', () => play(page, push));
  const after = await log(page, pushed);
  expect(after.casts.filter((c) => c.slot === 0 && c.ability === 'pulse')).toHaveLength(1);
  // Gesture recognised (page clock) → authority verdict back on the page.
  const verdict = after.acks.find((a) => a.slot === 0 && a.action === 'pulse' && a.accepted)!;
  const gestureAt = (await camera(page))?.practiced.pulse ?? NaN;
  expect(verdict.at).toBeGreaterThan(gestureAt);
  test.info().annotations.push({
    type: 'latency: PULSE gesture → authority verdict (local worker, software-rendered page)',
    description: `${Math.round(verdict.at - gestureAt)} ms`,
  });

  // LIFT: grip the core with a fist (the server starts a hold), then the hand vanishes at 2.3 s.
  // The play is sampled in the page against the authoritative snapshots: the hold must survive
  // until the dropout and end shortly after it (coast 200 ms + release 500 ms), well before the
  // server's own 4 s hold limit could have ended it. LIFT needs a body within 6.5 m of the force
  // point, so the hand aims at the core first (the hand → force point map is learned the way a
  // player gets used to the controls).
  const map = await learnAim(page);
  await drive(page, 'stop');
  const LOST_AT = 2.3;
  const gripAtCore = async () => {
    // Wait until the core is reachable from seat 0's side (the bot may have pushed it away).
    await expect
      .poll(
        async () => {
          const s = await snap(page);
          const core = s?.entities.find((e) => e.kind === 'core');
          return s?.match.phase === 'playing' && core !== undefined && core.p[0] < 6;
        },
        { timeout: 45_000 },
      )
      .toBe(true);
    const core = (await snap(page))!.entities.find((e) => e.kind === 'core')!;
    const lead = 0.6;
    const [cx, cy] = handFor(
      map,
      Math.min(1.9, core.p[0] + (core.v?.[0] ?? 0) * lead),
      core.p[2] + (core.v?.[2] ?? 0) * lead,
    );
    return {
      seconds: 4.8,
      keys: [
        { t: 0, hand: { cx, cy, size: 0.15, shape: 'open' } },
        { t: 0.8, hand: { shape: 'fist' } },
      ],
      dropouts: [[LOST_AT, 4.8]],
    };
  };
  type Sample = [seconds: number, hold: string | null, phase: string | null];
  const sampledGrip = async () =>
    page.evaluate(
      async (s): Promise<Sample[]> => {
        const w = window as unknown as {
          __ffCamera: { play(x: unknown): Promise<void> };
          __ffDebug: {
            snapshot(): { match: { phase: string }; players: { hold: string | null }[] } | null;
          };
        };
        const trace: Sample[] = [];
        const t0 = performance.now();
        let done = false;
        const sampler = (async () => {
          while (!done) {
            const snapshot = w.__ffDebug.snapshot();
            trace.push([
              (performance.now() - t0) / 1000,
              snapshot?.players[0]?.hold ?? null,
              snapshot?.match.phase ?? null,
            ]);
            await new Promise((r) => setTimeout(r, 40));
          }
        })();
        await w.__ffCamera.play(s);
        await new Promise((r) => setTimeout(r, 300));
        done = true;
        await sampler;
        return trace;
      },
      await gripAtCore(),
    );
  // A goal during the grip ends the hold for match reasons: try again after the kickoff.
  const { mark: gripped, result: trace } = await castByGesture(page, 'lift', sampledGrip, {
    interrupted: (t) => t.some(([, , phase]) => phase !== 'playing'),
  });
  const held = trace.filter(([, h]) => h === 'lift').map(([t]) => t);
  expect(held.length, 'LIFT hold never visible').toBeGreaterThan(0);
  const firstHeld = Math.min(...held);
  const lastHeld = Math.max(...held);
  test.info().annotations.push({
    type: 'LIFT hold seen in authoritative snapshots (page clock, software-rendered container)',
    description: `${firstHeld.toFixed(2)}–${lastHeld.toFixed(2)} s; synthetic hand lost at ${LOST_AT.toFixed(2)} s`,
  });
  // The hold was still on when the hand vanished and is gone at the end…
  expect(lastHeld, 'hold ended before the hand was lost').toBeGreaterThan(LOST_AT - 0.1);
  expect(trace.at(-1)?.[1] ?? null).toBeNull();
  // …and it was the camera's END that released it: the authority accepted both the start and the
  // END (an END after the server had already dropped the hold would be refused as 'invalid'),
  // and the release came well before the server's own 4 s hold limit.
  const liftAcks = (await log(page, gripped)).acks.filter(
    (a) => a.slot === 0 && a.action === 'lift',
  );
  expect(liftAcks.map((a) => a.accepted)).toEqual([true, true]);
  expect(lastHeld - firstHeld).toBeLessThan(3.4);
  const st = await camera(page);
  expect(st?.track?.state).toBe('lost');
  // S12: a long loss prompts recalibration; leaving it returns straight to the match.
  await page.getByTestId('camera-recalibrate').click();
  await expect(page.getByTestId('camera-setup')).toContainText('Calibrate');
  await page.getByTestId('camera-cancel').click();
  await expect(page.getByTestId('camera-setup')).toBeHidden();
  await expect(page.getByTestId('camera-chip')).toBeVisible();
});

test('online: each player on their own camera; both see both camera casts; no media uplink', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  // Every frame each device sends, from its first connection on.
  const sent = { host: [] as string[], guest: [] as string[] };
  const record = (who: keyof typeof sent) => (p: Page) =>
    p.on('websocket', (ws) =>
      ws.on('framesent', (f) =>
        sent[who].push(typeof f.payload === 'string' ? f.payload : `<binary ${f.payload.length}>`),
      ),
    );
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser, {
    query: '&hands=0', // the sign scheme: a palm push is PULSE
    beforeNavigate: (host, guest) => {
      record('host')(host);
      record('guest')(guest);
    },
  });
  // Both players independently pick camera control on their own device.
  for (const p of [a, b]) {
    await p.getByTestId('controls-camera').click();
    await cameraActive(p);
  }
  await a.getByTestId('ready').click();
  await expect(b.getByTestId('lobby-seat-0').locator('.seat-status')).toHaveText('ready');
  await b.getByTestId('ready').click();
  for (const p of [a, b])
    await expect
      .poll(async () => (await snap(p))?.match.phase, { timeout: 30_000 })
      .toBe('playing');
  const start = { a: (await log(a)).mark, b: (await log(b)).mark };
  // Each pushes with their own (synthetic) camera hand…
  const push = {
    seconds: 3,
    keys: [
      { t: 0, hand: { cx: 0.4, cy: 0.5, size: 0.15, shape: 'open' } },
      { t: 1.4, hand: { size: 0.15 } },
      { t: 1.6, hand: { size: 0.19 } },
      { t: 2.4, hand: { size: 0.19 } },
    ],
  };
  const { mark: hostMark } = await castByGesture(a, 'pulse', () => play(a, push), { slot: 0 });
  const { mark: guestMark } = await castByGesture(b, 'pulse', () => play(b, push), { slot: 1 });
  // …and each device receives both camera-driven PULSEs from the authority.
  for (const [p, mark] of [
    [a, start.a],
    [b, start.b],
  ] as const) {
    await expect
      .poll(
        async () => {
          const casts = (await log(p, mark)).casts.filter((c) => c.ability === 'pulse');
          return [0, 1].every((slot) => casts.some((c) => c.slot === slot));
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  }
  for (const [p, mark, slot, who] of [
    [a, hostMark, 0, 'host'],
    [b, guestMark, 1, 'guest'],
  ] as const) {
    const verdict = (await log(p, mark)).acks.find(
      (x) => x.slot === slot && x.action === 'pulse' && x.accepted,
    )!;
    const gestureAt = (await camera(p))?.practiced.pulse ?? NaN;
    test.info().annotations.push({
      type: `latency: ${who} PULSE gesture → room verdict (local workerd over WebSocket)`,
      description: `${Math.round(verdict.at - gestureAt)} ms`,
    });
  }
  // Only small game messages ever leave either device: no video, images or landmarks.
  for (const who of ['host', 'guest'] as const) {
    const frames = sent[who];
    expect(frames.length, who).toBeGreaterThan(5);
    for (const raw of frames) {
      expect(raw.startsWith('<binary'), `${who}: binary frame sent`).toBe(false);
      expect(raw.length, `${who}: oversized frame: ${raw.slice(0, 80)}`).toBeLessThan(600);
      const msg = JSON.parse(raw) as { t: string };
      expect(['hello', 'ping', 'ready', 'intent', 'rematch', 'leave']).toContain(msg.t);
      expect(raw).not.toMatch(/landmark|image|video|frame|pixel/i);
    }
    const camPulses = frames
      .map((r) => JSON.parse(r) as { t: string; i?: { source: string; action: string } })
      .filter((m) => m.t === 'intent' && m.i?.source === 'camera' && m.i.action === 'pulse');
    expect(camPulses.length, `${who}: camera PULSE intents`).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});
