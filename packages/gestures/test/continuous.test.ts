/**
 * The continuous hand channel (ADR-0009, milestone 06M-M2) on synthetic landmark sequences:
 * grip follows the hand's closure, push follows its approach toward the camera, twist follows a
 * wrist turn — for either hand, anywhere in the frame, at 30, 15 and 8 fps — while a relaxed or
 * trembling hand stays below the authority's engage grip and dead zones, and a lost hand reads
 * open and still at once. Synthetic hands only; real-camera behaviour needs people (PHASE-06M).
 */
import { describe, expect, it } from 'vitest';
import {
  AUTHORITY_THRESHOLDS,
  ContinuousMapper,
  knuckleRoll,
  type HandChannel,
  type LandmarksFrame,
} from '../src/index.js';
import { aspectCorrect, handFeatures } from '../src/features.js';
import { SHAPES, timeline, type Key } from '../src/synthetic.js';

const H = AUTHORITY_THRESHOLDS;
const FPS = [30, 15, 8] as const;

interface Sample extends HandChannel {
  readonly t: number;
}

/** Runs a timeline through a mapper; `t` in the samples is ms since the timeline's first frame. */
function run(frames: readonly LandmarksFrame[], mapper = new ContinuousMapper()): Sample[] {
  const t0 = frames[0]?.t ?? 0;
  return frames.map((fr) => {
    const h = fr.hands[0];
    const aspect = fr.width / fr.height;
    const f = h ? handFeatures(h.landmarks, aspect, h.handedness) : null;
    const roll = h ? knuckleRoll(aspectCorrect(h.landmarks, aspect), h.handedness) : null;
    return { t: fr.t - t0, ...mapper.update(f, roll, fr.t) };
  });
}

const between = (s: readonly Sample[], a: number, b: number) =>
  s.filter((x) => x.t >= a * 1000 && x.t <= b * 1000);
const max = (s: readonly Sample[], k: keyof HandChannel) => Math.max(...s.map((x) => x[k]));
const min = (s: readonly Sample[], k: keyof HandChannel) => Math.min(...s.map((x) => x[k]));
const pct = (v: readonly number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

describe('grip', () => {
  for (const fps of FPS) {
    it(`rises steadily from an open palm to a fist and back (${fps} fps)`, () => {
      const keys: Key[] = [
        { t: 0, hand: { shape: 'open' } },
        { t: 0.5, hand: { curls: [...SHAPES.open.curls] } },
        { t: 1.5, hand: { curls: [1, 1, 1, 1] } },
        { t: 2.0, hand: { curls: [1, 1, 1, 1] } },
        { t: 3.0, hand: { curls: [...SHAPES.open.curls] } },
      ];
      const s = run(timeline({ seconds: 3.6, fps, keys }));
      expect(max(between(s, 0, 0.5), 'grip')).toBeLessThan(0.1);
      expect(min(between(s, 1.75, 2.0), 'grip')).toBeGreaterThan(0.9);
      expect(max(between(s, 3.3, 3.6), 'grip')).toBeLessThan(0.1);
      const closing = between(s, 0.5, 1.75);
      for (let i = 1; i < closing.length; i++)
        expect(closing[i]!.grip).toBeGreaterThanOrEqual(closing[i - 1]!.grip - 0.02);
      // Crosses the authority's engage grip on the way in, its release grip on the way out.
      expect(closing.some((x) => x.grip >= H.engageGrip)).toBe(true);
      expect(between(s, 2.0, 3.3).some((x) => x.grip <= H.releaseGrip)).toBe(true);
    });
  }

  it('a relaxed, trembling hand never reaches the engage grip', () => {
    for (const fps of FPS) {
      const keys: Key[] = [];
      for (let i = 0; i <= 40; i++)
        keys.push({ t: i * 0.25, hand: { shape: 'relaxed', cx: 0.5 + 0.02 * Math.sin(i * 1.7) } });
      const s = run(timeline({ seconds: 10, fps, keys, noise: 0.004, seed: fps }));
      expect(max(s, 'grip')).toBeLessThan(H.engageGrip - 0.15);
    }
  });
});

describe('push', () => {
  for (const fps of FPS) {
    it(`an approach toward the camera pushes, drawing back pulls, holding still settles (${fps} fps)`, () => {
      const keys: Key[] = [
        { t: 0, hand: { shape: 'open', size: 0.15 } },
        { t: 0.6, hand: { size: 0.15 } },
        { t: 0.95, hand: { size: 0.195 } },
        { t: 1.8, hand: { size: 0.195 } },
        { t: 2.15, hand: { size: 0.15 } },
        { t: 3.0, hand: { size: 0.15 } },
      ];
      const s = run(timeline({ seconds: 3.0, fps, keys }));
      expect(max(between(s, 0.6, 1.2), 'push')).toBeGreaterThan(0.5);
      expect(Math.abs(between(s, 1.6, 1.8).at(-1)!.push)).toBeLessThan(H.pushDeadZone);
      expect(min(between(s, 1.8, 2.4), 'push')).toBeLessThan(-0.5);
      expect(Math.abs(s.at(-1)!.push)).toBeLessThan(H.pushDeadZone);
    });
  }

  it('landmark jitter and a drifting hand stay inside the dead zone almost always', () => {
    for (const fps of FPS) {
      const keys: Key[] = [];
      for (let i = 0; i <= 40; i++)
        keys.push({ t: i * 0.25, hand: { shape: 'open', cy: 0.55 + 0.03 * Math.sin(i * 0.9) } });
      const share = (s: readonly Sample[]) =>
        s.filter((x) => Math.abs(x.push) > H.pushDeadZone).length / s.length;
      // Typical tracking jitter (the synthetic default): pushes past the dead zone are rare.
      const typical = run(timeline({ seconds: 10, fps, keys, seed: 7 + fps }));
      expect(share(typical), `${fps} fps, typical jitter`).toBeLessThan(0.05);
      // Twice that: a few more slip through, and only weakly.
      const heavy = run(timeline({ seconds: 10, fps, keys, noise: 0.004, seed: 7 + fps }));
      expect(share(heavy), `${fps} fps, heavy jitter`).toBeLessThan(0.15);
      expect(
        pct(
          heavy.map((x) => Math.abs(x.push)),
          0.99,
        ),
        `${fps} fps`,
      ).toBeLessThan(0.4);
    }
  });
});

describe('twist', () => {
  const turn = (handedness: 'left' | 'right', imageRoll: number, cx = 0.5, fps = 30) =>
    run(
      timeline({
        seconds: 1.6,
        fps,
        keys: [
          { t: 0, hand: { shape: 'fist', handedness, cx, roll: 0 } },
          { t: 0.4, hand: { roll: 0 } },
          { t: 0.9, hand: { roll: imageRoll } },
          { t: 1.6, hand: { roll: imageRoll } },
        ],
      }),
    );

  it('a clockwise wrist turn (as the player sees it) is a positive twist, for either hand, anywhere', () => {
    // The raw camera image sees the player's clockwise turn counter-clockwise; the synthetic
    // left hand is a mirrored right hand, so the same physical turn is the opposite model roll.
    for (const cx of [0.3, 0.5, 0.7]) {
      for (const fps of FPS) {
        const right = turn('right', -0.6, cx, fps);
        const left = turn('left', 0.6, cx, fps);
        // 0.6 rad (34°) of a 50° range, less the 4° tremor allowance: ≈ 0.6.
        for (const s of [right, left]) {
          expect(Math.abs(between(s, 0, 0.4).at(-1)!.twist)).toBeLessThan(H.twistDeadZone);
          expect(s.at(-1)!.twist).toBeGreaterThan(0.5);
          expect(s.at(-1)!.twist).toBeLessThan(0.8);
        }
        expect(turn('right', 0.6, cx, fps).at(-1)!.twist).toBeLessThan(-0.5);
      }
    }
  });

  it('a lost hand reads open and still at once; on its return the twist zeroes on how it is held', () => {
    const frames = timeline({
      seconds: 3,
      fps: 30,
      keys: [
        { t: 0, hand: { shape: 'fist', roll: 0 } },
        { t: 0.8, hand: { roll: -0.6 } },
        { t: 1.2, hand: { roll: -0.3 } },
      ],
      dropouts: [[1.0, 1.5]],
    });
    const s = run(frames);
    expect(s.find((x) => x.t > 1050 && x.t < 1450)).toMatchObject({ grip: 0, push: 0, twist: 0 });
    const back = between(s, 1.7, 3);
    expect(Math.max(...back.map((x) => Math.abs(x.twist)))).toBeLessThan(H.twistDeadZone);
    expect(min(back, 'grip')).toBeGreaterThan(0.9);
  });

  it('with a calibrated neutral, the turn is measured from it from the first frame', () => {
    const first = timeline({
      seconds: 0.1,
      fps: 30,
      keys: [{ t: 0, hand: { shape: 'fist' } }],
    })[0]!;
    const neutral = knuckleRoll(
      aspectCorrect(first.hands[0]!.landmarks, first.width / first.height),
      'right',
    );
    const mapper = new ContinuousMapper({ openBend: 0.45, fistBend: 2.5, neutralRoll: neutral });
    const s = run(
      timeline({ seconds: 0.6, fps: 30, keys: [{ t: 0, hand: { shape: 'fist', roll: -0.5 } }] }),
      mapper,
    );
    expect(s.at(-1)!.twist).toBeGreaterThan(0.4);
  });

  it('tremor keeps the twist inside the dead zone', () => {
    const keys: Key[] = [];
    for (let i = 0; i <= 40; i++)
      keys.push({ t: i * 0.25, hand: { shape: 'fist', roll: 0.03 * Math.sin(i * 2.3) } });
    for (const fps of FPS) {
      const s = run(timeline({ seconds: 10, fps, keys, noise: 0.004, seed: 3 + fps }));
      expect(
        pct(
          s.map((x) => Math.abs(x.twist)),
          0.95,
        ),
      ).toBeLessThan(H.twistDeadZone);
    }
  });
});
