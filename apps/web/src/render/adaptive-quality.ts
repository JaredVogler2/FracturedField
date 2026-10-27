/**
 * Adaptive rendering quality (Phase 07B / D08). With quality "auto", the tier picked from the
 * device class is a ceiling; this controller steps down when the smoothed frame rate stays low and
 * back up when it stays comfortably high. Hysteresis keeps it from oscillating: separate down/up
 * thresholds, a hold time before any change (≥ 5 s down, longer up), a cooldown after a change,
 * and isolated long frames (a tab switch, a GC pause) are ignored — but a renderer that is slow
 * on every frame is load, however slow. Only rendering changes — the simulation is identical on
 * every tier. Pure: frame times and timestamps are passed in.
 */
import type { QualityTier } from './art-tokens';

export type TierName = QualityTier['name'];

const ORDER: readonly TierName[] = ['low', 'medium', 'high'];

export interface AdaptiveOptions {
  /** Step down when the smoothed rate stays below this (fps)… */
  readonly downFps: number;
  /** …for this long (ms). */
  readonly downHoldMs: number;
  /** Step up when it stays above this (fps)… */
  readonly upFps: number;
  /** …for this long (ms). */
  readonly upHoldMs: number;
  /** No decision for this long after a change (ms): let the new tier settle first. */
  readonly cooldownMs: number;
  /** A frame or two longer than this (ms) is a hitch, not load: ignored. */
  readonly hitchMs: number;
}

/** This many long frames in a row are load, not hitches. */
const SUSTAINED = 3;
/** A long frame counts as at most this long (ms), so one stall cannot swamp the average. */
const MAX_FRAME_MS = 1000;

export const ADAPTIVE_DEFAULTS: AdaptiveOptions = {
  downFps: 40,
  downHoldMs: 5000,
  upFps: 57,
  upHoldMs: 12000,
  cooldownMs: 8000,
  hitchMs: 250,
};

export class AdaptiveQuality {
  private current: TierName;
  private readonly ceiling: number;
  private emaMs = 1000 / 60;
  private belowSince: number | null = null;
  private aboveSince: number | null = null;
  private changedAt = -Infinity;
  private longRun = 0;

  constructor(
    start: TierName,
    private readonly opts: AdaptiveOptions = ADAPTIVE_DEFAULTS,
  ) {
    this.current = start;
    this.ceiling = ORDER.indexOf(start);
  }

  get tier(): TierName {
    return this.current;
  }

  /** Smoothed frame rate (fps). */
  get fps(): number {
    return 1000 / this.emaMs;
  }

  /** Feeds one frame's duration (ms) at time `now` (ms); returns the new tier when it changes. */
  sample(frameMs: number, now: number): TierName | null {
    if (!(frameMs > 0)) return null;
    if (frameMs > this.opts.hitchMs) {
      // A tab switch or a GC pause is a frame or two; a slow renderer is slow every frame.
      if (++this.longRun < SUSTAINED) return null;
    } else this.longRun = 0;
    this.emaMs += (Math.min(frameMs, MAX_FRAME_MS) - this.emaMs) * 0.05;
    if (now - this.changedAt < this.opts.cooldownMs) {
      this.belowSince = this.aboveSince = null;
      return null;
    }
    const fps = this.fps;
    const i = ORDER.indexOf(this.current);
    if (fps < this.opts.downFps && i > 0) {
      this.aboveSince = null;
      this.belowSince ??= now;
      if (now - this.belowSince >= this.opts.downHoldMs) return this.change(ORDER[i - 1]!, now);
    } else if (fps > this.opts.upFps && i < this.ceiling) {
      this.belowSince = null;
      this.aboveSince ??= now;
      if (now - this.aboveSince >= this.opts.upHoldMs) return this.change(ORDER[i + 1]!, now);
    } else {
      this.belowSince = this.aboveSince = null;
    }
    return null;
  }

  private change(to: TierName, now: number): TierName {
    this.current = to;
    this.changedAt = now;
    this.belowSince = this.aboveSince = null;
    return to;
  }
}
