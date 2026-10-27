/**
 * Phase 06 browser E2E — handheld motion, the iOS motion permission, game controllers and key
 * rebinding, end to end through the authority (bot matches in the local worker).
 *
 * Sensors and pads are browser test doubles: synthetic DeviceOrientationEvents and a stubbed
 * navigator.getGamepads(). None of this ran on a physical phone or controller.
 */
import {
  expect,
  test,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { debug, project, snapshot } from './helpers';
import { PHONE_LANDSCAPE } from './touch';

const BOT = '/?mode=bot&difficulty=easy&test=1&quality=low&seed=21';

/** A phone whose browser lets the page read motion sensors (Chromium's permission model). */
const MOTION_PHONE: BrowserContextOptions = {
  ...PHONE_LANDSCAPE,
  permissions: ['accelerometer', 'gyroscope', 'magnetometer'],
};

/**
 * Screen rotation through the DevTools protocol: Playwright's device emulation reports angle 0
 * even in landscape, while a real phone held in landscape reports 90. Keep the session open (the
 * override lives as long as it does).
 */
async function setScreen(cdp: CDPSession, orientation: 'landscape' | 'portrait'): Promise<void> {
  const landscape = orientation === 'landscape';
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: landscape ? 844 : 390,
    height: landscape ? 390 : 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenOrientation: landscape
      ? { type: 'landscapePrimary', angle: 90 }
      : { type: 'portraitPrimary', angle: 0 },
  });
}

type Tilt = { alpha: number; beta: number; gamma: number };
type SensorWindow = Window & {
  __tilt: Tilt | null;
  __permCalls: { activation: boolean | null; event: string | null }[];
};

/**
 * A motion sensor double: while `window.__tilt` holds angles, a reading is dispatched every
 * 33 ms (≈ 30 Hz, a typical phone rate); `null` means the sensor is silent.
 */
async function installSensor(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const w = window as unknown as SensorWindow;
    w.__tilt = null;
    setInterval(() => {
      const t = w.__tilt;
      if (!t) return;
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientation', { ...t, absolute: false }),
      );
    }, 33);
  });
}

/** iOS-style permission API: records how it was called and answers `answer`. */
async function installIosPermission(ctx: BrowserContext, answer: 'granted' | 'denied') {
  await ctx.addInitScript((a) => {
    const w = window as unknown as SensorWindow;
    w.__permCalls = [];
    Object.defineProperty(DeviceOrientationEvent, 'requestPermission', {
      configurable: true,
      value: () => {
        w.__permCalls.push({
          // Transient user activation, and the event being dispatched when it was called: iOS
          // shows its prompt only when asked synchronously inside the tap.
          activation: navigator.userActivation?.isActive ?? null,
          event: (window as unknown as { event?: Event }).event?.type ?? null,
        });
        return Promise.resolve(a);
      },
    });
  }, answer);
}

const setTilt = (page: Page, t: Tilt | null) =>
  page.evaluate((v) => {
    (window as unknown as SensorWindow).__tilt = v;
  }, t);

/**
 * Device angles for a phone turned `deg` to the right (pointer style) of a flat neutral pose. The
 * turn happens about the displayed content's vertical axis, so which device angle carries it
 * depends on the screen rotation.
 */
function turnRight(deg: number, screenAngle: number): Tilt {
  switch (screenAngle) {
    case 90:
      return { alpha: 0, beta: -deg, gamma: 0 };
    case 180:
      return { alpha: 0, beta: 0, gamma: deg };
    case 270:
      return { alpha: 0, beta: deg, gamma: 0 };
    default:
      return { alpha: 0, beta: 0, gamma: -deg };
  }
}

const FLAT: Tilt = { alpha: 0, beta: 0, gamma: 0 };

async function startBotMatch(page: Page, how: 'tap' | 'click'): Promise<void> {
  const start = page.getByTestId('start-match');
  await (how === 'tap' ? start.tap() : start.click());
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
}

const manipulatorX = async (page: Page) => (await snapshot(page))!.players[0]!.m[0];

/** The force point's x once it has stopped moving (two reads 300 ms apart agree). */
async function settledX(page: Page): Promise<number> {
  let prev = await manipulatorX(page);
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(300);
    const x = await manipulatorX(page);
    if (Math.abs(x - prev) < 0.05) return x;
    prev = x;
  }
  throw new Error('force point never settled');
}

const sentSince = async (page: Page, mark: number) =>
  ((await debug(page, 'intents')) ?? []).filter((i) => i.n > mark);

const lastIntent = async (page: Page) => {
  const all = (await debug(page, 'intents')) ?? [];
  return all.length > 0 ? all[all.length - 1]!.n : 0;
};

test('motion: the phone aims by turning; gyro intents; recenter after the background; stall → touch', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(MOTION_PHONE);
  await installSensor(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BOT);
  const cdp = await ctx.newCDPSession(page);
  await setScreen(cdp, 'landscape');
  const angle = await page.evaluate(() => screen.orientation.angle);
  expect(angle).toBe(90);

  // The phone opens in touch; choosing Motion first checks that real readings arrive.
  await expect(page.getByTestId('controls-touch')).toHaveAttribute('aria-checked', 'true');
  await setTilt(page, FLAT);
  await page.getByTestId('controls-motion').tap();
  await expect(page.getByTestId('controls-motion')).toHaveAttribute('aria-checked', 'true');
  await startBotMatch(page, 'tap');
  await expect(page.getByTestId('mode-chip')).toHaveText(/Motion/);
  // Abilities stay on the thumb buttons in motion mode.
  await expect(page.getByTestId('touch-controls')).toBeVisible();

  // Hold the phone flat and recenter, then turn right / left: the authoritative force point
  // follows (seat 0's half spans x ≈ -20 … 1.9; neutral aims at its middle, x ≈ -9).
  await page.getByTestId('motion-recenter').tap();
  const mark = await lastIntent(page);
  await setTilt(page, turnRight(12, angle));
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeGreaterThan(-6);
  await setTilt(page, turnRight(-12, angle));
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeLessThan(-12);
  await page.getByTestId('tc-pulse').tap();
  await expect
    .poll(async () => (await sentSince(page, mark)).some((i) => i.action === 'pulse'))
    .toBe(true);
  // The phone aims (gyro); the thumb button that pressed PULSE is named on its own intent.
  const motionIntents = await sentSince(page, mark);
  const aims = motionIntents.filter((i) => i.action === 'aim');
  expect(aims.length).toBeGreaterThan(5);
  expect(new Set(aims.map((i) => i.source))).toEqual(new Set(['gyro']));
  expect(motionIntents.filter((i) => i.action === 'pulse').map((i) => i.source)).toEqual(['touch']);

  // The app goes to the background and comes back: aiming stops until the player recenters.
  await page.evaluate(() => {
    const set = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
      });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set(true);
    set(false);
  });
  await expect(page.getByTestId('motion-prompt')).toContainText('tap Recenter');
  const parked = await settledX(page);
  await setTilt(page, turnRight(12, angle));
  await page.waitForTimeout(1_500);
  expect(Math.abs((await manipulatorX(page)) - parked)).toBeLessThan(0.5);
  // Recenter on the new pose: aiming resumes relative to it.
  await page.getByTestId('motion-recenter-prompt').tap();
  await expect(page.getByTestId('motion-prompt')).toBeHidden();
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeGreaterThan(-11);
  await setTilt(page, turnRight(24, angle));
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeGreaterThan(-6);

  // The sensor goes quiet: the player is told and can switch to touch in one tap.
  await setTilt(page, null);
  await expect(page.getByTestId('motion-prompt')).toContainText('stopped sending');
  await page.getByTestId('motion-use-touch').tap();
  await expect(page.getByTestId('mode-chip')).toHaveText(/Touch/);
  await expect(page.getByTestId('handover')).toHaveText('Controls: Touch');
  await page.waitForTimeout(300); // the swap is applied in an effect right after this render
  const touchMark = await lastIntent(page);
  await page.getByTestId('tc-pulse').tap();
  await expect
    .poll(async () => (await sentSince(page, touchMark)).map((i) => i.source))
    .toContain('touch');
  expect((await sentSince(page, touchMark)).every((i) => i.source === 'touch')).toBe(true);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('motion: rotating the phone re-zeroes the aim for the new screen orientation', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ctx = await browser.newContext(MOTION_PHONE);
  await installSensor(ctx);
  const page = await ctx.newPage();
  await page.goto(BOT);
  const cdp = await ctx.newCDPSession(page);
  await setScreen(cdp, 'landscape');
  await setTilt(page, FLAT);
  await page.getByTestId('controls-motion').tap();
  await expect(page.getByTestId('controls-motion')).toHaveAttribute('aria-checked', 'true');
  await startBotMatch(page, 'tap');
  await page.getByTestId('motion-recenter').tap();
  const turned = turnRight(12, 90);
  await setTilt(page, turned);
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeGreaterThan(-6);

  // The player turns the phone upright: the screen rotates to portrait and the current pose
  // becomes neutral (the force point returns to the middle of its half) — no wild jump.
  await setScreen(cdp, 'portrait');
  expect(await page.evaluate(() => screen.orientation.angle)).toBe(0);
  await expect(page.locator('.motion-toast')).toHaveText(
    'Recentered for the new screen orientation',
  );
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeLessThan(-7);
  // Turning right from there still moves it right on the (now portrait) screen: +z for seat 0.
  // In portrait the turn is about the device's own vertical axis (gamma), on top of the pose.
  await setTilt(page, { ...turned, gamma: -12 });
  await expect
    .poll(async () => (await snapshot(page))!.players[0]!.m[1], { timeout: 10_000 })
    .toBeGreaterThan(4);
  // The thumb controls are still on screen after the rotation.
  const box = (await page.getByTestId('tc-pulse').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await ctx.close();
});

test('iOS motion permission: asked inside the tap; granted → motion, denied → stays on touch', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Granted: the prompt is requested synchronously from the tap, then readings are confirmed.
  const ok = await browser.newContext(PHONE_LANDSCAPE);
  await installIosPermission(ok, 'granted');
  await installSensor(ok);
  const a = await ok.newPage();
  await a.goto(BOT);
  await setTilt(a, FLAT);
  await a.getByTestId('controls-motion').tap();
  await expect(a.getByTestId('controls-motion')).toHaveAttribute('aria-checked', 'true');
  const calls = await a.evaluate(() => (window as unknown as SensorWindow).__permCalls);
  expect(calls).toEqual([{ activation: true, event: 'click' }]);
  await ok.close();

  // Denied: the player is told how to allow it later, and touch stays selected and playable.
  const no = await browser.newContext(PHONE_LANDSCAPE);
  await installIosPermission(no, 'denied');
  await installSensor(no);
  const b = await no.newPage();
  await b.goto(BOT);
  await setTilt(b, FLAT);
  await b.getByTestId('controls-motion').tap();
  await expect(b.getByTestId('controls-note')).toContainText('Motion access was not allowed');
  await expect(b.getByTestId('controls-touch')).toHaveAttribute('aria-checked', 'true');
  await startBotMatch(b, 'tap');
  await expect(b.getByTestId('mode-chip')).toHaveText(/Touch/);
  await expect(b.getByTestId('touch-controls')).toBeVisible();
  await no.close();
});

test('motion without a usable sensor: no readings, or the browser refuses — touch stays selected', async ({
  browser,
}) => {
  // Allowed, but the device never produces readings (Chromium sends one all-null event).
  const quiet = await browser.newContext(MOTION_PHONE);
  const a = await quiet.newPage();
  await a.goto(BOT);
  await a.getByTestId('controls-motion').tap();
  await expect(a.getByTestId('controls-note')).toContainText('No motion readings');
  await expect(a.getByTestId('controls-touch')).toHaveAttribute('aria-checked', 'true');
  await quiet.close();

  // The browser's own permission API refuses (no sensor permission for this site).
  const refused = await browser.newContext(PHONE_LANDSCAPE);
  const b = await refused.newPage();
  await b.goto(BOT);
  await b.getByTestId('controls-motion').tap();
  await expect(b.getByTestId('controls-note')).toContainText('Motion access was not allowed');
  await expect(b.getByTestId('controls-touch')).toHaveAttribute('aria-checked', 'true');
  await refused.close();
});

type PadWindow = Window & {
  __pad: {
    id: string;
    index: number;
    connected: boolean;
    mapping: string;
    timestamp: number;
    axes: number[];
    buttons: { pressed: boolean; touched: boolean; value: number }[];
  };
};

/** A standard-mapping controller double behind navigator.getGamepads(). */
async function installPad(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const pad = {
      id: 'Test pad (STANDARD GAMEPAD)',
      index: 0,
      connected: false,
      mapping: 'standard',
      timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    (window as unknown as PadWindow).__pad = pad;
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () => [pad.connected ? pad : null, null, null, null],
    });
  });
}

const padEvent = (page: Page, type: 'gamepadconnected' | 'gamepaddisconnected') =>
  page.evaluate((t) => {
    const pad = (window as unknown as PadWindow).__pad;
    pad.connected = t === 'gamepadconnected';
    const e = new Event(t);
    Object.defineProperty(e, 'gamepad', { value: pad });
    window.dispatchEvent(e);
  }, type);

const padButton = (page: Page, index: number, value: number) =>
  page.evaluate(
    ([i, v]) => {
      const pad = (window as unknown as PadWindow).__pad;
      pad.buttons[i!] = { pressed: v! > 0.5, touched: v! > 0, value: v! };
      pad.timestamp = performance.now();
    },
    [index, value],
  );

const padStick = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([sx, sy]) => {
      const pad = (window as unknown as PadWindow).__pad;
      pad.axes = [sx!, sy!, 0, 0];
      pad.timestamp = performance.now();
    },
    [x, y],
  );

test('game controller: connect, steer, A pulses, LT lifts, Start pauses, unplugging releases the hold', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  await installPad(ctx);
  const page = await ctx.newPage();
  await page.goto(BOT);
  await startBotMatch(page, 'click');
  await padEvent(page, 'gamepadconnected');
  await expect(page.getByTestId('gamepad-notice')).toHaveText('Controller connected');

  // Left stick right: the force point moves right on screen (+x for seat 0) at the capped speed.
  const x0 = await settledX(page);
  await padStick(page, 1, 0);
  await expect.poll(() => manipulatorX(page), { timeout: 10_000 }).toBeGreaterThan(x0 + 2);
  // From here on the controller drives the seat: everything sent is tagged gamepad.
  const mark = await lastIntent(page);
  await padStick(page, 0, 0);
  // A pulses.
  const ackMark = (await debug(page, 'mark')) ?? 0;
  await padButton(page, 0, 1);
  await page.waitForTimeout(150);
  await padButton(page, 0, 0);
  await expect
    .poll(async () =>
      ((await debug(page, 'acks')) ?? []).some((k) => k.n > ackMark && k.action === 'pulse'),
    )
    .toBe(true);
  const padIntents = await sentSince(page, mark);
  expect(padIntents.some((i) => i.action === 'pulse' && i.phase === 'tap')).toBe(true);
  expect(new Set(padIntents.map((i) => i.source))).toEqual(new Set(['gamepad']));

  // LT (analog, past half-way) lifts the nearest body: aim beside the core with the mouse first.
  let held = false;
  for (let attempt = 0; attempt < 8 && !held; attempt++) {
    const s = (await snapshot(page))!;
    const core = s.entities.find((e) => e.kind === 'core')!;
    const p = await project(page, Math.min(1.9, core.p[0] - 1), 1.1, core.p[2]);
    if (p) await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(600);
    await padButton(page, 6, 0.8);
    held = await expect
      .poll(async () => (await snapshot(page))?.players[0]?.hold ?? null, { timeout: 2_000 })
      .toBe('lift')
      .then(() => true)
      .catch(() => false);
    if (!held) {
      await padButton(page, 6, 0);
      await page.waitForTimeout(800);
    }
  }
  expect(held).toBe(true);
  // Unplugged mid-hold: the hold ends on the server and the player is told.
  await padEvent(page, 'gamepaddisconnected');
  await expect(page.getByTestId('gamepad-notice')).toHaveText(
    'Controller disconnected — other controls still work',
  );
  await expect
    .poll(async () => (await snapshot(page))?.players[0]?.hold ?? null, { timeout: 5_000 })
    .toBeNull();

  // Plugged back in: Start opens the pause menu (the match pauses).
  await padButton(page, 6, 0);
  await padEvent(page, 'gamepadconnected');
  await padButton(page, 9, 1);
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await padButton(page, 9, 0);
  await expect.poll(async () => (await snapshot(page))?.match.paused).toBe(true);
  await ctx.close();
});

test('rebinding: PULSE moved to Z in Controls is used in the match (and Space no longer pulses)', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  await page.goto('/?test=1&quality=low');
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await page.getByTestId('rebind-pulse').click();
  await page.keyboard.press('KeyZ');
  await expect(page.getByTestId('rebind').locator('.binding-row').nth(4)).toContainText('Z');
  // A reserved key (P pauses) is refused with a reason; Esc cancels without changing anything.
  await page.getByTestId('rebind-guard').click();
  await page.keyboard.press('KeyP');
  await expect(page.getByTestId('rebind')).toContainText('P is reserved');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('rebind-guard')).toHaveText('Change');
  await expect(page.getByTestId('rebind').locator('.binding-row').nth(8)).toContainText('F');

  // The layout persists into a match: the HUD shows Z and the authority receives the pulse.
  await page.goto(BOT);
  await startBotMatch(page, 'click');
  await expect(page.locator('.ability', { hasText: 'Pulse' }).locator('.ab-key')).toHaveText('Z');
  const mark = (await debug(page, 'mark')) ?? 0;
  await page.keyboard.press('KeyZ');
  await expect
    .poll(async () =>
      ((await debug(page, 'acks')) ?? []).some((k) => k.n > mark && k.action === 'pulse'),
    )
    .toBe(true);
  // Space was replaced, not added to: it sends nothing now.
  const before = await lastIntent(page);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  expect((await sentSince(page, before)).some((i) => i.action === 'pulse')).toBe(false);
  await ctx.close();
});
