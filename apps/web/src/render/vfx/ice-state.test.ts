import { describe, expect, it } from 'vitest';
import { FREEZE_S, MELT_S, breakIce, newIceState, stepIce, type IceState } from './ice-state';

const DT = 1 / 60;

/** Steps `s` for `seconds` at 60 fps and returns the last view. */
function run(s: IceState, seconds: number, present: boolean, frozen: boolean) {
  let view = stepIce(s, present, frozen, DT);
  for (let i = 1; i < Math.round(seconds * 60); i++) view = stepIce(s, present, frozen, DT);
  return view;
}

describe('a pool visual narrates the authoritative ICE flag (7C, D09)', () => {
  it('water freezes in from the rim over FREEZE_S; the plate is drawn from the first frame', () => {
    const s = newIceState(false);
    expect(run(s, 0.5, true, false)).toMatchObject({ water: true, ice: false, waterFade: 1 });
    const first = stepIce(s, true, true, DT);
    // The collider exists at once, so the plate is there at once; the front shows it forming over
    // the water, which stays until the front closes, then fades out.
    expect(first.ice).toBe(true);
    expect(first.water).toBe(true);
    expect(first.waterFade).toBe(1);
    expect(first.freeze).toBeGreaterThan(0);
    expect(first.freeze).toBeLessThan(0.2);
    let prev = first.freeze;
    let fade = first.waterFade;
    for (let t = DT; t < FREEZE_S + 0.05; t += DT) {
      const v = stepIce(s, true, true, DT);
      expect(v.freeze).toBeGreaterThanOrEqual(prev);
      if (v.water) {
        expect(v.waterFade).toBeLessThanOrEqual(fade);
        if (v.freeze < 0.85) expect(v.waterFade).toBe(1);
        fade = v.waterFade;
      }
      prev = v.freeze;
    }
    expect(prev).toBe(1);
    expect(stepIce(s, true, true, DT).water).toBe(false);
  });

  it('a pool first seen frozen (a late join) shows its plate whole, without a front', () => {
    const v = stepIce(newIceState(true), true, true, DT);
    expect(v).toMatchObject({ ice: true, water: false, freeze: 1 });
  });

  it('a thaw fades the plate out while the water fades back in, over MELT_S', () => {
    const s = newIceState(true);
    run(s, 1, true, true);
    const start = stepIce(s, true, false, DT);
    expect(start.ice).toBe(true);
    expect(start.water).toBe(true);
    expect(start.melt).toBeLessThan(0.1);
    expect(start.waterFade).toBeCloseTo(start.melt, 5);
    const mid = run(s, MELT_S / 2, true, false);
    expect(mid.melt).toBeGreaterThan(0.4);
    expect(mid.melt).toBeLessThan(0.65);
    const end = run(s, MELT_S, true, false);
    expect(end).toMatchObject({ ice: false, water: true, waterFade: 1, melt: 1, done: false });
  });

  it('a broken plate is gone at once and the water is back at full, whichever arrives first', () => {
    // The shatter reaction before the snapshot that clears the flag...
    const a = newIceState(true);
    run(a, 1, true, true);
    breakIce(a);
    expect(stepIce(a, true, true, DT)).toMatchObject({ ice: false, water: true, waterFade: 1 });
    expect(stepIce(a, true, false, DT)).toMatchObject({ ice: false, water: true, waterFade: 1 });
    // ...or after it (a thaw had just begun): no thaw is drawn either way.
    const b = newIceState(true);
    run(b, 1, true, true);
    stepIce(b, true, false, DT);
    breakIce(b);
    expect(stepIce(b, true, false, DT)).toMatchObject({ ice: false, water: true, waterFade: 1 });
  });

  it('water refrozen after a break shows the freeze front again', () => {
    const s = newIceState(true);
    breakIce(s);
    run(s, 0.5, true, false);
    const v = stepIce(s, true, true, DT);
    expect(v.ice).toBe(true);
    expect(v.freeze).toBeLessThan(0.2);
  });

  it('a frozen pool that is gone thaws away where it stood, then frees the visual', () => {
    const s = newIceState(true);
    run(s, 1, true, true);
    const gone = stepIce(s, false, false, DT);
    expect(gone).toMatchObject({ ice: true, water: false, done: false });
    expect(run(s, MELT_S, false, false)).toMatchObject({ ice: false, done: true });
    // Water that is gone just ends; a broken plate that is gone has nothing left to draw.
    expect(stepIce(newIceState(false), false, false, DT).done).toBe(true);
    const broken = newIceState(true);
    breakIce(broken);
    expect(stepIce(broken, false, false, DT).done).toBe(true);
  });

  it('bad frame times never produce a NaN', () => {
    const s = newIceState(false);
    for (const dt of [Number.NaN, Infinity, -1, 1e6]) {
      const v = stepIce(s, true, true, dt);
      for (const x of [v.freeze, v.melt, v.waterFade]) expect(Number.isFinite(x)).toBe(true);
    }
  });
});
