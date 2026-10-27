/**
 * Phase 06 browser E2E — phones, touch and control modes.
 *
 * 1. D06 gate: a phone with no camera permission and no motion sensor joins a remote room and
 *    completes three rounds with touch alone (every intent it sends is `source: touch`).
 * 2. Hot-swap mid-hold: changing controls during a LIFT releases it on the server; the handover
 *    notice shows.
 * 3. Layouts from 320 px phones to a 4:3 tablet: every touch target inside the screen, ≥ 44 px,
 *    clear of the scoreboard, and the core and both goal mouths not under the controls.
 * (Browser device emulation — not physical phones.)
 */
import { expect, test, type Page } from '@playwright/test';
import { debug, openRoom, project, snapshot, type Snap } from './helpers';
import { PHONE_LANDSCAPE, touchAutopilot } from './touch';

test('D06 gate: a touch-only phone (no camera, no sensors) completes three rounds online', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const sent: string[] = [];
  const { ctxA, ctxB, a, b, errors } = await openRoom(browser, {
    guest: PHONE_LANDSCAPE,
    beforeNavigate: (_host, guest) =>
      guest.on('websocket', (ws) =>
        ws.on('framesent', (f) => sent.push(typeof f.payload === 'string' ? f.payload : '')),
      ),
  });
  // The phone defaults to touch; it never asks for camera or motion.
  await expect(b.getByTestId('controls-touch')).toHaveAttribute('aria-checked', 'true');
  await a.getByTestId('ready').click();
  await expect(b.getByTestId('lobby-seat-0').locator('.seat-status')).toHaveText('ready');
  await b.getByTestId('ready').tap();
  await expect
    .poll(async () => (await snapshot(b))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  await expect(b.getByTestId('touch-controls')).toBeVisible();

  // Rounds end on a goal (fast rules: one goal wins a round, two rounds win the match).
  const rounds = (s: Snap | null) => (s ? s.match.roundWins[0] + s.match.roundWins[1] : 0);
  let completed = 0;
  let matches = 1;
  while (completed < 3) {
    const before = rounds(await snapshot(b));
    const s = await touchAutopilot(
      b,
      1,
      (x) => rounds(x) > before || x.match.phase === 'matchEnd',
      240_000,
    );
    completed += rounds(s) - before;
    if (s.match.phase === 'matchEnd' && completed < 3) {
      // Rematch — the touch player taps the button like anyone else.
      await expect(b.getByTestId('rematch')).toBeVisible({ timeout: 20_000 });
      await b.getByTestId('rematch').tap();
      await a.getByTestId('rematch').click();
      await expect
        .poll(async () => (await snapshot(b))?.match.phase, { timeout: 30_000 })
        .toBe('playing');
      matches++;
    }
  }
  const summary = `${completed} rounds completed over ${matches} match(es)`;
  test.info().annotations.push({ type: 'touch-only player', description: summary });
  console.log(`D06 gate: touch-only phone — ${summary}`);
  // Every intent the phone sent came from touch (no camera, gyro, keyboard or pointer).
  const intents = sent
    .filter((r) => r.startsWith('{'))
    .map((r) => JSON.parse(r) as { t: string; i?: { source: string; action: string } })
    .filter((m) => m.t === 'intent');
  expect(intents.length).toBeGreaterThan(5);
  expect(new Set(intents.map((m) => m.i?.source))).toEqual(new Set(['touch']));
  expect(intents.some((m) => m.i?.action === 'pulse')).toBe(true);
  const pulses = intents.filter((m) => m.i?.action === 'pulse').length;
  console.log(`D06 gate: the phone sent ${intents.length} intents (${pulses} PULSE), all touch`);
  expect(errors).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test('hot-swap mid-hold: changing controls during a LIFT releases it; the handover is shown', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext(PHONE_LANDSCAPE);
  const page = await ctx.newPage();
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=21');
  await page.getByTestId('start-match').tap();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  await expect(page.getByTestId('mode-chip')).toHaveText(/Touch/);
  // Grip the nearest body: tap beside the core, then hold LIFT (pointer captured) until it holds.
  const hold = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const s = (await snapshot(page))!;
      const core = s.entities.find((e) => e.kind === 'core')!;
      const p = await project(page, Math.min(1.9, core.p[0] - 1), 1.1, core.p[2]);
      if (p) await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(500);
      await page.keyboard.down('ShiftLeft'); // LIFT start/end via a held key stands in for a held thumb
      const held = await expect
        .poll(async () => (await snapshot(page))?.players[0]?.hold ?? null, { timeout: 2_000 })
        .toBe('lift')
        .then(() => true)
        .catch(() => false);
      if (held) return;
      await page.keyboard.up('ShiftLeft');
      await page.waitForTimeout(800);
    }
    throw new Error('LIFT never held');
  };
  await hold();
  // Switch to the simplified mode from the in-match chip while the hold is on.
  await page.getByTestId('mode-chip').tap();
  await page.getByTestId('controls-accessible').tap();
  await expect(page.getByTestId('handover')).toHaveText('Controls: Simplified');
  await expect
    .poll(async () => (await snapshot(page))?.players[0]?.hold ?? null, { timeout: 5_000 })
    .toBeNull();
  // Letting go of the old input afterwards changes nothing.
  await page.keyboard.up('ShiftLeft');
  await page.waitForTimeout(500);
  expect((await snapshot(page))?.players[0]?.hold ?? null).toBeNull();
  await ctx.close();
});

test('two thumbs at once: one keeps aiming on the arena while the other taps PULSE', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext(PHONE_LANDSCAPE);
  const page = await ctx.newPage();
  await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=21');
  await page.getByTestId('start-match').tap();
  await expect
    .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  // Raw multi-touch through the DevTools protocol (Playwright's touchscreen is single-finger).
  const cdp = await ctx.newCDPSession(page);
  type Pt = { x: number; y: number; id: number };
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, radiusX: 6, radiusY: 6, force: 1 })),
    });
  const from = (await project(page, -12, 1.1, -3))!;
  const to = (await project(page, -6, 1.1, 2))!;
  for (const p of [from, to]) {
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x!, y!)?.tagName,
      [p.x, p.y],
    );
    expect(hit, `(${p.x}, ${p.y}) is on the arena`).toBe('CANVAS');
  }
  const box = (await page.getByTestId('tc-pulse').boundingBox())!;
  const thumb2: Pt = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 2 };
  const n0 = ((await debug(page, 'intents')) ?? []).at(-1)?.n ?? 0;
  const a0 = (await debug(page, 'mark')) ?? 0;

  await touch('touchStart', [{ ...from, id: 1 }]);
  await page.waitForTimeout(100);
  // The second thumb presses PULSE while the first stays down, then lifts.
  await touch('touchStart', [{ ...from, id: 1 }, thumb2]);
  await page.waitForTimeout(60);
  await touch('touchMove', [{ ...from, id: 1 }]);
  // The first thumb drags on; the force point follows it.
  for (let i = 1; i <= 12; i++) {
    const k = i / 12;
    await touch('touchMove', [
      { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, id: 1 },
    ]);
    await page.waitForTimeout(30);
  }
  await touch('touchEnd', []);

  await expect
    .poll(async () =>
      ((await debug(page, 'acks')) ?? []).some((k) => k.n > a0 && k.action === 'pulse'),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const m = (await snapshot(page))!.players[0]!.m;
      return Math.hypot(m[0] + 6, m[1] - 2);
    })
    .toBeLessThan(1);
  const sent = ((await debug(page, 'intents')) ?? []).filter((i) => i.n > n0);
  expect(sent.filter((i) => i.action === 'pulse')).toHaveLength(1);
  expect(sent.every((i) => i.source === 'touch')).toBe(true);

  // Keyboard / assistive-technology activation of a thumb button (a click with no pointer
  // press) sends that button's action — and only it (Enter is also a PULSE key). A keyboard
  // player reaches the button with Tab (the game no longer swallows it).
  const k0 = ((await debug(page, 'intents')) ?? []).at(-1)?.n ?? 0;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    if (id === 'tc-guard') break;
  }
  await expect(page.getByTestId('tc-guard')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () =>
      ((await debug(page, 'intents')) ?? []).some((i) => i.n > k0 && i.action === 'guard'),
    )
    .toBe(true);
  const viaKeys = ((await debug(page, 'intents')) ?? []).filter((i) => i.n > k0);
  expect(viaKeys.some((i) => i.action === 'pulse')).toBe(false);
  await ctx.close();
});

test('simplified (one-hand) mode: one tap holds LIFT, another lets go; taps alone score vs the bot', async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const ctx = await browser.newContext(PHONE_LANDSCAPE);
  const page = await ctx.newPage();
  // Fast rules: one goal wins a round, two rounds win the match. The authority runs at half
  // speed: the scripted player reacts through page round trips on a software-rendered page,
  // the bot every tick — the race must not depend on the test machine's speed.
  await page.goto('/?mode=bot&difficulty=easy&fast=1&test=1&quality=low&seed=12&timescale=0.5');
  await page.getByTestId('controls-accessible').tap();
  await page.getByTestId('start-match').tap();
  const playing = () =>
    expect
      .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
      .toBe('playing');
  await playing();
  await expect(page.getByTestId('mode-chip')).toHaveText(/Simplified/);
  await expect(page.getByTestId('touch-controls')).toHaveClass(/simplified/);

  // No held finger needed: tap beside the core, tap LIFT (the server hold starts), tap it again.
  const lift = page.getByTestId('tc-lift');
  let held = false;
  for (let attempt = 0; attempt < 8 && !held; attempt++) {
    const core = (await snapshot(page))!.entities.find((e) => e.kind === 'core')!;
    const p = await project(page, Math.min(1.9, core.p[0] - 1), 1.1, core.p[2]);
    if (p) await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(500);
    await lift.tap();
    held = await expect
      .poll(async () => (await snapshot(page))?.players[0]?.hold ?? null, { timeout: 2_000 })
      .toBe('lift')
      .then(() => true)
      .catch(() => false);
    if (!held) await page.waitForTimeout(600); // out of reach: the toggle resyncs off
  }
  expect(held).toBe(true);
  await expect(lift).toHaveAttribute('aria-pressed', 'true');
  await lift.tap();
  await expect
    .poll(async () => (await snapshot(page))?.players[0]?.hold ?? null, { timeout: 5_000 })
    .toBeNull();
  await expect(lift).toHaveAttribute('aria-pressed', 'false');

  // Then play with taps only until a goal; if the bot wins a match first, rematch and go on.
  let matches = 1;
  for (;;) {
    const s = await touchAutopilot(
      page,
      0,
      (x) => x.match.score[0] > 0 || x.match.roundWins[0] > 0 || x.match.phase === 'matchEnd',
      240_000,
    );
    if (s.match.score[0] > 0 || s.match.roundWins[0] > 0) break;
    expect(matches, 'the simplified-mode player did not score in 4 matches').toBeLessThan(4);
    await expect(page.getByTestId('rematch')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('rematch').tap();
    await playing();
    matches++;
  }
  console.log(`simplified mode: scored in match ${matches}`);
  const sent = (await debug(page, 'intents')) ?? [];
  expect(sent.length).toBeGreaterThan(5);
  expect(new Set(sent.map((i) => i.source))).toEqual(new Set(['touch']));
  await ctx.close();
});

const LAYOUTS: { name: string; width: number; height: number; mobile: boolean }[] = [
  { name: 'phone 320×568 portrait', width: 320, height: 568, mobile: true },
  { name: 'phone 375×667 portrait', width: 375, height: 667, mobile: true },
  { name: 'phone 430×932 portrait', width: 430, height: 932, mobile: true },
  { name: 'phone 568×320 landscape', width: 568, height: 320, mobile: true },
  { name: 'phone 844×390 landscape', width: 844, height: 390, mobile: true },
  { name: 'tablet 1024×768 (4:3)', width: 1024, height: 768, mobile: true },
];

type Box = { x: number; y: number; w: number; h: number };
const inside = (b: Box, x: number, y: number) =>
  x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;

for (const l of LAYOUTS) {
  test(`layout ${l.name}: touch targets fit, ≥ 44 px, and never cover the core or a goal`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: l.width, height: l.height },
      isMobile: l.mobile,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=5');
    await page.getByTestId('start-match').tap();
    await expect
      .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
      .toBe('playing');
    const boxes = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.touch-controls .tc-btn, .scoreboard, .pause-btn, .mode-chip',
        ),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          cls: el.className,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
        };
      }),
    );
    const buttons = boxes.filter((b) => b.cls.includes('tc-btn'));
    expect(buttons.length).toBe(8);
    const fixed = boxes.filter((b) => !b.cls.includes('tc-btn'));
    for (const b of buttons) {
      expect(b.w, b.cls).toBeGreaterThanOrEqual(44);
      expect(b.h, b.cls).toBeGreaterThanOrEqual(44);
      expect(b.x, b.cls).toBeGreaterThanOrEqual(0);
      expect(b.y, b.cls).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, b.cls).toBeLessThanOrEqual(l.width);
      expect(b.y + b.h, b.cls).toBeLessThanOrEqual(l.height);
      for (const f of fixed) {
        const overlap = b.x < f.x + f.w && b.x + b.w > f.x && b.y < f.y + f.h && b.y + b.h > f.y;
        expect(overlap, `${b.cls} overlaps ${f.cls}`).toBe(false);
      }
    }
    // The core at kickoff and both goal mouths are visible (not under a control or a HUD panel).
    const hud = await page.evaluate(() =>
      [...document.querySelectorAll('.player-panel, .scoreboard')].map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className, x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    const s = (await snapshot(page))!;
    const core = s.entities.find((e) => e.kind === 'core')!;
    for (const [x, y, z] of [core.p, [-21, 0.8, 0], [21, 0.8, 0]] as const) {
      const p = await project(page, x, y, z);
      expect(p).not.toBeNull();
      for (const b of [...buttons, ...hud])
        expect(inside(b, p!.x, p!.y), `${b.cls} covers (${x}, ${z})`).toBe(false);
    }
    await ctx.close();
  });
}

/** Notch / dynamic island / home indicator, as a phone reports them through CSS env(). */
const SAFE_AREAS = [
  {
    name: 'landscape 844×390, notch left and right, home indicator',
    width: 844,
    height: 390,
    insets: { top: 0, left: 47, bottom: 21, right: 47 },
  },
  {
    name: 'portrait 390×844, dynamic island and home indicator',
    width: 390,
    height: 844,
    insets: { top: 47, left: 0, bottom: 34, right: 0 },
  },
];

for (const a of SAFE_AREAS) {
  test(`safe area ${a.name}: no control or HUD element sits under an inset`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext({
      viewport: { width: a.width, height: a.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: a.insets });
    await page.goto('/?mode=bot&difficulty=easy&test=1&quality=low&seed=5');
    await page.getByTestId('start-match').tap();
    await expect
      .poll(async () => (await snapshot(page))?.match.phase, { timeout: 30_000 })
      .toBe('playing');
    const boxes = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.touch-controls .tc-btn, .scoreboard, .player-panel, .pause-btn, .mode-chip',
        ),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className, x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(12);
    const { top, left, bottom, right } = a.insets;
    for (const b of boxes) {
      expect(b.x, `${b.cls} left edge`).toBeGreaterThanOrEqual(left);
      expect(b.y, `${b.cls} top edge`).toBeGreaterThanOrEqual(top);
      expect(b.x + b.w, `${b.cls} right edge`).toBeLessThanOrEqual(a.width - right);
      expect(b.y + b.h, `${b.cls} bottom edge`).toBeLessThanOrEqual(a.height - bottom);
    }
    await ctx.close();
  });
}

/** Re-exported for the device spec. */
export type { Page };
