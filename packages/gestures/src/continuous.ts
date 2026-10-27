import { clamp } from './math.js';
import { LM, type Handedness, type Point3 } from './types.js';
import type { HandFeatures } from './features.js';

/**
 * The continuous hand channel (ADR-0009): grip, push and twist from a tracked hand, every frame.
 * Like the gesture engine it is pure and clocked by the frames' own timestamps, so it behaves the
 * same at 30 or 8 frames per second and is tested on synthetic landmark sequences.
 *
 * - **grip** — how closed the hand is: each finger's bend placed between the player's open palm
 *   and their fist (calibrated), averaged, de-spiked and lightly smoothed.
 * - **push** — how fast the palm approaches the camera (+) or draws back (−): the least-squares
 *   slope of its log apparent size over the last 0.3 s (distance does not matter), less
 *   a noise floor — landmark jitter alone moves a still palm's size by ~2 % a frame.
 * - **twist** — the wrist turned from its neutral pose, read from the knuckle line's angle in the
 *   image, less a few degrees of tremor; positive is clockwise as the player sees their own hand.
 *
 * A lost hand decays to open and still within a frame, so nothing stays gripped by accident.
 */
export interface ContinuousCalibration {
  /** Mean finger bend (radians) of this player's open palm, and of their fist. */
  readonly openBend: number;
  readonly fistBend: number;
  /**
   * Knuckle-line angle (radians, image, clockwise) of the neutral pose; `null` = zero the twist
   * on how the hand was held when it was first seen (a relaxed hand's knuckles slope ±0.15 rad,
   * mirrored between hands, so a fixed zero would read as a twist).
   */
  readonly neutralRoll: number | null;
}

export const DEFAULT_CONTINUOUS_CALIBRATION: ContinuousCalibration = {
  openBend: 0.45,
  fistBend: 2.5,
  neutralRoll: null,
};

/** Frames averaged to zero the twist when a hand is acquired (uncalibrated neutral). */
const ZERO_FRAMES = 3;
/** The approach-rate fit always spans at least this many frames. */
const PUSH_FRAMES = 5;

export interface ContinuousConfig {
  /** Palm approach rate (d ln size / dt, per second) that counts as a full push… */
  readonly pushRate: number;
  /** …and the rate below which it is jitter, not a push. */
  readonly pushNoise: number;
  /** Window of the approach-rate fit (ms; it always spans at least five frames). */
  readonly pushWindowMs: number;
  /** Wrist turn (radians) that counts as a full twist, and the tremor (radians) ignored. */
  readonly twistRange: number;
  readonly twistDead: number;
  /** Smoothing time constants (ms): grip, twist. */
  readonly gripTau: number;
  readonly twistTau: number;
}

export const DEFAULT_CONTINUOUS_CONFIG: ContinuousConfig = {
  pushRate: 0.6,
  pushNoise: 0.2,
  pushWindowMs: 300,
  twistRange: (50 * Math.PI) / 180,
  twistDead: (4 * Math.PI) / 180,
  gripTau: 45,
  twistTau: 80,
};

export interface HandChannel {
  readonly grip: number;
  readonly push: number;
  readonly twist: number;
}

export const OPEN_HAND: HandChannel = { grip: 0, push: 0, twist: 0 };

/** Wraps an angle to (−π, π]. */
function wrap(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * The knuckle line's angle in the image (radians, clockwise with y down), taken from the pinky
 * side to the index side so a left and a right hand both read ≈ 0 held upright, palm to camera.
 * `p` is aspect-corrected (isotropic) — raw landmarks scaled by the frame's aspect on x.
 */
export function knuckleRoll(p: readonly Point3[], handedness: Handedness): number {
  const i = p[LM.INDEX_MCP]!;
  const k = p[LM.PINKY_MCP]!;
  const dx = i.x - k.x;
  const dy = i.y - k.y;
  return handedness === 'right' ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
}

/** Least-squares slope of y over t (per second; t in ms). */
function slope(samples: readonly { t: number; y: number }[]): number {
  const n = samples.length;
  let st = 0;
  let sy = 0;
  for (const p of samples) {
    st += p.t;
    sy += p.y;
  }
  const mt = st / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const p of samples) {
    num += (p.t - mt) * (p.y - my);
    den += (p.t - mt) * (p.t - mt);
  }
  return den > 0 ? (num / den) * 1000 : 0;
}

export class ContinuousMapper {
  private grip = 0;
  private readonly sizes: { t: number; y: number }[] = [];
  private readonly rawSizes: number[] = [];
  private roll: number | null = null;
  private lastT: number | null = null;
  private readonly bends: number[] = [];
  private zero: number | null = null;
  private readonly zeroing: number[] = [];

  constructor(
    private cal: ContinuousCalibration = DEFAULT_CONTINUOUS_CALIBRATION,
    private readonly cfg: ContinuousConfig = DEFAULT_CONTINUOUS_CONFIG,
  ) {}

  setCalibration(cal: ContinuousCalibration): void {
    this.cal = cal;
  }

  reset(): void {
    this.grip = 0;
    this.sizes.length = 0;
    this.rawSizes.length = 0;
    this.roll = null;
    this.lastT = null;
    this.bends.length = 0;
    this.zero = null;
    this.zeroing.length = 0;
  }

  /**
   * One frame of the tracked hand (`null` while it is lost) at `t` ms. `roll` is the knuckle-line
   * angle of this frame (`knuckleRoll`). Returns the hand channel to send.
   */
  update(f: HandFeatures | null, roll: number | null, t: number): HandChannel {
    if (!f || roll === null || !Number.isFinite(roll)) {
      this.reset();
      return OPEN_HAND;
    }
    const dt = this.lastT === null ? 0 : clamp(t - this.lastT, 0, 500);
    this.lastT = t;
    const k = (tau: number) => (dt <= 0 ? 1 : 1 - Math.exp(-dt / tau));

    // Grip: each finger's bend between open (0) and fist (1); median of 3 frames, then smoothed.
    const span = Math.max(0.3, this.cal.fistBend - this.cal.openBend);
    let closure = 0;
    for (const b of f.bend) closure += clamp((b - this.cal.openBend) / span, 0, 1);
    this.bends.push(closure / 4);
    if (this.bends.length > 3) this.bends.shift();
    const sorted = [...this.bends].sort((a, b) => a - b);
    const g = sorted[sorted.length >> 1]!;
    this.grip += (g - this.grip) * k(this.cfg.gripTau);

    // Push: the approach rate fitted over the recent window (median-of-3 log sizes, so a single
    // jittery frame cannot fake an approach), less the jitter floor.
    this.rawSizes.push(Math.log(Math.max(1e-6, f.size)));
    if (this.rawSizes.length > 3) this.rawSizes.shift();
    const ls = [...this.rawSizes].sort((a, b) => a - b)[this.rawSizes.length >> 1]!;
    this.sizes.push({ t, y: ls });
    // At least five frames as well as the window: at low frame rates, stability over latency.
    while (this.sizes.length > PUSH_FRAMES && t - this.sizes[0]!.t > this.cfg.pushWindowMs)
      this.sizes.shift();
    const rate = this.sizes.length >= 3 ? slope(this.sizes) : 0;
    const over = Math.max(0, Math.abs(rate) - this.cfg.pushNoise);
    const push = (Math.sign(rate) * over) / (this.cfg.pushRate - this.cfg.pushNoise);

    // Twist: the turn from the neutral pose, smoothed on the unit circle (no wrap jumps).
    let neutral = this.cal.neutralRoll;
    if (neutral === null) {
      if (this.zero === null) {
        this.zeroing.push(roll);
        if (this.zeroing.length >= ZERO_FRAMES) {
          const r0 = this.zeroing[0]!;
          let sum = 0;
          for (const r of this.zeroing) sum += wrap(r - r0);
          this.zero = wrap(r0 + sum / this.zeroing.length);
        }
      }
      neutral = this.zero ?? roll;
    }
    const turn = wrap(roll - neutral);
    this.roll =
      this.roll === null ? turn : this.roll + wrap(turn - this.roll) * k(this.cfg.twistTau);

    const tremorFree = Math.max(0, Math.abs(this.roll) - this.cfg.twistDead);
    const twist = (Math.sign(this.roll) * tremorFree) / (this.cfg.twistRange - this.cfg.twistDead);
    return {
      grip: clamp(this.grip, 0, 1),
      push: clamp(push, -1, 1),
      // Clockwise in the raw camera image is counter-clockwise for the player facing it.
      twist: clamp(-twist, -1, 1),
    };
  }
}
