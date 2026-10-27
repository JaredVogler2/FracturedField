/**
 * Milestone 06M (ADR-0009) — the Hands Lab in the real game: continuous manipulation through the
 * authority. A mouse player and a camera player (a synthetic hand through the real camera
 * controller and gesture engine) each complete all four tasks — set the core down in a ring,
 * throw it into the gate, curve it in with a wrist turn, and sweep a boulder out of a lane with
 * an open hand — judged from authoritative frames. The export holds task metrics only.
 *
 * The players are closed-loop stand-ins for a person: they watch the public snapshot (what is on
 * screen) and time a release by the core's position, as a person times one by eye. The authority
 * runs at half speed (test runs only) so this software-rendered page's slow frames do not decide
 * outcomes. Whether *people* find it intuitive is the study in docs/progress/PHASE-06M.md.
 */
import { expect, test, type Page } from '@playwright/test';
import { cameraActive, drive, handFor, learnAim, type AimMap, type HandPose } from './camera';

interface Body {
  id: number;
  kind: string;
  p: [number, number, number];
  v: [number, number, number];
  s?: number;
}
interface LabSnap {
  match: { phase: string };
  players: { m: [number, number]; grasp: number }[];
  entities: Body[];
}

const labSnap = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __ffDebug?: { snapshot(): unknown } }).__ffDebug?.snapshot() ?? null,
  ) as Promise<LabSnap | null>;

const project = (page: Page, x: number, z: number) =>
  page.evaluate(
    ([a, b]) =>
      (
        window as unknown as {
          __ffDebug: { project(x: number, y: number, z: number): { x: number; y: number } | null };
        }
      ).__ffDebug.project(a!, 1.1, b!),
    [x, z],
  );

const core = async (page: Page) => (await labSnap(page))!.entities.find((e) => e.kind === 'core')!;
const grasp = async (page: Page) => (await labSnap(page))!.players[0]!.grasp;
/** The boulder nearest (x, z). */
const boulderNear = async (page: Page, x: number, z: number) =>
  (await labSnap(page))!.entities
    .filter((e) => e.kind === 'boulder')
    .reduce((a, b) =>
      Math.hypot(a.p[0] - x, a.p[2] - z) < Math.hypot(b.p[0] - x, b.p[2] - z) ? a : b,
    );

const status = (page: Page) => page.getByTestId('lab-status');

/**
 * Waits until the core is held still over the ring (as a person holds it there before letting
 * go): within `r` of the ring's centre and slower than 0.5 m/s.
 */
const heldOverRing = (page: Page, r: number) =>
  expect
    .poll(
      async () => {
        const c = await core(page);
        return Math.hypot(c.p[0] + 6, c.p[2] - 4) < r && Math.hypot(...c.v) < 0.5;
      },
      { timeout: 20_000 },
    )
    .toBe(true);

async function openLab(page: Page, controls?: 'camera') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Half-speed authority (test runs only): every hand frame of this slow page reaches it in time.
  await page.goto('/lab/hands?test=1&quality=low&seed=3&timescale=0.5');
  if (controls === 'camera') {
    await page.getByTestId('controls-camera').click();
    await cameraActive(page);
  }
  await page.getByTestId('start-match').click();
  await expect(page.getByTestId('hands-lab')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await labSnap(page))?.match.phase, { timeout: 30_000 })
    .toBe('playing');
  return errors;
}

/**
 * Selects a task (from the keyboard, so the mouse stays where the hand is) and waits until its
 * core is where it starts. The players first put their hand over that spot: an open hand moving
 * fast across the field is a stroke and would sweep the freshly placed core away.
 */
async function startTask(page: Page, id: string, at: readonly [number, number]) {
  await page.getByTestId(`lab-task-${id}`).press('Enter');
  await expect
    .poll(async () => {
      const c = await core(page);
      return Math.hypot(c.p[0] - at[0], c.p[2] - at[1]);
    })
    .toBeLessThan(0.3);
  await expect(status(page)).toHaveText(/Tries 0/);
}

/* ------------------------------------------------------------------------------------------ */
/* Mouse                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const mouseAt = async (page: Page, x: number, z: number) => {
  const p = (await project(page, x, z))!;
  await page.mouse.move(p.x, p.y);
};

/** Presses on (x0, z0), waits for the grip, and drags to (x1, z1) in `steps`. */
async function mouseGripAndDrag(
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
  steps: number,
  pauseMs: number,
) {
  await mouseAt(page, from[0], from[1]);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await expect.poll(() => grasp(page)).toBeGreaterThanOrEqual(0);
  for (let i = 1; i <= steps; i++) {
    await mouseAt(
      page,
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    );
    await page.waitForTimeout(pauseMs);
  }
}

/**
 * Winds the held core back to x = −14 on its line, swings the hand toward the gate and lets go
 * once the core passes x = −6 (the hand is still moving fast there). `notches` of the wheel turn
 * the grip anticlockwise first (it stays turned while held).
 */
async function mouseSwingAndRelease(page: Page, z: number, notches = 0) {
  await mouseGripAndDrag(page, [-8, z], [-14, z], 4, 150);
  await expect.poll(async () => (await core(page)).p[0], { timeout: 15_000 }).toBeLessThan(-12.5);
  for (let k = 0; k < notches; k++) await page.mouse.wheel(0, 100);
  for (let i = 1; i <= 4; i++) await mouseAt(page, -14 + (16 * i) / 4, z);
  await expect
    .poll(async () => (await core(page)).p[0], { timeout: 10_000, intervals: [30] })
    .toBeGreaterThan(-6);
  await page.mouse.up();
  await expect.poll(() => grasp(page)).toBe(-1);
}

test('Hands Lab, mouse: place, throw, curve and clear; the export holds task metrics only', async ({
  page,
}) => {
  test.setTimeout(420_000);
  const errors = await openLab(page);
  await expect(page.getByTestId('lab-goal')).toHaveText(/ring/);

  // Place: grip the core, carry it over the ring (still held), open the hand.
  await expect.poll(async () => (await core(page)).p[0]).toBeCloseTo(-12, 0);
  await mouseGripAndDrag(page, [-12, -4], [-6, 4], 16, 80);
  await heldOverRing(page, 0.8);
  expect(await grasp(page)).toBe((await core(page)).id); // carried, not pushed
  await page.mouse.up();
  await expect(status(page)).toHaveText(/Done in/, { timeout: 20_000 });

  // Throw: swing and let go mid-swing; the core flies on with the swing's speed.
  await mouseAt(page, -8, 0);
  await startTask(page, 'throw', [-8, 0]);
  await mouseSwingAndRelease(page, 0);
  expect((await core(page)).v[0]).toBeGreaterThan(4);
  await expect(status(page)).toHaveText(/Done in/, { timeout: 30_000 });

  // Curve: the same swing from the side with the grip turned anticlockwise (one notch of the
  // wheel); the spinning core bends back toward the middle of the gate.
  await mouseAt(page, -8, 3);
  await startTask(page, 'curve', [-8, 3]);
  await mouseSwingAndRelease(page, 3, 1);
  expect((await core(page)).s ?? 0).toBeGreaterThan(1); // it carries the wrist's spin
  await expect(status(page)).toHaveText(/Done in/, { timeout: 30_000 });

  // Clear: open-hand strokes (no button) through the boulder push it out of its lane.
  await startTask(page, 'clear', [-15, 9]);
  const b0 = await boulderNear(page, -6, 0);
  expect(Math.hypot(b0.p[0] + 6, b0.p[2])).toBeLessThan(0.3);
  for (let stroke = 0; stroke < 4; stroke++) {
    if (/Done in/.test((await status(page).textContent()) ?? '')) break;
    for (const [x, z] of [
      [-13, 6],
      [-13, -6],
      [-6, -6],
    ] as const) {
      await mouseAt(page, x, z);
      await page.waitForTimeout(400);
    }
    for (let i = 1; i <= 12; i++) {
      await mouseAt(page, -6, -6 + i);
      await page.waitForTimeout(250);
    }
    await mouseAt(page, -13, 6);
    await expect
      .poll(async () => Math.hypot(...(await boulderNear(page, -6, 3)).v), { timeout: 15_000 })
      .toBeLessThan(0.2);
  }
  await expect(status(page)).toHaveText(/Done in/, { timeout: 20_000 });
  // Every task is done, and none by a grip on the boulder (the clear try stays clean).
  for (const id of ['place', 'throw', 'curve', 'clear'])
    await expect(page.getByTestId(`lab-task-${id}`)).toHaveClass(/done/);

  // The export: task metrics only — no images, no landmarks.
  const download = page.waitForEvent('download');
  await page.getByTestId('lab-export').click();
  const file = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(file, 'utf8')) as {
    kind: string;
    results: Record<string, unknown>[];
  };
  expect(data.kind).toBe('fracture-field-hands-lab');
  expect(data.results.map((r) => r.id)).toEqual(['place', 'throw', 'curve', 'clear']);
  for (const r of data.results) {
    expect(Object.keys(r).sort()).toEqual(
      ['at', 'attempts', 'id', 'input', 'lostSeconds', 'seconds'].sort(),
    );
    expect(r.input).toBe('pointer');
  }
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------------------------------ */
/* Camera                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Shows the synthetic hand over world (x, z). */
const hand = (page: Page, map: AimMap, x: number, z: number, pose: Omit<HandPose, 'cx' | 'cy'>) => {
  const [cx, cy] = handFor(map, x, z);
  return drive(page, { size: 0.15, ...pose, cx, cy });
};

/** An open hand over (x, z), then a fist: waits for the authority's grip on the core. */
async function cameraGrip(page: Page, map: AimMap, x: number, z: number) {
  await hand(page, map, x, z, { shape: 'open' });
  await page.waitForTimeout(1500);
  await hand(page, map, x, z, { shape: 'fist' });
  await expect.poll(() => grasp(page), { timeout: 15_000 }).toBe((await core(page)).id);
}

/** Fist moving from (x0, z0) to (x1, z1) in `steps`. */
async function cameraCarry(
  page: Page,
  map: AimMap,
  from: readonly [number, number],
  to: readonly [number, number],
  steps: number,
  pose: Omit<HandPose, 'cx' | 'cy'> = { shape: 'fist' },
) {
  for (let i = 1; i <= steps; i++) {
    await hand(
      page,
      map,
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
      pose,
    );
    await page.waitForTimeout(250);
  }
}

/**
 * Corrects the fist's aim by eye — moving it by the held core's offset from the ring's centre —
 * until the core is held still within 0.5 m of the centre (the hand → field map the player
 * learned is only approximate).
 */
async function cameraHoldOverRing(page: Page, map: AimMap) {
  let aim: [number, number] = [-6, 4];
  for (let i = 0; i < 6; i++) {
    const c = await core(page);
    const off: [number, number] = [c.p[0] + 6, c.p[2] - 4];
    if (Math.hypot(...off) < 0.5 && Math.hypot(...c.v) < 0.5) break;
    aim = [aim[0] - off[0], aim[1] - off[1]];
    await hand(page, map, aim[0], aim[1], { shape: 'fist' });
    await page.waitForTimeout(1000);
  }
  await heldOverRing(page, 0.6);
  return aim;
}

/** Grip, wind up, swing toward the gate and open the hand once the core passes x = −6. */
async function cameraSwingAndRelease(page: Page, map: AimMap, z: number, roll = 0) {
  await cameraGrip(page, map, -8, z);
  await cameraCarry(page, map, [-8, z], [-14, z], 4);
  await expect.poll(async () => (await core(page)).p[0], { timeout: 15_000 }).toBeLessThan(-12.5);
  await cameraCarry(page, map, [-14, z], [-14, z], 2, { shape: 'fist', roll });
  // A fast swing, a few frames long: a hand that jumped across the image in one frame would read
  // as lost to the tracker (and a lost hand reads open).
  for (let i = 1; i <= 4; i++) {
    await hand(page, map, -14 + 4 * i, z, { shape: 'fist', roll });
    await page.waitForTimeout(120);
  }
  await expect
    .poll(async () => (await core(page)).p[0], { timeout: 10_000, intervals: [30] })
    .toBeGreaterThan(-6);
  await hand(page, map, 2, z, { shape: 'open', roll: 0 });
  await expect.poll(() => grasp(page), { timeout: 10_000 }).toBe(-1);
}

test('Hands Lab, camera: a tracked hand places, throws, curves and clears', async ({ page }) => {
  test.setTimeout(480_000);
  // A small canvas leaves the software-rendered page time to feed the camera controller.
  await page.setViewportSize({ width: 640, height: 360 });
  const errors = await openLab(page, 'camera');
  const map = await learnAim(page);

  // Place: learning the aim moved an open hand around the field, so restart the task first —
  // with the hand already over the core's start.
  await hand(page, map, -12, -4, { shape: 'open' });
  await page.waitForTimeout(1500);
  await page.getByTestId('lab-restart').press('Enter');
  await expect.poll(async () => (await core(page)).p[0]).toBeCloseTo(-12, 0);
  await cameraGrip(page, map, -12, -4);
  await expect(page.getByTestId('lab-meters')).toContainText('core');
  await cameraCarry(page, map, [-12, -4], [-6, 4], 12);
  const [ax, az] = await cameraHoldOverRing(page, map);
  await hand(page, map, ax, az, { shape: 'open' });
  await expect(status(page)).toHaveText(/Done in/, { timeout: 30_000 });

  // Throw: a swing of the fist, opened mid-swing.
  await hand(page, map, -8, 0, { shape: 'open' });
  await page.waitForTimeout(1500);
  await startTask(page, 'throw', [-8, 0]);
  await cameraSwingAndRelease(page, map, 0);
  expect((await core(page)).v[0]).toBeGreaterThan(4);
  await expect(status(page)).toHaveText(/Done in/, { timeout: 30_000 });

  // Curve: the wrist turned anticlockwise through the swing (synthetic roll +0.35 rad, 20°).
  await hand(page, map, -8, 3, { shape: 'open' });
  await page.waitForTimeout(1500);
  await startTask(page, 'curve', [-8, 3]);
  await cameraSwingAndRelease(page, map, 3, 0.35);
  expect((await core(page)).s ?? 0).toBeGreaterThan(1);
  await expect(status(page)).toHaveText(/Done in/, { timeout: 30_000 });

  // Clear: open-hand strokes through the boulder.
  await startTask(page, 'clear', [-15, 9]);
  for (let stroke = 0; stroke < 4; stroke++) {
    if (/Done in/.test((await status(page).textContent()) ?? '')) break;
    for (const [x, z] of [
      [-13, 6],
      [-13, -6],
      [-6, -6],
    ] as const) {
      await hand(page, map, x, z, { shape: 'open' });
      await page.waitForTimeout(500);
    }
    await cameraCarry(page, map, [-6, -6], [-6, 6], 12, { shape: 'open' });
    await hand(page, map, -13, 6, { shape: 'open' });
    await expect
      .poll(async () => Math.hypot(...(await boulderNear(page, -6, 3)).v), { timeout: 15_000 })
      .toBeLessThan(0.2);
  }
  await expect(status(page)).toHaveText(/Done in/, { timeout: 20_000 });
  await expect(page.getByTestId('lab-meters')).toContainText('camera');
  expect(errors).toEqual([]);
});
