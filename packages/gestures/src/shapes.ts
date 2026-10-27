import type { HandFeatures } from './features.js';
import type { HandShape } from './types.js';

/**
 * Finger-extension thresholds with hysteresis (radians of total chain bend). A finger is
 * "extended" below EXTEND and "curled" above CURL; in between it keeps its previous state, so a
 * hand hovering at the boundary does not flicker between shapes.
 */
const EXTEND = 1.2;
const CURL = 1.9;
/**
 * Thumb: extended when its tip is far from the palm centre (reach) or well outside the index side
 * (lateral, abducted); tucked when it lies close to and across the palm.
 */
const THUMB_REACH_OUT = 0.8;
const THUMB_REACH_IN = 0.7;
const THUMB_LATERAL_OUT = 0.55;
const THUMB_LATERAL_IN = 0.35;
/** Thumb tip to index tip over palm scale. */
const PINCH_IN = 0.32;
const PINCH_OUT = 0.48;

const median3 = (v: readonly number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1]!;
};

/** Hysteretic finger/thumb states over median-of-3 smoothed measurements (spike-proof). */
export class ShapeClassifier {
  private fingers: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  private thumb = true;
  private pinched = false;
  private hist: number[][] = [[], [], [], [], [], [], [], []];

  reset(): void {
    this.fingers = [true, true, true, true];
    this.thumb = true;
    this.pinched = false;
    this.hist = [[], [], [], [], [], [], [], []];
  }

  private smooth(k: number, v: number): number {
    const h = this.hist[k]!;
    h.push(v);
    if (h.length > 3) h.shift();
    return median3(h);
  }

  /** Extension state after this frame: [index, middle, ring, pinky], thumb. */
  update(f: HandFeatures): { fingers: readonly boolean[]; thumb: boolean } {
    for (let i = 0; i < 4; i++) {
      const b = this.smooth(i, f.bend[i]!);
      if (b < EXTEND) this.fingers[i] = true;
      else if (b > CURL) this.fingers[i] = false;
    }
    const reach = this.smooth(4, f.thumbReach);
    const lateral = this.smooth(5, f.thumbLateral);
    const bend = this.smooth(6, f.thumbBend);
    if ((reach > THUMB_REACH_OUT && bend < 1.2) || lateral > THUMB_LATERAL_OUT) this.thumb = true;
    else if ((reach < THUMB_REACH_IN && lateral < THUMB_LATERAL_IN) || bend > 1.6)
      this.thumb = false;
    return { fingers: this.fingers, thumb: this.thumb };
  }

  classify(f: HandFeatures): HandShape {
    const { fingers, thumb } = this.update(f);
    const [i, m, r, p] = fingers as [boolean, boolean, boolean, boolean];
    // OK sign: thumb and index tips touching, the other three fingers up (pinch hysteresis).
    const pinch = this.smooth(7, f.pinch);
    if (pinch < PINCH_IN) this.pinched = true;
    else if (pinch > PINCH_OUT) this.pinched = false;
    if (this.pinched && m && r && p) return 'ok';
    const count = (i ? 1 : 0) + (m ? 1 : 0) + (r ? 1 : 0) + (p ? 1 : 0);
    if (count >= 4) return 'open';
    if (count === 0) return thumb ? 'thumb' : 'fist';
    if (i && !m && !r && !p) return 'point';
    if (i && m && !r && !p) return 'vee';
    if (i && m && r && !p) return 'three';
    return 'unknown';
  }
}
