/**
 * D05 gesture suite on synthetic landmark sequences: every gesture with positive, negative and
 * borderline cases, dropout behaviour, bystander lock, mirroring/handedness, aspect ratios and an
 * idle false-positive budget. Synthetic hands only — real-camera behaviour is verified separately.
 */
import { describe, expect, it } from 'vitest';
import {
  Calibrator,
  GestureEngine,
  type CalibrationProgress,
  type GestureEvent,
  type LandmarksFrame,
} from '../src/index.js';
import { handFeatures } from '../src/features.js';
import { timeline } from '../src/synthetic.js';
import { HOME, THUMB_UP_ROLL, idle, pulse, sign, still, swipe, wave } from './fixtures.js';

function run(frames: readonly LandmarksFrame[], engine = new GestureEngine()) {
  const events: GestureEvent[] = [];
  const outputs = frames.map((f) => {
    const o = engine.process(f);
    events.push(...o.events);
    return o;
  });
  return { events, outputs, engine };
}

const casts = (events: readonly GestureEvent[]) => events.filter((e) => e.phase !== 'end');
const summary = (events: readonly GestureEvent[]) => events.map((e) => `${e.action}:${e.phase}`);

describe('gesture recognition: positives', () => {
  it('PULSE: a quick open-palm push toward the camera casts exactly once', () => {
    const { events } = run(pulse());
    expect(summary(events)).toEqual(['pulse:tap']);
  });

  it('PULSE fires once per push (two pushes, two casts)', () => {
    const a = pulse({ seed: 1 });
    const b = pulse({ seed: 2 }).map((f) => ({ ...f, t: f.t + 2400 }));
    const { events } = run([...a, ...b]);
    expect(summary(events)).toEqual(['pulse:tap', 'pulse:tap']);
  });

  it('SWEEP: one stroke = one cast, direction in screen space (mirrored for a facing camera)', () => {
    // Moving to the player's right = toward the image's left for a camera facing them.
    expect(run(swipe([0.62, 0.55], [0.32, 0.55])).events).toEqual([
      expect.objectContaining({ action: 'sweep', phase: 'tap', dir: [1, 0] }),
    ]);
    expect(run(swipe([0.32, 0.55], [0.62, 0.55])).events).toEqual([
      expect.objectContaining({ action: 'sweep', dir: [-1, 0] }),
    ]);
    expect(run(swipe([0.5, 0.82], [0.5, 0.3])).events).toEqual([
      expect.objectContaining({ action: 'sweep', dir: [0, 1] }),
    ]);
  });

  it('LIFT: a fist starts the hold, opening the hand ends it', () => {
    const { events } = run(sign('fist', 1.0));
    expect(summary(events)).toEqual(['lift:start', 'lift:end']);
    const start = events[0]!.t - 1000; // timeline starts at 1000 ms
    expect(start).toBeGreaterThan(800 + 250); // after the dwell, never instantly
    expect(start).toBeLessThan(800 + 450);
    expect(events[1]!.t - 1000).toBeLessThan(1800 + 300);
  });

  it('WET (vee), HEAT (thumbs-up), PICK 1 (point) and PICK 2 (OK sign) each cast once', () => {
    expect(summary(run(sign('vee', 0.6)).events)).toEqual(['wet:tap']);
    expect(summary(run(sign('thumb', 0.7, { roll: THUMB_UP_ROLL })).events)).toEqual(['heat:tap']);
    expect(summary(run(sign('point', 0.8)).events)).toEqual(['pick1:start', 'pick1:end']);
    expect(summary(run(sign('ok', 0.8)).events)).toEqual(['pick2:start', 'pick2:end']);
    // Three fingers is a recognised shape but not a cast (the pinky is too unreliable alone).
    expect(casts(run(sign('three', 0.8)).events)).toEqual([]);
  });

  it('GUARD: palm turned up and held, or both open palms brought together', () => {
    const palmUp = timeline({
      seconds: 2.2,
      keys: [
        { t: 0, hand: { ...HOME, shape: 'open', pitch: 0 } },
        { t: 0.8, hand: { pitch: 0 } },
        { t: 1.0, hand: { pitch: -Math.PI / 2 } },
        { t: 1.8, hand: { pitch: -Math.PI / 2 } },
        { t: 2.0, hand: { pitch: 0 } },
      ],
    });
    expect(summary(run(palmUp).events)).toEqual(['guard:tap']);
    const together = timeline({
      seconds: 2,
      keys: [{ t: 0, hand: { cx: 0.46, cy: 0.55, size: 0.15, shape: 'open' } }],
      other: [
        { t: 0.6, hand: { cx: 0.56, cy: 0.55, size: 0.15, shape: 'open', handedness: 'left' } },
      ],
    });
    expect(summary(run(together).events)).toEqual(['guard:tap']);
  });

  it('two different signs in quick succession cast once each', () => {
    const frames = timeline({
      seconds: 2.6,
      keys: [
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { shape: 'vee' } },
        { t: 1.3, hand: { shape: 'point' } },
        { t: 2.0, hand: { shape: 'open' } },
      ],
    });
    expect(summary(run(frames).events)).toEqual(['wet:tap', 'pick1:start', 'pick1:end']);
  });
});

describe('gesture recognition: negatives and borderline', () => {
  it('idle: 20 minutes of relaxed aiming produce no cast (budget < 1 per 5 min)', () => {
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) total += casts(run(idle(60, seed * 13)).events).length;
    expect(total).toBe(0);
  });

  it('stress: a still hand with doubled landmark noise stays within the budget (≤ 1 per 5 min)', () => {
    let total = 0;
    for (let seed = 200; seed < 205; seed++) {
      const frames = timeline({
        seconds: 60,
        seed,
        noise: 0.005,
        keys: [{ t: 0, hand: { ...HOME, shape: 'relaxed' } }],
      });
      total += casts(run(frames).events).length;
    }
    expect(total).toBeLessThanOrEqual(1);
  });

  it('a greeting wave is not a sweep', () => {
    expect(casts(run(wave(0.04, 2.5)).events)).toEqual([]);
    expect(casts(run(wave(0.07, 2)).events)).toEqual([]);
  });

  it('slow motions are not casts: slow approach is not a push, a slow move is not a sweep', () => {
    expect(casts(run(pulse({ pushS: 1.4 })).events)).toEqual([]);
    expect(casts(run(swipe([0.62, 0.55], [0.32, 0.55], 2.5)).events)).toEqual([]);
  });

  it('borderline push: +12 % is ignored at default sensitivity; +18 % counts when sensitive', () => {
    expect(casts(run(pulse({ growth: 1.12 })).events)).toEqual([]);
    const sensitive = new GestureEngine({ sensitivity: 1.5 });
    expect(summary(run(pulse({ growth: 1.18 }), sensitive).events)).toEqual(['pulse:tap']);
  });

  it('a hand entering the frame large is not a push', () => {
    const frames = timeline({
      seconds: 1.2,
      keys: [
        { t: 0, hand: { ...HOME, size: 0.1, shape: 'open' } },
        { t: 0.2, hand: { size: 0.17 } },
      ],
    });
    expect(casts(run(frames).events)).toEqual([]);
  });

  it('a fist flicker (120 ms) does not lift; closing the hand does not fire passing shapes', () => {
    expect(casts(run(sign('fist', 0.12)).events)).toEqual([]);
    const closing = timeline({
      seconds: 2.2,
      keys: [
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { curls: [0.12, 0.1, 0.12, 0.14] } },
        { t: 0.95, hand: { curls: [1, 1, 1, 1], thumb: 1 } },
        { t: 1.8, hand: { shape: 'fist' } },
      ],
    });
    expect(summary(run(closing).events)).toEqual(['lift:start']);
  });

  it('a sideways thumb is not a thumbs-up', () => {
    expect(casts(run(sign('thumb', 0.8, { roll: 0 })).events)).toEqual([]);
  });

  it('camera motion (torso moves or grows with the hand) is not a sweep or a push', () => {
    const pan = timeline({
      seconds: 2,
      pose: true,
      keys: [
        { t: 0, hand: { cx: 0.62, cy: 0.55, size: 0.15, shape: 'open' } },
        { t: 1.0, hand: { cx: 0.62 } },
        { t: 1.3, hand: { cx: 0.32 } },
      ],
    });
    // The synthetic pose keeps its shoulders fixed, so move them with the hand: a camera pan.
    const panned = pan.map((f) => {
      if (!f.pose || f.hands.length === 0) return f;
      const dx = f.hands[0]!.landmarks[0]!.x - pan[0]!.hands[0]!.landmarks[0]!.x;
      return {
        ...f,
        pose: {
          ...f.pose,
          landmarks: f.pose.landmarks.map((p, i) =>
            i === 11 || i === 12 ? { ...p, x: p.x + dx } : p,
          ),
        },
      };
    });
    expect(casts(run(panned).events)).toEqual([]);
    const dolly = pulse().map((f, i, all) => {
      const s = f.hands[0] ? f.hands[0].landmarks[0]!.y : 0;
      void s;
      const g = (f.hands[0] && all[0]!.hands[0] ? handScale(f) / handScale(all[0]!) : 1) || 1;
      const w = 0.2 * g;
      const pts = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
      pts[11] = { x: 0.5 + w / 2, y: 0.85, z: 0 };
      pts[12] = { x: 0.5 - w / 2, y: 0.85, z: 0 };
      if (f.hands[0]) pts[16] = f.hands[0].landmarks[0]!;
      return { ...f, pose: { landmarks: pts, score: 0.9 } };
    });
    expect(casts(run(dolly).events)).toEqual([]);
  });
});

function handScale(f: LandmarksFrame): number {
  const h = f.hands[0]!;
  return handFeatures(h.landmarks, f.width / f.height, h.handedness)!.scale;
}

describe('tracking: dropouts, bystanders, handedness, mirroring, aspect ratios', () => {
  it('a 150 ms dropout keeps a held LIFT; an 800 ms dropout releases it within ~0.6 s', () => {
    const short = timeline({
      seconds: 3,
      dropouts: [[1.6, 1.75]],
      keys: [
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { shape: 'fist' } },
        { t: 2.4, hand: { shape: 'open' } },
      ],
    });
    expect(summary(run(short).events)).toEqual(['lift:start', 'lift:end']);
    const long = timeline({
      seconds: 3,
      dropouts: [[1.6, 2.4]],
      keys: [
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { shape: 'fist' } },
      ],
    });
    const { events, outputs } = run(long);
    expect(summary(events)).toEqual(['lift:start', 'lift:end']);
    const lostAt = 1000 + 1600;
    expect(events[1]!.t - lostAt).toBeGreaterThanOrEqual(500);
    expect(events[1]!.t - lostAt).toBeLessThan(600);
    // While lost, status says so and the aim is withheld; nothing re-lifts on return by itself.
    expect(outputs.some((o) => o.status.state === 'lost' && o.aim === null)).toBe(true);
  });

  it('a bystander hand does not take control (scale and continuity gates)', () => {
    const cal = new Calibrator(16 / 9);
    let done = null;
    for (const f of still(4.2)) {
      const h = f.hands[0]!;
      const feat = handFeatures(h.landmarks, f.width / f.height, h.handedness)!;
      done = cal.update(f.t, feat, true, 0).result ?? done;
    }
    expect(done?.palmScale).toBeGreaterThan(0);
    const engine = new GestureEngine({}, done);
    // Player's hand still at home; a small (far) right hand of a bystander moves around.
    const frames = timeline({
      seconds: 3,
      keys: [{ t: 0, hand: { ...HOME, shape: 'open' } }],
      other: [
        { t: 0.5, hand: { cx: 0.85, cy: 0.4, size: 0.05, shape: 'open', handedness: 'right' } },
        { t: 2.5, hand: { cx: 0.15, cy: 0.7 } },
      ],
    });
    const { outputs, events } = run(frames, engine);
    const aims = outputs.filter((o) => o.aim).map((o) => o.aim![0]);
    expect(Math.max(...aims) - Math.min(...aims)).toBeLessThan(0.15);
    expect(outputs.some((o) => o.status.rejected > 0)).toBe(true);
    expect(casts(events)).toEqual([]);
  });

  it('left-handed players cast with the left hand; the right hand is ignored for casting', () => {
    const lefty = new GestureEngine({ dominant: 'left' });
    expect(summary(run(sign('vee', 0.6, { handedness: 'left' }), lefty).events)).toEqual([
      'wet:tap',
    ]);
    expect(
      casts(
        run(sign('vee', 0.6, { handedness: 'right' }), new GestureEngine({ dominant: 'left' }))
          .events,
      ),
    ).toEqual([]);
  });

  it('a camera that does not face the player flips screen directions', () => {
    const engine = new GestureEngine({ facingUser: false });
    expect(run(swipe([0.62, 0.55], [0.32, 0.55]), engine).events).toEqual([
      expect.objectContaining({ action: 'sweep', dir: [-1, 0] }),
    ]);
  });

  it('works on 4:3 and portrait 9:16 frames', () => {
    for (const aspect of [4 / 3, 9 / 16]) {
      expect(summary(run(pulse({ aspect })).events), `pulse ${aspect}`).toEqual(['pulse:tap']);
      const s = swipe([0.5, 0.82], [0.5, 0.3], 0.3, { aspect });
      expect(casts(run(s).events), `sweep ${aspect}`).toEqual([
        expect.objectContaining({ action: 'sweep', dir: [0, 1] }),
      ]);
    }
  });

  it('aim maps the working range to the full aim square, mirrored for a facing camera', () => {
    const at = (cx: number, cy: number) => {
      const out = run(
        timeline({ seconds: 1.5, keys: [{ t: 0, hand: { cx, cy, size: 0.15, shape: 'open' } }] }),
      );
      return out.outputs.at(-1)!.aim!;
    };
    const centre = at(0.5, 0.535);
    expect(Math.abs(centre[0])).toBeLessThan(0.1);
    const playerRight = at(0.23, 0.535); // image left edge of the default range
    expect(playerRight[0]).toBeGreaterThan(0.9);
    const high = at(0.5, 0.25);
    expect(high[1]).toBeGreaterThan(0.85);
  });

  it('malformed landmarks never produce NaN aim or casts', () => {
    const frames = still(1).map((f, i) =>
      i % 3 === 0 && f.hands[0]
        ? {
            ...f,
            hands: [
              {
                ...f.hands[0],
                landmarks: f.hands[0].landmarks.map((p) => ({ ...p, x: Number.NaN })),
              },
            ],
          }
        : f,
    );
    const { outputs, events } = run(frames);
    expect(casts(events)).toEqual([]);
    for (const o of outputs) if (o.aim) expect(Number.isFinite(o.aim[0] + o.aim[1])).toBe(true);
  });

  it('cancel() ends active holds (pause / tab hidden / camera revoked)', () => {
    const engine = new GestureEngine();
    const frames = sign('fist', 2.0);
    const events: GestureEvent[] = [];
    for (const f of frames.slice(0, 50)) events.push(...engine.process(f).events);
    expect(summary(events)).toEqual(['lift:start']);
    expect(summary(engine.cancel(frames[50]!.t))).toEqual(['lift:end']);
  });
});

describe('calibration', () => {
  it('neutral hold then a traced area yields a working range that covers it', () => {
    const cal = new Calibrator(16 / 9);
    const keys = [{ t: 0, hand: { ...HOME, shape: 'open' as const } }];
    const circle = timeline({
      seconds: 4.2,
      keys: [
        ...keys,
        { t: 1.4, hand: { cx: 0.5, cy: 0.55 } },
        { t: 2.0, hand: { cx: 0.36, cy: 0.42 } },
        { t: 2.6, hand: { cx: 0.64, cy: 0.42 } },
        { t: 3.2, hand: { cx: 0.64, cy: 0.7 } },
        { t: 3.8, hand: { cx: 0.36, cy: 0.7 } },
      ],
    });
    let progress: CalibrationProgress | null = null;
    let prev: { x: number; y: number } | null = null;
    let prevT = 0;
    for (const f of circle) {
      const h = f.hands[0]!;
      const feat = handFeatures(h.landmarks, f.width / f.height, h.handedness)!;
      const speed = prev
        ? Math.hypot(feat.center.x - prev.x, feat.center.y - prev.y) /
          feat.scale /
          ((f.t - prevT) / 1000)
        : 0;
      prev = feat.center;
      prevT = f.t;
      progress = cal.update(f.t, feat, true, speed);
    }
    expect(progress?.phase).toBe('done');
    const r = progress!.result!.range;
    expect(r.x0).toBeLessThan(0.38 * (16 / 9));
    expect(r.x1).toBeGreaterThan(0.62 * (16 / 9));
    expect(r.y0).toBeLessThan(0.45);
    expect(r.y1).toBeGreaterThan(0.66);
  });

  it('no hand for 8 s fails softly (the UI offers retry or touch)', () => {
    const cal = new Calibrator(16 / 9);
    let p = cal.update(0, null, false, 0);
    for (let t = 0; t <= 8100; t += 100) p = cal.update(t, null, false, 0);
    expect(p.phase).toBe('failed');
  });
});
