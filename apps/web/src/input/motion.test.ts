/**
 * Handheld motion aiming on synthetic sensor fixtures. Poses are built as rotations of a phone
 * held in front of the player and converted to the W3C alpha/beta/gamma a browser would report
 * (including the near-vertical hold where Euler angles are unstable). Synthetic sensor data
 * only — real iOS/Android behaviour is documented separately as not yet tested on devices.
 */
import { describe, expect, it } from 'vitest';
import { MotionAim, orientationQuat, type OrientationSample } from './motion';

type Q = readonly [number, number, number, number];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

function axisAngle(ax: number, ay: number, az: number, deg: number): Q {
  const h = (deg * D2R) / 2;
  const s = Math.sin(h);
  return [Math.cos(h), ax * s, ay * s, az * s];
}

function mul(a: Q, b: Q): Q {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

/** Rotation → the W3C (alpha, beta, gamma) a browser would report: R = Rz(α)·Rx(β)·Ry(γ). */
function euler(q: Q): [number, number, number] {
  const [w, x, y, z] = q;
  const r01 = 2 * (x * y - w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r21 = 2 * (y * z + w * x);
  const r20 = 2 * (x * z - w * y);
  const r22 = 1 - 2 * (x * x + y * y);
  const beta = Math.asin(Math.max(-1, Math.min(1, r21))) * R2D;
  if (Math.abs(r21) > 0.999999) {
    // Gimbal lock (phone exactly vertical): only alpha ± gamma is defined; report gamma = 0,
    // one of the equivalent decompositions a browser may give.
    const r00 = 1 - 2 * (y * y + z * z);
    const r10 = 2 * (x * y + w * z);
    return [(Math.atan2(r10, r00) * R2D + 360) % 360, beta, 0];
  }
  const alpha = Math.atan2(-r01, r11) * R2D;
  const gamma = Math.atan2(-r20, r22) * R2D;
  return [(alpha + 360) % 360, beta, gamma];
}

/** Portrait phone facing the player, reclined `recline`° from vertical, facing north. */
const portrait = (recline = 10): Q => axisAngle(1, 0, 0, 90 - recline);
/** The same phone turned on its side for landscape-primary (top edge to the player's left). */
const landscape = (recline = 10): Q => mul(portrait(recline), axisAngle(0, 0, 1, 90));
/** Turn about the world vertical (positive = to the player's right). */
const turnRight = (q: Q, deg: number): Q => mul(axisAngle(0, 0, 1, -deg), q);
/**
 * Tip the top edge of the displayed content away from the player, about the screen's horizontal
 * axis (in landscape that is the device's long axis, so the turn is applied in the content frame).
 */
const tipAway = (q: Q, deg: number, screenAngle = 0): Q =>
  mul(
    mul(mul(q, axisAngle(0, 0, 1, -screenAngle)), axisAngle(1, 0, 0, -deg)),
    axisAngle(0, 0, 1, screenAngle),
  );
/** Roll clockwise as the player sees it (right side down), about the screen normal. */
const rollRight = (q: Q, deg: number): Q => mul(q, axisAngle(0, 0, 1, -deg));

const sample = (q: Q, t: number, screenAngle = 0): OrientationSample => {
  const [alpha, beta, gamma] = euler(q);
  return { t, alpha, beta, gamma, screenAngle };
};

/** Feeds `n` readings of the same pose at 60 Hz; returns the last output. */
function hold(m: MotionAim, q: Q, t0: number, n = 60, screenAngle = 0) {
  let out = m.current;
  for (let i = 0; i < n; i++) out = m.push(sample(q, t0 + i * (1000 / 60), screenAngle));
  return out;
}

describe('MotionAim (pointer style)', () => {
  it('the euler helper round-trips through the W3C orientation formula', () => {
    const q = tipAway(turnRight(portrait(14), 23), 7);
    const [a, b, g] = euler(q);
    const back = orientationQuat(a, b, g);
    const dot = Math.abs(back.reduce((s, v, i) => s + v * q[i]!, 0));
    expect(dot).toBeCloseTo(1, 9);
  });

  it('the first reading is neutral; turning right aims right, tipping away aims down', () => {
    const m = new MotionAim();
    const base = portrait();
    expect(hold(m, base, 0).aim).toEqual([0, 0]);
    const right = hold(m, turnRight(base, 10), 1000);
    expect(right.aim![0]).toBeCloseTo((10 - 0.8) / 20, 1);
    expect(Math.abs(right.aim![1])).toBeLessThan(0.05);
    const down = hold(m, tipAway(base, 7), 2000);
    expect(down.aim![1]).toBeCloseTo(-(7 - 0.8) / 14, 1);
    expect(Math.abs(down.aim![0])).toBeLessThan(0.05);
  });

  it('works through the vertical hold where Euler angles are singular (beta ≈ 90°)', () => {
    for (const recline of [0, 0.1]) {
      const m = new MotionAim();
      const upright = portrait(recline);
      hold(m, upright, 0);
      const out = hold(m, turnRight(upright, 12), 1000);
      expect(out.aim![0], `recline ${recline}°`).toBeCloseTo((12 - 0.8) / 20, 1);
      expect(Math.abs(out.aim![1])).toBeLessThan(0.05);
    }
  });

  it('corrects for screen rotation: in landscape, turning right still aims right', () => {
    const m = new MotionAim();
    const base = landscape();
    hold(m, base, 0, 60, 90);
    const out = hold(m, turnRight(base, 10), 1000, 60, 90);
    expect(out.aim![0]).toBeCloseTo((10 - 0.8) / 20, 1);
    expect(Math.abs(out.aim![1])).toBeLessThan(0.05);
    const down = hold(m, tipAway(base, 7, 90), 2000, 60, 90);
    expect(down.aim![1]).toBeCloseTo(-(7 - 0.8) / 14, 1);
    expect(Math.abs(down.aim![0])).toBeLessThan(0.05);
  });

  it('rotating the screen mid-play re-zeroes on the new orientation', () => {
    const m = new MotionAim();
    hold(m, turnRight(portrait(), 0), 0);
    hold(m, turnRight(portrait(), 8), 1000);
    const flipped = m.push(sample(turnRight(landscape(), 8), 2000, 90));
    expect(flipped.recentered).toBe('rotation');
    expect(flipped.aim).toEqual([0, 0]);
  });

  it('dead zone + smoothing: a still hand with sensor noise does not move the aim', () => {
    const m = new MotionAim();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
    const base = portrait();
    hold(m, base, 0);
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const jitter = tipAway(turnRight(base, rnd() * 0.4), rnd() * 0.4);
      const out = m.push(sample(jitter, 1000 + i * (1000 / 60)));
      worst = Math.max(worst, Math.abs(out.aim![0]), Math.abs(out.aim![1]));
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('a deliberate turn responds quickly (90 % within 150 ms at 60 Hz)', () => {
    const m = new MotionAim();
    const base = portrait();
    hold(m, base, 0);
    const target = (12 - 0.8) / 20;
    let reached = Infinity;
    for (let i = 0; i < 60; i++) {
      const t = 1000 + i * (1000 / 60);
      const out = m.push(sample(turnRight(base, 12), t));
      if (out.aim![0] >= 0.9 * target) {
        reached = t - 1000;
        break;
      }
    }
    expect(reached).toBeLessThanOrEqual(150);
  });

  it('a one-reading glitch is ignored; a genuine fast flick that persists is accepted', () => {
    const m = new MotionAim();
    const base = portrait();
    hold(m, base, 0);
    // `hold` ended at t ≈ 983 ms; the next frame jumps 60° in 17 ms (≈ 3,500°/s).
    const before = m.current.aim;
    const glitch = m.push(sample(turnRight(base, 60), 1000));
    expect(glitch.aim).toEqual(before);
    const ok = m.push(sample(base, 1017));
    expect(ok.aim![0]).toBeCloseTo(0, 2);
    // A real flick: two consecutive readings agree on the new pose.
    m.push(sample(turnRight(base, 30), 1034));
    const flick = m.push(sample(turnRight(base, 30.5), 1050));
    expect(flick.aim![0]).toBeGreaterThan(0.2);
  });

  it('null / NaN readings are ignored; a gap stalls; readings resume tracking', () => {
    const m = new MotionAim();
    hold(m, portrait(), 0);
    const nullOut = m.push({ t: 1100, alpha: null, beta: null, gamma: null, screenAngle: 0 });
    expect(nullOut.state).toBe('tracking');
    m.push({ t: 1120, alpha: Number.NaN, beta: 80, gamma: 0, screenAngle: 0 });
    expect(m.tick(1500)).toBe('tracking');
    expect(m.tick(2000)).toBe('stalled');
    expect(m.current.aim).toBeNull();
    expect(hold(m, portrait(), 2100, 5).state).toBe('tracking');
  });

  it('no reading at all while waiting, or after the background, ends in stalled (touch offered)', () => {
    const m = new MotionAim();
    expect(m.tick(0)).toBe('waiting');
    expect(m.tick(1500)).toBe('waiting');
    expect(m.tick(2100)).toBe('stalled');
    expect(hold(m, portrait(), 2200, 5).state).toBe('tracking');
    // Back from the background, and the sensor never resumes.
    m.pause();
    expect(m.tick(3000)).toBe('needs-recenter');
    expect(m.tick(4500)).toBe('needs-recenter');
    expect(m.tick(5100)).toBe('stalled');
    // It resumes after all: the recenter prompt returns.
    m.push(sample(portrait(), 5200));
    expect(m.current.state).toBe('needs-recenter');
  });

  it('after the background, nothing aims until the player recenters', () => {
    const m = new MotionAim();
    hold(m, portrait(), 0);
    m.pause();
    expect(hold(m, turnRight(portrait(), 15), 1000).state).toBe('needs-recenter');
    expect(m.current.aim).toBeNull();
    m.recenter();
    const out = m.push(sample(turnRight(portrait(), 15), 2000));
    expect(out.recentered).toBe('player');
    expect(out.aim).toEqual([0, 0]);
    expect(hold(m, turnRight(portrait(), 25), 3000).aim![0]).toBeCloseTo((10 - 0.8) / 20, 1);
  });

  it('sensitivity scales the angle needed for a full aim; output is always clamped', () => {
    const calm = new MotionAim({ sensitivity: 0.5 });
    const twitchy = new MotionAim({ sensitivity: 2 });
    for (const m of [calm, twitchy]) hold(m, portrait(), 0);
    expect(hold(calm, turnRight(portrait(), 10), 1000).aim![0]).toBeCloseTo(0.23, 1);
    expect(hold(twitchy, turnRight(portrait(), 10), 1000).aim![0]).toBeCloseTo(0.92, 1);
    expect(hold(twitchy, turnRight(portrait(), 45), 2000).aim![0]).toBe(1);
  });
});

describe('MotionAim smoothing trade-off (measured on synthetic 60 Hz readings)', () => {
  /** ms until the aim covers `frac` of a step from neutral to `deg`° right. */
  function stepTime(deg: number, frac: number): number {
    const m = new MotionAim();
    const base = portrait();
    hold(m, base, 0);
    const target = (deg - 0.8) / 20;
    for (let i = 0; i < 120; i++) {
      const t = 1000 + i * (1000 / 60);
      if (m.push(sample(turnRight(base, deg), t)).aim![0] >= frac * target) return t - 1000;
    }
    return Infinity;
  }

  it('small corrections are smoothed (slow), deliberate turns respond fast', () => {
    const small = stepTime(2, 0.63);
    const big = stepTime(15, 0.63);
    const big90 = stepTime(15, 0.9);
    // Reported in docs/progress/PHASE-06.md (filter behaviour, not device latency).
    console.info(`motion step 63%: 2° → ${small.toFixed(0)} ms, 15° → ${big.toFixed(0)} ms`);
    console.info(`motion step 90%: 15° → ${big90.toFixed(0)} ms`);
    expect(small).toBeGreaterThan(big);
    expect(small).toBeGreaterThanOrEqual(60);
    expect(small).toBeLessThanOrEqual(200);
    expect(big).toBeLessThanOrEqual(60);
  });

  it('1 % null / NaN readings during a turn do not disturb the aim', () => {
    const clean = new MotionAim();
    const noisy = new MotionAim();
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const base = portrait();
    hold(clean, base, 0);
    hold(noisy, base, 0);
    let dropped = 0;
    let worst = 0;
    for (let i = 0; i < 1200; i++) {
      const t = 1000 + i * (1000 / 60);
      const s = sample(turnRight(base, 12 * Math.sin(i / 90)), t);
      const a = clean.push(s);
      const r = rnd();
      const b =
        r < 0.005
          ? noisy.push({ ...s, beta: null })
          : r < 0.01
            ? noisy.push({ ...s, gamma: Number.NaN })
            : noisy.push(s);
      if (r < 0.01) dropped++;
      expect(Number.isFinite(b.aim![0]) && Number.isFinite(b.aim![1])).toBe(true);
      worst = Math.max(worst, Math.abs(a.aim![0] - b.aim![0]));
    }
    expect(dropped).toBeGreaterThan(5);
    expect(noisy.tick(1000 + 1200 * (1000 / 60))).toBe('tracking');
    expect(worst).toBeLessThan(0.05);
  });
});

describe('MotionAim (tilt style)', () => {
  it('rolling right aims right; tipping the top edge away aims up', () => {
    const m = new MotionAim({ style: 'tilt' });
    const base = portrait();
    hold(m, base, 0);
    expect(hold(m, rollRight(base, 12), 1000).aim![0]).toBeCloseTo((12 - 0.8) / 24, 1);
    expect(hold(m, tipAway(base, 9), 2000).aim![1]).toBeCloseTo((9 - 0.8) / 18, 1);
  });
});
