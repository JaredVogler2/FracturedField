/**
 * Procedural synthetic hands for tests and the browser test hook (`@ff/gestures/synthetic`).
 *
 * Builds MediaPipe-shaped 21-point landmark sets from a few parameters (palm position and size,
 * finger curls, thumb, palm orientation, handedness, noise) and timelines of them. These are
 * artificial fixtures: they let every gesture be tested with positive, negative and borderline
 * cases deterministically, without recording anyone's hands. They do not replace real-camera
 * validation (see PHASE-05 for what was and was not verified on real video).
 */
import type {
  Handedness,
  HandObservation,
  LandmarksFrame,
  Point3,
  PoseObservation,
} from './types.js';

export interface SynthHand {
  /** Palm centre, normalised frame coordinates. */
  cx: number;
  cy: number;
  /** Palm size as a fraction of the frame height (≈ 0.18 close-up, ≈ 0.07 on a stand). */
  size: number;
  /** In-plane rotation (radians, clockwise in the image). */
  roll: number;
  /** Rotation about the image x axis (radians): 0 = palm faces the camera, −π/2 = palm up. */
  pitch: number;
  /** Curl 0 (straight) … 1 (fist) for index, middle, ring, pinky. */
  curls: [number, number, number, number];
  /** Thumb 0 (extended, abducted) … 1 (tucked across the palm). */
  thumb: number;
  /** Thumb tip brought to the index tip (OK sign). */
  pinch?: boolean;
  handedness: Handedness;
  score: number;
}

export const SHAPES = {
  open: { curls: [0.12, 0.1, 0.12, 0.14], thumb: 0 },
  relaxed: { curls: [0.22, 0.2, 0.24, 0.28], thumb: 0.15 },
  fist: { curls: [1, 1, 1, 1], thumb: 1 },
  point: { curls: [0.08, 1, 1, 1], thumb: 1 },
  vee: { curls: [0.08, 0.08, 1, 1], thumb: 1 },
  three: { curls: [0.08, 0.08, 0.1, 1], thumb: 1 },
  thumb: { curls: [1, 1, 1, 1], thumb: 0 },
  ok: { curls: [0.55, 0.1, 0.12, 0.14], thumb: 0.35, pinch: true },
} as const satisfies Record<string, Pick<SynthHand, 'curls' | 'thumb' | 'pinch'>>;

export type ShapeName = keyof typeof SHAPES;

export const DEFAULT_HAND: SynthHand = {
  cx: 0.5,
  cy: 0.55,
  size: 0.16,
  roll: 0,
  pitch: 0,
  curls: [...SHAPES.open.curls],
  thumb: 0,
  handedness: 'right',
  score: 0.95,
};

type V = [number, number, number];

/** Canonical right hand, palm facing the camera, fingers up; wrist→middle MCP ≈ 1 unit. */
const WRIST: V = [0, 0, 0];
const MCP: V[] = [
  [0.32, -0.92, 0],
  [0.08, -1.0, 0],
  [-0.14, -0.94, 0],
  [-0.33, -0.82, 0],
];
const SEG: [number, number, number][] = [
  [0.42, 0.25, 0.22],
  [0.47, 0.28, 0.24],
  [0.44, 0.27, 0.23],
  [0.34, 0.2, 0.19],
];
/** Out of the palm (toward the camera for the canonical pose). */
const PALM_OUT: V = [0, 0, -1];

const vadd = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const vnorm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const vdot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * A finger (or thumb) as a planar joint chain: each joint adds flexion in the plane spanned by the
 * base direction and the palm normal, so total curl can pass 90° (a fist folds back to the palm).
 */
function chain(base: V, dir: V, segs: readonly number[], flex: readonly number[], toward: V): V[] {
  const d0 = vnorm(dir);
  const n = vnorm(vadd(toward, vscale(d0, -vdot(toward, d0))));
  const out: V[] = [];
  let p = base;
  let theta = 0;
  for (let i = 0; i < segs.length; i++) {
    theta += flex[i]!;
    const u = vadd(vscale(d0, Math.cos(theta)), vscale(n, Math.sin(theta)));
    p = vadd(p, vscale(u, segs[i]!));
    out.push(p);
  }
  return out;
}

const DEG = Math.PI / 180;

/** Builds the 21 landmarks of a synthetic hand in raw normalised frame coordinates. */
export function synthHand(
  h: SynthHand,
  aspect: number,
  noise = 0,
  rnd: () => number = Math.random,
) {
  const pts: V[] = new Array<V>(21);
  pts[0] = WRIST;
  for (let f = 0; f < 4; f++) {
    const mcp = MCP[f]!;
    pts[5 + f * 4] = mcp;
    const dir = vnorm([mcp[0] * 0.55, mcp[1], 0]);
    const c = Math.max(0, Math.min(1, h.curls[f]!));
    // MCP, PIP, DIP flexion toward the palm.
    const joints = chain(mcp, dir, SEG[f]!, [70 * DEG * c, 100 * DEG * c, 70 * DEG * c], PALM_OUT);
    pts[6 + f * 4] = joints[0]!;
    pts[7 + f * 4] = joints[1]!;
    pts[8 + f * 4] = joints[2]!;
  }
  const t = Math.max(0, Math.min(1, h.thumb));
  const cmc: V = [0.2, -0.22, -0.05];
  // Extended: abducted up and out; tucked: folded across the front of the palm.
  const thumbDir = vnorm(
    vadd(vscale(vnorm([0.78, -0.58, -0.15]), 1 - t), vscale(vnorm([-0.75, -0.55, -0.3]), t)),
  );
  const th = chain(
    cmc,
    thumbDir,
    [0.3, 0.27, 0.24],
    [10 * DEG * t, 25 * DEG * t, 25 * DEG * t],
    PALM_OUT,
  );
  pts[1] = cmc;
  pts[2] = th[0]!;
  pts[3] = th[1]!;
  pts[4] = th[2]!;
  if (h.pinch) {
    // OK sign: thumb tip meets the index tip; the IP joint sits between.
    const tip = pts[8]!;
    pts[4] = vadd(tip, [0.04, 0.03, 0]);
    pts[3] = vadd(vscale(pts[2], 0.45), vscale(pts[4], 0.55));
  }

  // Orientation: pitch about x, then roll about z (image plane); then handedness mirror.
  const cp = Math.cos(h.pitch);
  const sp = Math.sin(h.pitch);
  const cr = Math.cos(h.roll);
  const sr = Math.sin(h.roll);
  const oriented = pts.map(([x, y, z]): V => {
    const y1 = y * cp - z * sp;
    const z1 = y * sp + z * cp;
    const x2 = x * cr - y1 * sr;
    const y2 = x * sr + y1 * cr;
    return [h.handedness === 'left' ? -x2 : x2, y2, z1];
  });
  const idx = [0, 5, 9, 13, 17];
  const c0 = idx.reduce<V>((a, i) => vadd(a, oriented[i]!), [0, 0, 0]).map((v) => v / 5) as V;
  const gauss = () => {
    // Box–Muller from the provided uniform source (deterministic in tests).
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return oriented.map(([x, y, z]): Point3 => ({
    x: h.cx + ((x - c0[0]) * h.size) / aspect + (noise ? (gauss() * noise) / aspect : 0),
    y: h.cy + (y - c0[1]) * h.size + (noise ? gauss() * noise : 0),
    z: ((z - c0[2]) * h.size) / aspect + (noise ? (gauss() * noise * 0.5) / aspect : 0),
  }));
}

/** Seeded uniform generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Key {
  /** Seconds from the start of the timeline. */
  readonly t: number;
  readonly hand: Partial<SynthHand> & { shape?: ShapeName };
}

export interface TimelineSpec {
  readonly seconds: number;
  readonly fps?: number;
  /** Frame width / height. */
  readonly aspect?: number;
  /** Landmark noise σ in frame-height units. */
  readonly noise?: number;
  readonly seed?: number;
  /** Keyframes for the player's hand (linear interpolation, shape switches at the key). */
  readonly keys: readonly Key[];
  /** Intervals (seconds) where the player's hand is not detected. */
  readonly dropouts?: readonly (readonly [number, number])[];
  /** Optional second hand (bystander or off-hand), keyed the same way. */
  readonly other?: readonly Key[];
  /** Emit a matching upper-body pose (shoulders + wrists) for stand-mode tests. */
  readonly pose?: boolean;
  /** Start time of frame timestamps (ms). */
  readonly t0?: number;
}

function resolve(keys: readonly Key[], t: number, base: SynthHand): SynthHand {
  let prev: Key | undefined;
  let next: Key | undefined;
  let hand: SynthHand = { ...base };
  for (const k of keys) {
    if (k.t <= t) {
      prev = k;
      hand = applyKey(hand, k);
    } else {
      next = k;
      break;
    }
  }
  if (!prev || !next) return hand;
  const span = next.t - prev.t;
  const a = span > 0 ? (t - prev.t) / span : 1;
  const target = applyKey(hand, next);
  const lerp = (x: number, y: number) => x + (y - x) * a;
  return {
    ...hand,
    cx: lerp(hand.cx, target.cx),
    cy: lerp(hand.cy, target.cy),
    size: lerp(hand.size, target.size),
    roll: lerp(hand.roll, target.roll),
    pitch: lerp(hand.pitch, target.pitch),
    // Shapes do not morph between keys unless the next key asks for an explicit curl blend.
    ...(next.hand.curls
      ? { curls: hand.curls.map((c, i) => lerp(c, target.curls[i]!)) as SynthHand['curls'] }
      : {}),
  };
}

function applyKey(h: SynthHand, k: Key): SynthHand {
  const { shape, ...rest } = k.hand;
  const s = shape ? SHAPES[shape] : null;
  return {
    ...h,
    ...(s
      ? {
          curls: [...s.curls] as SynthHand['curls'],
          thumb: s.thumb,
          pinch: 'pinch' in s ? s.pinch : false,
        }
      : {}),
    ...rest,
  };
}

function synthPose(hand: SynthHand, lm: readonly Point3[], aspect: number): PoseObservation {
  const pts: Point3[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  // Shoulders below and either side of the frame centre; the player's wrist joins the hand.
  const shoulderW = hand.size * 2.6;
  pts[11] = { x: 0.5 + shoulderW / aspect / 2, y: 0.82, z: 0 }; // user's left appears on the right
  pts[12] = { x: 0.5 - shoulderW / aspect / 2, y: 0.82, z: 0 };
  const wrist = lm[0]!;
  const otherWrist = { x: 1 - wrist.x, y: 0.95, z: 0 };
  pts[hand.handedness === 'right' ? 16 : 15] = wrist;
  pts[hand.handedness === 'right' ? 15 : 16] = otherWrist;
  return { landmarks: pts, score: 0.9 };
}

export type HandPose = Partial<SynthHand> & { shape?: ShapeName };

/** The host's timers and clock (browser or Node): this package does not depend on DOM types. */
const host = globalThis as unknown as {
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  performance: { now(): number };
};

/**
 * A live synthetic hand: renders the current pose at a fixed camera rate into `sink` until
 * stopped, stamped with the real clock. The pose can change at any moment, so a closed-loop test
 * "player" can watch the game and move its hand like a person would. `null` = hand out of frame.
 */
export class SyntheticCamera {
  private hand: SynthHand | null = null;
  private timer: unknown = null;
  private readonly rnd: () => number;
  private readonly aspect: number;

  constructor(
    private readonly sink: (frame: LandmarksFrame) => void,
    private readonly opts: { fps?: number; aspect?: number; noise?: number; seed?: number } = {},
    private readonly now: () => number = () => host.performance.now(),
  ) {
    this.rnd = rng(opts.seed ?? 1);
    this.aspect = opts.aspect ?? 16 / 9;
  }

  /** Updates the hand (merged into the current pose); `null` takes it out of frame. */
  set(pose: HandPose | null): void {
    this.hand = pose ? applyKey(this.hand ?? DEFAULT_HAND, { t: 0, hand: pose }) : null;
    this.timer ??= host.setInterval(() => this.emit(), 1000 / (this.opts.fps ?? 15));
  }

  /** Renders one frame of the current pose now. */
  emit(): void {
    const height = 720;
    const hands: HandObservation[] = this.hand
      ? [
          {
            landmarks: synthHand(this.hand, this.aspect, this.opts.noise ?? 0.0025, this.rnd),
            handedness: this.hand.handedness,
            score: this.hand.score,
          },
        ]
      : [];
    this.sink({
      t: this.now(),
      hands,
      pose: null,
      width: Math.round(height * this.aspect),
      height,
    });
  }

  stop(): void {
    if (this.timer !== null) host.clearInterval(this.timer);
    this.timer = null;
  }
}

/** Renders a timeline to camera-rate frames (default 30 fps, 16:9). */
export function timeline(spec: TimelineSpec): LandmarksFrame[] {
  const fps = spec.fps ?? 30;
  const aspect = spec.aspect ?? 16 / 9;
  const r = rng(spec.seed ?? 1);
  const out: LandmarksFrame[] = [];
  const n = Math.round(spec.seconds * fps);
  const height = 720;
  const width = Math.round(height * aspect);
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const hands: HandObservation[] = [];
    let pose: PoseObservation | null = null;
    const dropped = spec.dropouts?.some(([a, b]) => t >= a && t < b) ?? false;
    if (!dropped && spec.keys.length > 0) {
      const h = resolve(spec.keys, t, DEFAULT_HAND);
      const lm = synthHand(h, aspect, spec.noise ?? 0.0025, r);
      hands.push({ landmarks: lm, handedness: h.handedness, score: h.score });
      if (spec.pose) pose = synthPose(h, lm, aspect);
    }
    if (spec.other && spec.other.length > 0 && spec.other[0]!.t <= t) {
      const o = resolve(spec.other, t, { ...DEFAULT_HAND, handedness: 'left' });
      hands.push({
        landmarks: synthHand(o, aspect, spec.noise ?? 0.0025, r),
        handedness: o.handedness,
        score: o.score,
      });
    }
    out.push({ t: (spec.t0 ?? 1000) + (i * 1000) / fps, hands, pose, width, height });
  }
  return out;
}
