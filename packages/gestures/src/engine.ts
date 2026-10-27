import { defaultCalibration, type Calibration } from './calibration.js';
import { handFeatures, type HandFeatures } from './features.js';
import { OneEuro, clamp, dist2 } from './math.js';
import { ShapeClassifier } from './shapes.js';
import {
  LM,
  POSE,
  type GestureAction,
  type GestureEvent,
  type GestureOutput,
  type HandObservation,
  type HandShape,
  type Handedness,
  type LandmarksFrame,
  type TrackState,
} from './types.js';

export interface GestureConfig {
  /** Hand that aims and casts; 'any' = whichever single hand is shown (calibration). */
  readonly dominant: Handedness | 'any';
  /** 0.5 = strict (bigger, slower motions needed) … 1.5 = sensitive. */
  readonly sensitivity: number;
  /** Time a hand shape must be held before it casts (ms). */
  readonly dwellMs: number;
  /** Camera faces the player (selfie / stand): screen right = the player's right. */
  readonly facingUser: boolean;
  /** A short dropout up to this long keeps everything as it was (ms). */
  readonly coastMs: number;
  /** Lost longer than this: held actions are released (ms). */
  readonly releaseMs: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  dominant: 'right',
  sensitivity: 1,
  dwellMs: 280,
  facingUser: true,
  coastMs: 200,
  releaseMs: 500,
};

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly open: boolean;
  readonly facing: boolean;
  /** Torso (shoulder) width when a pose is available — separates camera motion from hand motion. */
  readonly torso: number | null;
  readonly tx: number | null;
  readonly ty: number | null;
}

interface Ctx {
  readonly t: number;
  /** Tracked dominant hand this frame (null while lost or coasting). */
  readonly f: HandFeatures | null;
  readonly shape: HandShape;
  readonly coasting: boolean;
  /** Milliseconds the current tracking streak has lasted. */
  readonly trackedMs: number;
  readonly speed: number;
  readonly history: readonly Sample[];
  readonly off: HandFeatures | null;
  readonly offShape: HandShape;
  readonly cfg: GestureConfig;
  /** Thumb tip above the index knuckle (thumbs-up orientation). */
  readonly thumbUp: boolean;
  /** Typical interval between camera frames (ms) — recognisers adapt to slow devices. */
  readonly frameMs: number;
}

/* ------------------------------------------------------------------------------------------ */
/* Recognisers                                                                                 */
/* ------------------------------------------------------------------------------------------ */

interface Recognizer {
  update(c: Ctx): GestureEvent[];
  /** Ends any active hold (tracking lost, pause, permission revoked). */
  cancel(t: number): GestureEvent[];
  /** True while a candidate is forming (the aim is frozen so the gesture does not drag it). */
  readonly forming: boolean;
}

/**
 * Static hand-shape gesture: SEARCH/NEUTRAL (armed) → CANDIDATE (shape held, counting dwell) →
 * ACTIVE (fires `tap` or `start`) → HOLD (holds only) → RELEASE (`end` after the shape is gone
 * for `exitMs`) → COOLDOWN, then it must see a different shape before it can fire again.
 */
class ShapeGesture implements Recognizer {
  private state: 'armed' | 'candidate' | 'holding' | 'latched' | 'cooldown' = 'armed';
  private since = 0;
  private goneSince: number | null = null;
  private missSince: number | null = null;

  constructor(
    private readonly action: GestureAction,
    private readonly shape: HandShape,
    private readonly hold: boolean,
    private readonly opts: {
      readonly dwellScale?: number;
      readonly exitMs?: number;
      readonly cooldownMs?: number;
      readonly extra?: (c: Ctx) => boolean;
    } = {},
  ) {}

  get forming(): boolean {
    return this.state === 'candidate';
  }

  update(c: Ctx): GestureEvent[] {
    const exitMs = this.opts.exitMs ?? 150;
    if (c.coasting) return []; // short dropout: freeze in place
    if (!c.f) {
      if (this.state === 'candidate') this.state = 'armed';
      return [];
    }
    const match = c.shape === this.shape && (this.opts.extra?.(c) ?? true);
    switch (this.state) {
      case 'armed':
        if (match && c.trackedMs > 150) {
          this.state = 'candidate';
          this.since = c.t;
        }
        return [];
      case 'candidate': {
        if (!match) {
          // Debounce: a mismatch must last > 2 frames (~70 ms) to break the dwell.
          this.missSince ??= c.t;
          if (c.t - this.missSince > Math.max(70, c.frameMs * 1.5)) {
            this.state = 'armed';
            this.missSince = null;
          }
          return [];
        }
        this.missSince = null;
        // Fast-moving hands are mid-transition, not presenting a sign.
        if (c.speed > 3) {
          this.since = c.t;
          return [];
        }
        const dwell =
          (c.cfg.dwellMs * (this.opts.dwellScale ?? 1)) / clamp(c.cfg.sensitivity, 0.5, 1.5);
        if (c.t - this.since < dwell) return [];
        this.goneSince = null;
        if (this.hold) {
          this.state = 'holding';
          return [{ action: this.action, phase: 'start', t: c.t }];
        }
        this.state = 'latched';
        return [{ action: this.action, phase: 'tap', t: c.t }];
      }
      case 'holding':
      case 'latched': {
        if (match) {
          this.goneSince = null;
          return [];
        }
        this.goneSince ??= c.t;
        if (c.t - this.goneSince < exitMs) return [];
        const wasHolding = this.state === 'holding';
        this.state = 'cooldown';
        this.since = c.t;
        return wasHolding ? [{ action: this.action, phase: 'end', t: c.t }] : [];
      }
      case 'cooldown':
        if (c.t - this.since >= (this.opts.cooldownMs ?? 200) && !match) this.state = 'armed';
        return [];
    }
  }

  cancel(t: number): GestureEvent[] {
    const out: GestureEvent[] =
      this.state === 'holding' ? [{ action: this.action, phase: 'end', t }] : [];
    // After a cancel the hand must show something else before this sign can fire again, so a
    // fist that is still closed when tracking returns does not re-lift on its own.
    this.state = 'cooldown';
    this.since = t;
    this.goneSince = null;
    return out;
  }
}

/**
 * A push must grow the hand by the threshold within this long (a lean toward the camera is far
 * slower). Slow cameras stretch it so the window still holds a few samples.
 */
const PUSH_RISE_MS = 550;

/**
 * PULSE: an open palm facing the camera pushed toward it — its apparent size grows quickly while
 * it stays in place. A torso visible in the same frames must not grow with it (that would be the
 * camera moving, not the hand).
 */
class PulseGesture implements Recognizer {
  private latched = false;
  private latchedAt = 0;
  private formingNow = false;

  get forming(): boolean {
    return this.formingNow;
  }

  update(c: Ctx): GestureEvent[] {
    this.formingNow = false;
    if (c.coasting || !c.f) return [];
    const now = c.history[c.history.length - 1];
    if (!now) return [];
    if (this.latched) {
      // Re-arm once the push is over (size settled) and the cooldown elapsed.
      const prev = c.history[c.history.length - (c.frameMs > 100 ? 2 : 4)];
      const settled = !prev || now.scale <= prev.scale * 1.01;
      if (settled && c.t - this.latchedAt > 350) this.latched = false;
      return [];
    }
    // A hand entering (or re-entering) the frame is not a push: only growth that starts after
    // 300 ms of steady tracking counts.
    const trackStart = c.t - c.trackedMs;
    const span = Math.max(PUSH_RISE_MS, c.frameMs * 3.2);
    const window = c.history.filter((s) => c.t - s.t <= span && s.t - trackStart >= 300);
    if (window.length < 3) return [];
    const k = clamp(c.cfg.sensitivity, 0.5, 1.5);
    const threshold = 0.17 / k;
    let min = window[0]!;
    for (const s of window) if (s.scale < min.scale) min = s;
    this.formingNow = Math.log(now.scale / min.scale) > threshold * 0.4;
    // Sustained size: the smallest of the last few frames (~100 ms; fewer on slow cameras), so a
    // noise spike must persist to count.
    const h = c.history;
    const need = c.frameMs <= 50 ? 3 : c.frameMs <= 100 ? 2 : 1;
    if (h.length < need + 2) return [];
    let post = Infinity;
    for (let j = h.length - need; j < h.length; j++) post = Math.min(post, h[j]!.scale);
    // Rise: the most recent moment the hand was still small — two consecutive samples, so a lone
    // noise trough can't pose as the start of a push — after the previous push.
    const small = post / Math.exp(threshold);
    let from: (typeof h)[number] | null = null;
    for (let j = h.length - need - 1; j > 0; j--) {
      const s = h[j]!;
      if (c.t - s.t > span || s.t - trackStart < 300 || s.t <= this.latchedAt) break;
      if (s.scale <= small && h[j - 1]!.scale <= small) {
        from = s;
        break;
      }
    }
    if (!from || now.t - from.t < 60) return [];
    const growth = Math.log(post / from.scale);
    const openShare = window.filter((s) => s.open && s.facing).length / window.length;
    if (openShare < 0.75) return [];
    const drift = Math.hypot(now.x - from.x, now.y - from.y) / now.scale;
    if (drift > 0.8) return []; // moving across the frame: a swipe, not a push
    if (now.torso !== null) {
      let minTorso = Infinity;
      for (const s of window) if (s.torso !== null && s.torso < minTorso) minTorso = s.torso;
      if (
        Number.isFinite(minTorso) &&
        minTorso > 0 &&
        Math.log(now.torso / minTorso) > growth * 0.5
      ) {
        // The whole body grew with the hand: the camera moved closer. Swallow this push.
        this.latched = true;
        this.latchedAt = c.t;
        return [];
      }
    }
    this.latched = true;
    this.latchedAt = c.t;
    this.formingNow = false;
    return [{ action: 'pulse', phase: 'tap', t: c.t }];
  }

  cancel(): GestureEvent[] {
    this.latched = false;
    this.formingNow = false;
    return [];
  }
}

/**
 * SWEEP: one decisive stroke of an open hand — at least ~2.6 palm widths in a consistent direction
 * within 0.45 s at speed. A greeting wave (small amplitude, alternating) does not qualify; after a
 * sweep the hand must slow down before another can fire, so one stroke = one cast.
 */
class SweepGesture implements Recognizer {
  private latched = false;
  private slowSince: number | null = null;

  readonly forming = false;

  update(c: Ctx): GestureEvent[] {
    if (c.coasting || !c.f) return [];
    if (this.latched) {
      if (c.speed < 2) {
        this.slowSince ??= c.t;
        if (c.t - this.slowSince > 180) this.latched = false;
      } else this.slowSince = null;
      return [];
    }
    if (c.trackedMs < 250) return [];
    const h = c.history;
    const now = h[h.length - 1];
    if (!now || !now.open) return [];
    const k = clamp(c.cfg.sensitivity, 0.5, 1.5);
    // The stroke = the recent run of samples moving faster than 1.5 palm widths per second.
    let i = h.length - 1;
    while (i > 0) {
      const a = h[i - 1]!;
      const b = h[i]!;
      const v = Math.hypot(b.x - a.x, b.y - a.y) / b.scale / Math.max(1e-3, (b.t - a.t) / 1000);
      if (v < 1.5 || c.t - a.t > Math.max(450, c.frameMs * 3.2)) break;
      i--;
    }
    const stroke = h.slice(Math.max(0, i - 1));
    if (stroke.length < (c.frameMs > 100 ? 2 : c.frameMs > 50 ? 3 : 4)) return [];
    const first = stroke[0]!;
    // Ego-motion: subtract torso motion when a pose is visible (a camera pan moves both).
    const torsoDx = now.tx !== null && first.tx !== null ? now.tx - first.tx : 0;
    const torsoDy = now.ty !== null && first.ty !== null ? now.ty - first.ty : 0;
    const dx = now.x - first.x - torsoDx;
    const dy = now.y - first.y - torsoDy;
    const scale = Math.max(1e-6, now.scale);
    const disp = Math.hypot(dx, dy) / scale;
    // Displacement counts from the resting sample before the stroke; its duration from the first
    // moving sample (at a slow camera rate the rest interval would otherwise halve the speed).
    const secs = Math.max(c.frameMs, now.t - stroke[1]!.t) / 1000;
    if (disp < 2.6 / k || disp / secs < 6 / k) return [];
    // Consistent direction: almost no step of the stroke moves back against it (the resting
    // anchor step, which barely moves, is neither for nor against).
    const ux = dx / (Math.hypot(dx, dy) || 1);
    const uy = dy / (Math.hypot(dx, dy) || 1);
    let against = 0;
    for (let j = 1; j < stroke.length; j++) {
      const a = stroke[j - 1]!;
      const b = stroke[j]!;
      if (((b.x - a.x) * ux + (b.y - a.y) * uy) / scale < -0.1) against++;
    }
    if (against / (stroke.length - 1) > 0.2) return [];
    if (stroke.filter((s) => s.open).length / stroke.length < 0.7) return [];
    this.latched = true;
    this.slowSince = null;
    // Screen space: x right (mirrored when the camera faces the player), y up.
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const sx = horizontal ? (c.cfg.facingUser ? -Math.sign(dx) : Math.sign(dx)) : 0;
    const sy = horizontal ? 0 : -Math.sign(dy);
    return [{ action: 'sweep', phase: 'tap', dir: [sx, sy], t: c.t }];
  }

  cancel(): GestureEvent[] {
    this.latched = false;
    return [];
  }
}

/**
 * GUARD: palm turned up and held still (one-hand form), or both open palms brought together
 * (two-hand form) — never a contortion.
 */
class GuardGesture implements Recognizer {
  private since: number | null = null;
  private latched = false;
  private releasedSince: number | null = null;
  private lastFire = -Infinity;

  get forming(): boolean {
    return this.since !== null;
  }

  update(c: Ctx): GestureEvent[] {
    if (c.coasting) return [];
    if (!c.f) {
      this.since = null;
      return [];
    }
    const palmUp = c.f.normal.y < -0.62 && c.shape === 'open';
    const together =
      c.off !== null &&
      c.shape === 'open' &&
      c.offShape === 'open' &&
      dist2(c.f.center, c.off.center) < 1.5 * Math.max(c.f.scale, c.off.scale);
    const active = (palmUp || together) && c.speed < 2.5;
    if (this.latched) {
      if (!active) {
        this.releasedSince ??= c.t;
        if (c.t - this.releasedSince > 150) this.latched = false;
      } else this.releasedSince = null;
      return [];
    }
    if (!active || c.trackedMs < 200) {
      this.since = null;
      return [];
    }
    this.since ??= c.t;
    const need = (together ? 250 : 350) / clamp(c.cfg.sensitivity, 0.5, 1.5);
    if (c.t - this.since < need || c.t - this.lastFire < 800) return [];
    this.latched = true;
    this.since = null;
    this.releasedSince = null;
    this.lastFire = c.t;
    return [{ action: 'guard', phase: 'tap', t: c.t }];
  }

  cancel(): GestureEvent[] {
    this.since = null;
    this.latched = false;
    return [];
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Tracking lock + engine                                                                      */
/* ------------------------------------------------------------------------------------------ */

function poseWrist(frame: LandmarksFrame, hand: Handedness, aspect: number) {
  const pose = frame.pose;
  if (!pose || pose.score < 0.5) return null;
  const p = pose.landmarks[hand === 'right' ? POSE.RIGHT_WRIST : POSE.LEFT_WRIST];
  return p ? { x: p.x * aspect, y: p.y } : null;
}

function torso(frame: LandmarksFrame, aspect: number) {
  const pose = frame.pose;
  if (!pose || pose.score < 0.5) return null;
  const l = pose.landmarks[POSE.LEFT_SHOULDER];
  const r = pose.landmarks[POSE.RIGHT_SHOULDER];
  if (!l || !r) return null;
  const w = Math.hypot((l.x - r.x) * aspect, l.y - r.y);
  return w > 1e-4 ? { w, x: ((l.x + r.x) / 2) * aspect, y: (l.y + r.y) / 2 } : null;
}

/**
 * Turns camera-rate landmark frames into aim + discrete game gestures for ONE local player.
 * Locks onto the player's dominant hand (scale, pose and continuity gates), so a bystander's hand
 * in frame cannot take control; coasts through short dropouts and releases held actions after
 * a long one. Pure and deterministic: same frames in, same events out.
 */
export class GestureEngine {
  private cfg: GestureConfig;
  private calibration: Calibration | null;
  private readonly shapes = new ShapeClassifier();
  private readonly offShapes = new ShapeClassifier();
  private readonly fx = new OneEuro(1.0, 0.8, 1.0);
  private readonly fy = new OneEuro(1.0, 0.8, 1.0);
  private readonly recognizers: Recognizer[];
  private history: Sample[] = [];
  /** Last raw palm measurements (median-of-3 removes single-frame landmark spikes). */
  private raw: { x: number; y: number; scale: number }[] = [];
  private torsoRaw: number[] = [];
  private thumbUpState = false;
  /** Hand currently locked (used when the dominant hand is 'any'). */
  private lockedHand: Handedness | null = null;
  private last: HandFeatures | null = null;
  private lastSeen: number | null = null;
  private trackStart: number | null = null;
  private reacquire = 0;
  private lostReleased = false;
  private aim: [number, number] | null = null;
  /** Median frame interval of recent tracking (ms); sizes the motion history. */
  private frameMs = 33;
  private frozenAim: [number, number] | null = null;
  private lastShape: HandShape = 'unknown';
  private rejected = 0;

  constructor(cfg: Partial<GestureConfig> = {}, calibration: Calibration | null = null) {
    this.cfg = { ...DEFAULT_GESTURE_CONFIG, ...cfg };
    this.calibration = calibration;
    this.recognizers = [
      new PulseGesture(),
      new SweepGesture(),
      new GuardGesture(),
      new ShapeGesture('lift', 'fist', true, { exitMs: 160, cooldownMs: 150 }),
      new ShapeGesture('wet', 'vee', false),
      new ShapeGesture('heat', 'thumb', false, {
        dwellScale: 1.25,
        extra: (c) => c.thumbUp,
      }),
      new ShapeGesture('pick1', 'point', true, { exitMs: 140 }),
      new ShapeGesture('pick2', 'ok', true, { exitMs: 140 }),
    ];
  }

  configure(cfg: Partial<GestureConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  get config(): GestureConfig {
    return this.cfg;
  }

  setCalibration(c: Calibration | null): void {
    this.calibration = c;
  }

  /** Releases every active hold and forgets candidates (pause, tab hidden, camera revoked). */
  cancel(t: number): GestureEvent[] {
    const out = this.recognizers.flatMap((r) => r.cancel(t));
    this.history = [];
    this.raw = [];
    this.trackStart = null;
    this.frozenAim = null;
    return out;
  }

  /** Picks the player's hand among the detections; null when none passes the gates. */
  private select(
    frame: LandmarksFrame,
    aspect: number,
  ): { main: HandObservation | null; off: HandObservation | null } {
    const cal = this.calibration;
    let best: HandObservation | null = null;
    let bestScore = Infinity;
    let off: HandObservation | null = null;
    const dominant = this.cfg.dominant;
    // With 'any', keep following the hand that was locked; otherwise take the most confident.
    const want: Handedness | null =
      dominant !== 'any'
        ? dominant
        : (this.lockedHand ??
          [...frame.hands].sort((a, b) => b.score - a.score)[0]?.handedness ??
          null);
    const anchor = want ? poseWrist(frame, want, aspect) : null;
    for (const h of frame.hands) {
      if (h.score < 0.5 || h.landmarks.length !== 21) continue;
      if (h.handedness !== want) {
        off ??= h;
        continue;
      }
      const w = h.landmarks[LM.WRIST]!;
      const m = h.landmarks[LM.MIDDLE_MCP]!;
      const scale = Math.hypot((w.x - m.x) * aspect, w.y - m.y);
      const cx = ((w.x + m.x) / 2) * aspect;
      const cy = (w.y + m.y) / 2;
      // Bystander gates: apparent size must match the calibrated player, and when a pose is
      // tracked the hand must belong to that body.
      if (cal?.palmScale && (scale < cal.palmScale * 0.5 || scale > cal.palmScale * 2.0)) {
        this.rejected++;
        continue;
      }
      if (
        anchor &&
        Math.hypot(w.x * aspect - anchor.x, w.y - anchor.y) > Math.max(0.15, scale * 1.5)
      ) {
        this.rejected++;
        continue;
      }
      // Continuity: prefer the hand closest to where the player's hand was.
      const ref = this.last ? this.last.center : null;
      const d = ref ? Math.hypot(cx - ref.x, cy - ref.y) : 0;
      if (
        this.last &&
        this.lastSeen !== null &&
        frame.t - this.lastSeen < 300 &&
        d > this.last.scale * 3.2
      ) {
        this.rejected++;
        continue;
      }
      if (d < bestScore) {
        bestScore = d;
        best = h;
      }
    }
    return { main: best, off };
  }

  private inRange(f: HandFeatures, aspect: number): boolean {
    const r = (this.calibration ?? defaultCalibration(aspect)).range;
    const mx = (r.x1 - r.x0) * 0.3;
    const my = (r.y1 - r.y0) * 0.3;
    return (
      f.center.x >= r.x0 - mx &&
      f.center.x <= r.x1 + mx &&
      f.center.y >= r.y0 - my &&
      f.center.y <= r.y1 + my
    );
  }

  process(frame: LandmarksFrame): GestureOutput {
    const t = frame.t;
    const aspect = frame.width > 0 && frame.height > 0 ? frame.width / frame.height : 16 / 9;
    this.rejected = 0;
    const { main, off } = this.select(frame, aspect);
    let f = main ? handFeatures(main.landmarks, aspect, main.handedness) : null;
    // Re-acquiring after a loss: the hand must be inside the play range for 3 frames.
    if (
      f &&
      this.lastSeen !== null &&
      t - this.lastSeen > this.cfg.coastMs &&
      this.trackStart === null
    ) {
      if (!this.inRange(f, aspect)) {
        this.reacquire = 0;
        f = null;
      } else if (++this.reacquire < 3) f = null;
    }
    const events: GestureEvent[] = [];
    let state: TrackState;
    let coasting = false;
    if (f) {
      this.lockedHand = main!.handedness;
      this.reacquire = 0;
      this.lostReleased = false;
      this.trackStart ??= t;
      this.lastSeen = t;
      this.last = f;
      state = 'tracking';
    } else {
      const lostMs = this.lastSeen === null ? Infinity : t - this.lastSeen;
      if (lostMs <= this.cfg.coastMs) {
        coasting = true;
        state = 'coasting';
      } else {
        state = this.lastSeen === null ? 'searching' : 'lost';
        this.trackStart = null;
        if (lostMs > this.cfg.releaseMs && !this.lostReleased) {
          this.lostReleased = true;
          events.push(...this.cancel(t));
          this.fx.reset();
          this.fy.reset();
        }
      }
    }

    // Shape + motion.
    let shape: HandShape = this.lastShape;
    let speed = 0;
    let thumbUp = false;
    if (f) {
      shape = this.shapes.classify(f);
      const lm = main!.landmarks;
      // Thumbs-up orientation with hysteresis: tip clearly above the index knuckle.
      const rise = (lm[LM.THUMB_TIP]!.y - lm[LM.INDEX_MCP]!.y) / f.scale;
      if (rise < -0.3) this.thumbUpState = true;
      else if (rise > -0.12) this.thumbUpState = false;
      thumbUp = this.thumbUpState;
      this.raw.push({ x: f.center.x, y: f.center.y, scale: f.size });
      if (this.raw.length > 3) this.raw.shift();
      const med = (k: 'x' | 'y' | 'scale') => {
        const v = this.raw.map((r) => r[k]).sort((a, b) => a - b);
        return v[Math.floor(v.length / 2)]!;
      };
      const sx = med('x');
      const sy = med('y');
      const sScale = med('scale');
      const prev = this.history[this.history.length - 1];
      if (prev && t > prev.t)
        speed = Math.hypot(sx - prev.x, sy - prev.y) / sScale / ((t - prev.t) / 1000);
      const tor = torso(frame, aspect);
      if (tor) {
        this.torsoRaw.push(tor.w);
        if (this.torsoRaw.length > 3) this.torsoRaw.shift();
      } else this.torsoRaw = [];
      const torsoW = tor
        ? [...this.torsoRaw].sort((a, b) => a - b)[this.torsoRaw.length >> 1]!
        : null;
      this.history.push({
        t,
        x: sx,
        y: sy,
        scale: sScale,
        open: shape === 'open',
        facing: f.normal.z < -0.35,
        torso: torsoW,
        tx: tor?.x ?? null,
        ty: tor?.y ?? null,
      });
      // Keep ~0.8 s of motion, and at least 6 frames on a slow camera.
      const keep = Math.max(800, this.frameMs * 6);
      while (this.history.length > 0 && t - this.history[0]!.t > keep) this.history.shift();
    }
    this.lastShape = shape;
    let offF: HandFeatures | null = null;
    let offShape: HandShape = 'unknown';
    if (f && off) {
      offF = handFeatures(off.landmarks, aspect, off.handedness);
      if (offF) offShape = this.offShapes.classify(offF);
    }
    const gaps: number[] = [];
    for (let k = Math.max(1, this.history.length - 6); k < this.history.length; k++)
      gaps.push(this.history[k]!.t - this.history[k - 1]!.t);
    gaps.sort((a, b) => a - b);
    const frameMs = gaps.length > 0 ? gaps[gaps.length >> 1]! : 33;
    this.frameMs = frameMs;
    const ctx: Ctx = {
      t,
      f,
      shape,
      coasting,
      trackedMs: this.trackStart === null ? 0 : t - this.trackStart,
      speed,
      history: this.history,
      off: offF,
      offShape,
      cfg: this.cfg,
      thumbUp,
      frameMs,
    };
    for (const r of this.recognizers) events.push(...r.update(ctx));

    // Aim from the calibrated working range, smoothed; frozen while a push or sign is forming.
    if (f) {
      const r = (this.calibration ?? defaultCalibration(aspect)).range;
      const u = (f.center.x - r.x0) / Math.max(1e-6, r.x1 - r.x0);
      const v = (f.center.y - r.y0) / Math.max(1e-6, r.y1 - r.y0);
      let sx = clamp(u * 2 - 1, -1, 1);
      if (this.cfg.facingUser) sx = -sx;
      const sy = clamp(-(v * 2 - 1), -1, 1);
      const ax = this.fx.filter(sx, t);
      const ay = this.fy.filter(sy, t);
      const forming = this.recognizers.some((rec) => rec.forming);
      if (forming) this.frozenAim ??= this.aim;
      else this.frozenAim = null;
      this.aim = [clamp(ax, -1, 1), clamp(ay, -1, 1)];
    } else if (state === 'lost' || state === 'searching') {
      this.aim = null;
      this.frozenAim = null;
    }
    const outAim = this.frozenAim ?? this.aim;
    const last = this.history[this.history.length - 1];
    return {
      aim: outAim ? [outAim[0], outAim[1]] : null,
      events,
      hand:
        f && last && main
          ? {
              center: { x: last.x, y: last.y },
              scale: last.scale,
              speed,
              normalZ: f.normal.z,
              handedness: main.handedness,
            }
          : null,
      status: {
        state,
        handsVisible: frame.hands.length,
        stable: state === 'tracking' && speed < 1.5,
        shape,
        lostMs: this.lastSeen === null || f ? 0 : t - this.lastSeen,
        rejected: this.rejected,
      },
    };
  }
}
