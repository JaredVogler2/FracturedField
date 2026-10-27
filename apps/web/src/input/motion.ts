/**
 * Handheld motion aiming (Phase 06 / D06): device orientation → a calibrated, relative 2-D aim.
 *
 * Orientation is used only RELATIVE to a neutral pose the player sets (recenter): the compass
 * heading is never trusted as absolute, and no translation is inferred. Angles are handled as
 * quaternions (no Euler gimbal lock near vertical), corrected for the screen's rotation, then
 * mapped through a dead zone and a One Euro filter: strong smoothing while the phone is still,
 * fast response to a deliberate turn. Pure logic — the DOM side lives in motion-controller.ts.
 */
import { OneEuro } from '@ff/gestures';

export interface OrientationSample {
  /** Milliseconds (event or performance time). */
  readonly t: number;
  /** W3C DeviceOrientation angles in degrees; null when the sensor gives nothing. */
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
  /** `screen.orientation.angle` (0, 90, 180, 270). */
  readonly screenAngle: number;
}

/**
 * pointer — turn the phone like a window: yaw → horizontal, pitch → vertical.
 * tilt — tip it like a tray: roll → horizontal, tipping the top edge away → up.
 */
export type MotionStyle = 'pointer' | 'tilt';

export interface MotionConfig {
  /** 0.5 (calm) … 2 (twitchy): scales the angle needed for a full aim. */
  readonly sensitivity: number;
  readonly style: MotionStyle;
}

/**
 * waiting — no usable reading yet; tracking — aiming; stalled — readings stopped (sensor paused,
 * revoked or asleep); needs-recenter — back from the background: the player must recenter first.
 */
export type MotionState = 'waiting' | 'tracking' | 'stalled' | 'needs-recenter';

export interface MotionOutput {
  /** Normalised screen aim in [-1, 1]² (x right, y up); null while not tracking. */
  readonly aim: readonly [number, number] | null;
  readonly state: MotionState;
  /** Angles from the neutral pose (degrees, after the dead zone): [horizontal, vertical]. */
  readonly angles: readonly [number, number];
  /** Set on the sample that re-zeroed the neutral pose (player request or screen rotation). */
  readonly recentered?: 'player' | 'rotation';
}

type Q = readonly [number, number, number, number]; // w, x, y, z
type V3 = readonly [number, number, number];

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

const conj = (q: Q): Q => [q[0], -q[1], -q[2], -q[3]];

function rotate(q: Q, v: V3): V3 {
  const r = mul(mul(q, [0, v[0], v[1], v[2]]), conj(q));
  return [r[1], r[2], r[3]];
}

/** W3C DeviceOrientation: intrinsic Z-X'-Y'' — R = Rz(alpha) · Rx(beta) · Ry(gamma). */
export function orientationQuat(alpha: number, beta: number, gamma: number): Q {
  return mul(mul(axisAngle(0, 0, 1, alpha), axisAngle(1, 0, 0, beta)), axisAngle(0, 1, 0, gamma));
}

/** Device orientation → orientation of the displayed content (corrects for screen rotation). */
function screenQuat(s: OrientationSample): Q | null {
  const { alpha, beta, gamma } = s;
  if (alpha === null || beta === null || gamma === null) return null;
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  return mul(orientationQuat(alpha, beta, gamma), axisAngle(0, 0, 1, -s.screenAngle));
}

/** Degrees from neutral for a full-scale aim, at sensitivity 1. */
const RANGE: Record<MotionStyle, readonly [number, number]> = {
  pointer: [20, 14],
  tilt: [24, 18],
};
const DEAD_ZONE_DEG = 0.8;
/** Faster than any hand can turn a phone: a reading implying this is a sensor glitch. */
const GLITCH_DEG_PER_S = 1500;
const STALL_MS = 800;

export class MotionAim {
  private cfg: MotionConfig;
  private neutral: Q | null = null;
  private neutralAngle = 0;
  private pendingRecenter: 'player' | 'auto' | null = 'auto';
  private needsRecenter = false;
  private lastValid = -Infinity;
  private prev: { t: number; h: number; v: number } | null = null;
  private suspect: { h: number; v: number } | null = null;
  private fx = new OneEuro(1.0, 0.04, 1.0);
  private fy = new OneEuro(1.0, 0.04, 1.0);
  private state: MotionState = 'waiting';
  private last: MotionOutput = { aim: null, state: 'waiting', angles: [0, 0] };

  constructor(cfg: Partial<MotionConfig> = {}) {
    this.cfg = { sensitivity: 1, style: 'pointer', ...cfg };
  }

  configure(cfg: Partial<MotionConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  /** The next valid reading becomes the neutral pose (also clears needs-recenter). */
  recenter(): void {
    this.pendingRecenter = 'player';
  }

  /** Background / sensor permission lost: stop aiming; resuming requires a recenter. */
  pause(): void {
    this.needsRecenter = true;
    this.state = 'needs-recenter';
    this.prev = null;
  }

  get current(): MotionOutput {
    return this.last;
  }

  /** Call regularly (each frame): flags a stall when readings stop arriving. */
  tick(now: number): MotionState {
    if (this.state === 'tracking' && now - this.lastValid > STALL_MS) {
      this.state = 'stalled';
      this.last = { ...this.last, aim: null, state: 'stalled' };
    }
    return this.state;
  }

  push(s: OrientationSample): MotionOutput {
    const q = screenQuat(s);
    if (!q) return this.last; // null / NaN reading: ignored, the stall timer decides
    let recentered: MotionOutput['recentered'];
    const rotated = this.neutral !== null && s.screenAngle !== this.neutralAngle;
    if (this.pendingRecenter || rotated) {
      // A player recenter, the first reading, or a new screen orientation re-zeroes the pose.
      if (this.pendingRecenter === 'player') recentered = 'player';
      else if (rotated) recentered = 'rotation';
      this.neutral = q;
      this.neutralAngle = s.screenAngle;
      this.pendingRecenter = null;
      this.needsRecenter = false;
      this.prev = null;
      this.suspect = null;
      this.fx.reset();
      this.fy.reset();
    }
    if (this.needsRecenter || !this.neutral) {
      this.state = 'needs-recenter';
      this.last = { aim: null, state: 'needs-recenter', angles: [0, 0] };
      return this.last;
    }
    const rel = mul(conj(this.neutral), q);
    let h: number;
    let v: number;
    const f = rotate(rel, [0, 0, -1]);
    const pitch = Math.atan2(f[1], Math.hypot(f[0], f[2])) * R2D;
    if (this.cfg.style === 'pointer') {
      h = Math.atan2(f[0], -f[2]) * R2D;
      v = pitch;
    } else {
      const x = rotate(rel, [1, 0, 0]);
      h = -Math.atan2(x[1], x[0]) * R2D;
      v = -pitch;
    }
    // Glitch guard: an impossible jump is held back one reading; if the next agrees, it's real.
    if (this.prev) {
      const dt = Math.max(1, s.t - this.prev.t) / 1000;
      const speed = Math.max(Math.abs(h - this.prev.h), Math.abs(v - this.prev.v)) / dt;
      if (speed > GLITCH_DEG_PER_S) {
        const agrees =
          this.suspect !== null &&
          Math.abs(this.suspect.h - h) < 4 &&
          Math.abs(this.suspect.v - v) < 4;
        if (!agrees) {
          this.suspect = { h, v };
          return this.last;
        }
      }
    }
    this.suspect = null;
    this.prev = { t: s.t, h, v };
    this.lastValid = s.t;
    const dz = (a: number) => (Math.abs(a) <= DEAD_ZONE_DEG ? 0 : a - Math.sign(a) * DEAD_ZONE_DEG);
    const sh = this.fx.filter(dz(h), s.t);
    const sv = this.fy.filter(dz(v), s.t);
    const [rx, ry] = RANGE[this.cfg.style];
    const k = Math.min(2, Math.max(0.5, this.cfg.sensitivity));
    const clamp = (a: number) => Math.max(-1, Math.min(1, a));
    this.state = 'tracking';
    this.last = {
      aim: [clamp((sh * k) / rx), clamp((sv * k) / ry)],
      state: 'tracking',
      angles: [sh, sv],
      ...(recentered ? { recentered } : {}),
    };
    return this.last;
  }
}
