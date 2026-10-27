/**
 * Gesture detection table on synthetic landmarks (deterministic, not a device benchmark): for
 * each camera rate, PULSE detection over 80 pushes (20 seeds × push speeds 0.15–0.4 s), each sign
 * and six strokes, with detection latency from motion onset on the frames' own clock, plus false
 * casts of a still hand under doubled landmark noise.
 *
 * usage: pnpm benchmark:gestures
 */
import { GestureEngine, type GestureEvent, type LandmarksFrame } from '../src/index.js';
import { timeline } from '../src/synthetic.js';
import { HOME, THUMB_UP_ROLL, pulse, sign, swipe } from '../test/fixtures.js';

const run = (frames: readonly LandmarksFrame[]): GestureEvent[] => {
  const engine = new GestureEngine();
  return frames.flatMap((f) => engine.process(f).events).filter((e) => e.phase !== 'end');
};

const RATES = [30, 24, 20, 15, 12, 10, 8, 6, 5, 4];
const SIGNS = [
  ['fist', 'lift', 0],
  ['vee', 'wet', 0],
  ['thumb', 'heat', THUMB_UP_ROLL],
  ['point', 'pick1', 0],
  ['ok', 'pick2', 0],
] as const;

console.log(
  '| fps | PULSE detected | PULSE onset → event median / max | signs (onset → event) | strokes detected / max |',
);
console.log('|---|---|---|---|---|');
for (const fps of RATES) {
  const lat: number[] = [];
  let detected = 0;
  let doubled = 0;
  for (let seed = 1; seed <= 20; seed++) {
    for (const pushS of [0.15, 0.2, 0.3, 0.4]) {
      const got = run(pulse({ fps, seed, pushS })).filter((e) => e.action === 'pulse');
      if (got.length > 0) {
        detected++;
        lat.push(got[0]!.t - 2000); // the push starts 1 s into the fixture (t0 = 1000 ms)
      }
      if (got.length > 1) doubled++;
    }
  }
  lat.sort((a, b) => a - b);
  const signs = SIGNS.map(([shape, action, roll]) => {
    const got = run(sign(shape, 1.2, { fps, roll })).filter((e) => e.action === action);
    return got.length === 1
      ? `${action} ${Math.round(got[0]!.t - 1800)}`
      : `${action} ×${got.length}`;
  });
  const strokes: number[] = [];
  for (const secs of [0.2, 0.3, 0.4]) {
    for (const [from, to] of [
      [
        [0.62, 0.55],
        [0.32, 0.55],
      ],
      [
        [0.32, 0.55],
        [0.62, 0.55],
      ],
    ] as const) {
      const got = run(swipe(from, to, secs, { fps })).filter((e) => e.action === 'sweep');
      if (got.length === 1) strokes.push(got[0]!.t - 2000);
    }
  }
  console.log(
    `| ${fps} | ${detected}/80${doubled ? ` (${doubled} doubled)` : ''} | ${Math.round(lat[lat.length >> 1] ?? NaN)} / ${Math.round(lat[lat.length - 1] ?? NaN)} ms | ${signs.join(', ')} ms | ${strokes.length}/6 · ${strokes.length ? Math.round(Math.max(...strokes)) : '—'} ms |`,
  );
}

for (const fps of [30, 15, 8]) {
  let casts = 0;
  for (let seed = 200; seed < 210; seed++) {
    casts += run(
      timeline({
        seconds: 60,
        fps,
        seed,
        noise: 0.005,
        keys: [{ t: 0, hand: { ...HOME, shape: 'relaxed' } }],
      }),
    ).length;
  }
  console.log(`still hand, doubled noise, ${fps} fps, 10 min: ${casts} casts`);
}
