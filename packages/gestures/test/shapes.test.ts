import { describe, expect, it } from 'vitest';
import { handFeatures } from '../src/features.js';
import { ShapeClassifier } from '../src/shapes.js';
import {
  DEFAULT_HAND,
  SHAPES,
  rng,
  synthHand,
  type ShapeName,
  type SynthHand,
} from '../src/synthetic.js';

const ASPECT = 16 / 9;

function features(h: Partial<SynthHand>, noise = 0, seed = 1) {
  const hand: SynthHand = { ...DEFAULT_HAND, ...h };
  const lm = synthHand(hand, ASPECT, noise, rng(seed));
  return handFeatures(lm, ASPECT, hand.handedness)!;
}

function shapeOf(name: ShapeName, extra: Partial<SynthHand> = {}, noise = 0, seed = 1) {
  const c = new ShapeClassifier();
  const s = SHAPES[name];
  // A few frames so hysteresis settles from its default (open) state.
  const shape = { curls: [...s.curls] as SynthHand['curls'], thumb: s.thumb, pinch: 'pinch' in s };
  let out = c.classify(features({ ...shape, ...extra }, noise, seed));
  for (let i = 1; i < 4; i++) out = c.classify(features({ ...shape, ...extra }, noise, seed + i));
  return out;
}

describe('hand features and shapes', () => {
  it('palm normal points at the camera for a palm-facing hand and up for a palm-up hand (both hands)', () => {
    for (const handedness of ['right', 'left'] as const) {
      const facing = features({ handedness });
      expect(facing.normal.z).toBeLessThan(-0.8);
      const up = features({ handedness, pitch: -Math.PI / 2 });
      expect(up.normal.y).toBeLessThan(-0.8);
    }
  });

  it('classifies every vocabulary shape, for both hands, rolled ±25°, with landmark noise', () => {
    const expected: Record<ShapeName, string> = {
      open: 'open',
      relaxed: 'open',
      fist: 'fist',
      point: 'point',
      vee: 'vee',
      three: 'three',
      thumb: 'thumb',
      ok: 'ok',
    };
    for (const name of Object.keys(SHAPES) as ShapeName[]) {
      for (const handedness of ['right', 'left'] as const) {
        for (const roll of [-0.44, 0, 0.44]) {
          expect(
            shapeOf(name, { handedness, roll }, 0.002, 7),
            `${name} ${handedness} ${roll}`,
          ).toBe(expected[name]);
        }
      }
    }
  });

  it('palm scale is independent of position and proportional to apparent size', () => {
    const a = features({ cx: 0.3, cy: 0.4, size: 0.1 });
    const b = features({ cx: 0.7, cy: 0.6, size: 0.1 });
    const c = features({ cx: 0.5, cy: 0.5, size: 0.2 });
    expect(Math.abs(a.scale - b.scale) / a.scale).toBeLessThan(0.02);
    expect(c.scale / a.scale).toBeCloseTo(2, 1);
  });

  it('rejects malformed landmark sets instead of producing NaN', () => {
    const lm = synthHand(DEFAULT_HAND, ASPECT);
    expect(handFeatures(lm.slice(0, 20), ASPECT, 'right')).toBeNull();
    const bad = lm.map((p, i) => (i === 9 ? { ...p, x: Number.NaN } : p));
    expect(handFeatures(bad, ASPECT, 'right')).toBeNull();
  });
});
