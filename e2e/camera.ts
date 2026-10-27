/**
 * Shared helpers for camera-control browser tests. They read the same public state a player sees
 * (the `?test=1` debug hook) and feed synthetic landmarks into the page's real camera controller
 * (`__ffCamera`); none of them grants the test any authority over the match.
 */
import { expect, type Page } from '@playwright/test';

export interface CamSnap {
  match: { phase: string; score: [number, number]; roundWins: [number, number] };
  players: {
    m: [number, number];
    hold: string | null;
    cd: Record<string, number>;
    energy: number;
  }[];
  entities: { kind: string; p: [number, number, number]; v?: [number, number, number] }[];
  effects: { kind: string; owner: number }[];
}

export const snap = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __ffDebug?: { snapshot(): unknown } }).__ffDebug?.snapshot() ?? null,
  ) as Promise<CamSnap | null>;

export interface CameraStatus {
  state: string;
  error: string | null;
  track: { state: string; shape: string; handsVisible: number } | null;
  stats: { fps: number; inferMs: number; latencyMs: number; delegate: string } | null;
  practiced: Record<string, number>;
}

export const camera = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __ffCamera?: { status(): unknown } }).__ffCamera?.status() ?? null,
  ) as Promise<CameraStatus | null>;

/** Skips the camera wizard: synthetic frames enter the same controller the camera feeds. */
export const cameraActive = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __ffCamera: { setStep(s: string): void } }).__ffCamera.setStep(
      'active',
    ),
  );

/** Plays a synthetic timeline through the page's camera controller (in real time). */
export const play = (page: Page, spec: unknown) =>
  page.evaluate(
    (s) =>
      (window as unknown as { __ffCamera: { play(x: unknown): Promise<void> } }).__ffCamera.play(s),
    spec,
  );

export interface HandPose {
  cx?: number;
  cy?: number;
  size?: number;
  shape?: 'open' | 'fist' | 'point' | 'vee' | 'thumb' | 'ok' | 'relaxed' | 'three';
  /** In-plane rotation (radians, clockwise in the camera image). */
  roll?: number;
}

/** Moves the page's live synthetic hand (`null` = out of frame, 'stop' = camera feed off). */
export const drive = (page: Page, pose: HandPose | null | 'stop') =>
  page.evaluate(
    (p) =>
      (window as unknown as { __ffCamera: { drive(x: unknown): Promise<void> } }).__ffCamera.drive(
        p,
      ),
    pose,
  );

export type Vec = [number, number];

/** Hand position (normalised image coordinates) → force point, learned by moving the hand. */
export interface AimMap {
  h0: Vec;
  w0: Vec;
  /** Inverse of the 2×2 hand → world Jacobian. */
  inv: [Vec, Vec];
}

/** Waits until seat 0's force point stops moving (it follows the aim with a short lag). */
async function settled(page: Page): Promise<Vec | null> {
  let prev: Vec | null = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const s = await snap(page);
    if (!s || s.match.phase !== 'playing') return null;
    const m = s.players[0]!.m;
    if (prev && Math.hypot(m[0] - prev[0], m[1] - prev[1]) < 0.02) return m;
    prev = m;
  }
  return null;
}

/**
 * Like a player getting used to the controls: move the (live synthetic) hand to three places and
 * watch where the force point goes. The mapping is linear inside the calibrated range, so three
 * points fix it. Leaves the live hand running at the first probe position.
 */
export async function learnAim(page: Page): Promise<AimMap> {
  const H: Vec[] = [
    [0.5, 0.5],
    [0.4, 0.5],
    [0.5, 0.42],
  ];
  for (let attempt = 0; attempt < 6; attempt++) {
    const W: Vec[] = [];
    for (const [cx, cy] of H) {
      await drive(page, { size: 0.15, shape: 'open', cx, cy });
      const m = await settled(page);
      if (!m) break;
      W.push(m);
    }
    if (W.length < H.length) {
      // A goal interrupted the probe (kickoff resets force points): start over.
      await playing(page);
      continue;
    }
    const [w0, w1, w2] = W as [Vec, Vec, Vec];
    const dxh = H[1]![0] - H[0]![0];
    const dyh = H[2]![1] - H[0]![1];
    const jx: Vec = [(w1[0] - w0[0]) / dxh, (w1[1] - w0[1]) / dxh];
    const jy: Vec = [(w2[0] - w0[0]) / dyh, (w2[1] - w0[1]) / dyh];
    const det = jx[0] * jy[1] - jy[0] * jx[1];
    // The hand steers the force point in two independent directions.
    expect(Math.abs(det)).toBeGreaterThan(50);
    return {
      h0: H[0]!,
      w0,
      inv: [
        [jy[1] / det, -jy[0] / det],
        [-jx[1] / det, jx[0] / det],
      ],
    };
  }
  throw new Error('could not learn the hand → force point mapping');
}

/** Hand position that puts seat 0's force point at (x, z), inside the default calibrated range. */
export function handFor(map: AimMap, x: number, z: number): Vec {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const dx = x - map.w0[0];
  const dz = z - map.w0[1];
  return [
    clamp(map.h0[0] + map.inv[0][0] * dx + map.inv[0][1] * dz, 0.24, 0.76),
    clamp(map.h0[1] + map.inv[1][0] * dx + map.inv[1][1] * dz, 0.24, 0.83),
  ];
}

export interface Ack {
  n: number;
  /** Arrival time on the page clock (ms). */
  at: number;
  slot: number;
  action?: string;
  accepted: boolean;
  reason?: string;
}
export interface Cast {
  n: number;
  tick: number;
  slot: number;
  ability: string;
  phase: string;
  /** PULSE: strength on the core (0 = the core was out of reach). */
  mag: number;
}
interface DebugLog {
  mark(): number;
  acks(): Ack[];
  casts(): Cast[];
}

/** Authority verdicts and cast events this page received after `mark`. */
export const log = (page: Page, mark = 0) =>
  page.evaluate((m) => {
    const d = (window as unknown as { __ffDebug: DebugLog }).__ffDebug;
    return {
      mark: d.mark(),
      acks: d.acks().filter((a) => a.n > m),
      casts: d.casts().filter((c) => c.n > m),
    };
  }, mark);

export const playing = (page: Page) =>
  expect.poll(async () => (await snap(page))?.match.phase, { timeout: 30_000 }).toBe('playing');

/** Refusals that reflect the match situation, not the input: retried at the next opportunity. */
const SITUATIONAL = ['not_playing', 'out_of_range'];

/**
 * Performs a gesture during open play until the authority accepts it from the page's seat. The
 * bot can score mid-gesture, which pauses play (`not_playing`), and LIFT needs a body in range
 * (`out_of_range`): those are match situations, so the gesture is retried. A gesture the engine
 * fails to recognise is never retried — that fails the test.
 */
export async function castByGesture<T>(
  page: Page,
  action: string,
  run: () => Promise<T>,
  opts: { slot?: 0 | 1; interrupted?: (result: T) => boolean } = {},
): Promise<{ mark: number; result: T }> {
  const slot = opts.slot ?? 0;
  const interrupted = opts.interrupted ?? (() => false);
  const history: string[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    await playing(page);
    const { mark } = await log(page);
    const result = await run();
    await page.waitForTimeout(400); // verdict round trip
    const mine = (await log(page, mark)).acks.filter((a) => a.slot === slot && a.action === action);
    expect(mine.length, `the ${action} gesture was not recognised`).toBeGreaterThan(0);
    const accepted = mine.some((a) => a.accepted);
    if (accepted && !interrupted(result)) return { mark, result };
    // The release that follows a refused start is itself refused as 'invalid': look past it.
    const reasons = mine.filter((a) => !a.accepted && a.reason !== 'invalid').map((a) => a.reason);
    if (!accepted)
      expect(
        reasons.length > 0 && reasons.every((r) => SITUATIONAL.includes(r ?? '')),
        `${action} refused: ${reasons.join(',')}`,
      ).toBe(true);
    history.push(accepted ? 'interrupted by a goal' : reasons.join(','));
  }
  throw new Error(`${action} never completed in open play: ${history.join(' | ')}`);
}
