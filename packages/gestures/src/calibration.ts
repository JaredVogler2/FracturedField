import type { Handedness } from './types.js';

/** The tracked hand as the calibrator needs it (palm centre and apparent size). */
export interface CalibrationSample {
  readonly center: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly normalZ?: number;
  readonly handedness?: Handedness;
}

/**
 * Per-player calibration in aspect-corrected frame units (x ∈ [0, aspect], y ∈ [0, 1]). Nothing
 * here estimates metric depth: palm scale is the apparent size of the player's palm at their
 * normal playing distance, used to gate bystanders and normalise motion.
 */
export interface Calibration {
  /** Median apparent palm scale at the neutral pose; null = uncalibrated (no scale gate). */
  readonly palmScale: number | null;
  /** Neutral palm centre. */
  readonly center: { readonly x: number; readonly y: number };
  /** Comfortable working range of the palm centre; maps to the full aim range. */
  readonly range: {
    readonly x0: number;
    readonly x1: number;
    readonly y0: number;
    readonly y1: number;
  };
  /** The hand label seen on the calibrated (playing) hand. */
  readonly hand?: Handedness;
  /**
   * Median palm-normal z while the player showed an open palm to the camera. Positive means the
   * hand labels are inverted for this camera (mirroring / model convention): the caller flips
   * labels so palm orientation (GUARD, PULSE) reads correctly.
   */
  readonly palmFacing?: number;
}

/** Uncalibrated default: the middle half of the frame horizontally, upper-middle vertically. */
export function defaultCalibration(aspect: number): Calibration {
  return {
    palmScale: null,
    center: { x: aspect / 2, y: 0.55 },
    range: { x0: aspect * 0.22, x1: aspect * 0.78, y0: 0.22, y1: 0.85 },
  };
}

export type CalibrationPhase = 'neutral' | 'range' | 'done' | 'failed';

export interface CalibrationProgress {
  readonly phase: CalibrationPhase;
  /** 0..1 within the current phase. */
  readonly progress: number;
  readonly hint: string;
  readonly result: Calibration | null;
}

const NEUTRAL_MS = 1200;
const RANGE_MS = 2600;
const FAIL_LOST_MS = 4000;

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;
}

/**
 * Two short steps: hold an open palm still at a comfortable centre (neutral scale and centre),
 * then move it slowly around the area you want to play in (working range). Fails softly when the
 * hand is not seen for 4 s — the caller offers retry or touch controls, never a dead end.
 */
export class Calibrator {
  private phase: CalibrationPhase = 'neutral';
  private phaseStart: number | null = null;
  private lastSeen: number | null = null;
  private scales: number[] = [];
  private normals: number[] = [];
  private hands: Handedness[] = [];
  private cxs: number[] = [];
  private cys: number[] = [];
  private result: Calibration | null = null;

  constructor(private readonly aspect: number) {}

  reset(): void {
    this.phase = 'neutral';
    this.phaseStart = null;
    this.lastSeen = null;
    this.scales = [];
    this.normals = [];
    this.hands = [];
    this.cxs = [];
    this.cys = [];
    this.result = null;
  }

  /** Feed the tracked dominant hand (or null when not visible) once per camera frame. */
  update(
    t: number,
    f: CalibrationSample | null,
    open: boolean,
    speed: number,
  ): CalibrationProgress {
    if (this.phase === 'done' || this.phase === 'failed') return this.progress(t);
    if (!f) {
      if (this.lastSeen !== null && t - this.lastSeen > FAIL_LOST_MS) this.phase = 'failed';
      else if (this.lastSeen === null) {
        this.phaseStart ??= t;
        if (t - this.phaseStart > FAIL_LOST_MS * 2) this.phase = 'failed';
      }
      return this.progress(t);
    }
    this.lastSeen = t;
    if (this.phase === 'neutral') {
      // Needs a still, open palm; any motion restarts the hold.
      if (!open || speed > 1.2) {
        this.phaseStart = t;
        this.scales = [];
        this.normals = [];
        this.hands = [];
        this.cxs = [];
        this.cys = [];
        return this.progress(t);
      }
      this.phaseStart ??= t;
      if (f.normalZ !== undefined) this.normals.push(f.normalZ);
      if (f.handedness) this.hands.push(f.handedness);
      this.scales.push(f.scale);
      this.cxs.push(f.center.x);
      this.cys.push(f.center.y);
      if (t - this.phaseStart >= NEUTRAL_MS) {
        const s = [...this.scales].sort((a, b) => a - b);
        const xs = [...this.cxs].sort((a, b) => a - b);
        const ys = [...this.cys].sort((a, b) => a - b);
        const ns = [...this.normals].sort((a, b) => a - b);
        const rights = this.hands.filter((h) => h === 'right').length;
        this.result = {
          palmScale: percentile(s, 0.5),
          center: { x: percentile(xs, 0.5), y: percentile(ys, 0.5) },
          range: defaultCalibration(this.aspect).range,
          ...(this.hands.length > 0
            ? { hand: rights * 2 >= this.hands.length ? ('right' as const) : ('left' as const) }
            : {}),
          ...(ns.length > 0 ? { palmFacing: percentile(ns, 0.5) } : {}),
        };
        this.phase = 'range';
        this.phaseStart = t;
        this.cxs = [];
        this.cys = [];
      }
      return this.progress(t);
    }
    // Range: sample the palm centre while the player sweeps their comfortable area.
    this.cxs.push(f.center.x);
    this.cys.push(f.center.y);
    if (t - (this.phaseStart ?? t) >= RANGE_MS && this.result) {
      const scale = this.result.palmScale ?? f.scale;
      const xs = [...this.cxs].sort((a, b) => a - b);
      const ys = [...this.cys].sort((a, b) => a - b);
      let x0 = percentile(xs, 0.05);
      let x1 = percentile(xs, 0.95);
      let y0 = percentile(ys, 0.05);
      let y1 = percentile(ys, 0.95);
      // Expand a little, and never accept a range so small that tremor would sweep the arena.
      const minW = scale * 3.5;
      const minH = scale * 2.6;
      const padX = Math.max(0.12 * (x1 - x0), (minW - (x1 - x0)) / 2, 0);
      const padY = Math.max(0.12 * (y1 - y0), (minH - (y1 - y0)) / 2, 0);
      x0 -= padX;
      x1 += padX;
      y0 -= padY;
      y1 += padY;
      this.result = { ...this.result, range: { x0, x1, y0, y1 } };
      this.phase = 'done';
    }
    return this.progress(t);
  }

  private progress(t: number): CalibrationProgress {
    const since = this.phaseStart === null ? 0 : t - this.phaseStart;
    switch (this.phase) {
      case 'neutral':
        return {
          phase: 'neutral',
          progress: Math.min(1, since / NEUTRAL_MS),
          hint: 'Hold an open palm still, where it feels comfortable',
          result: null,
        };
      case 'range':
        return {
          phase: 'range',
          progress: Math.min(1, since / RANGE_MS),
          hint: 'Slowly trace the area you want to play in',
          result: null,
        };
      case 'done':
        return { phase: 'done', progress: 1, hint: 'Calibrated', result: this.result };
      case 'failed':
        return {
          phase: 'failed',
          progress: 0,
          hint: 'Your hand was not visible — check framing and light, or use touch controls',
          result: null,
        };
    }
  }
}
