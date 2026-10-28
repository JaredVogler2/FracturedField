import { describe, expect, it } from 'vitest';
import { ADVANCED_ABILITIES } from '@ff/game-data';
import { MOTIF, moteMotif, moveMotif, SHAPE } from './wielder-motif';

describe('the loadout motif (7D, D10): a spark shape and tint per advanced move', () => {
  it('gives every advanced move its own shape and tint, none of them the plain round spark', () => {
    const shapes = ADVANCED_ABILITIES.map((a) => MOTIF[a].shape);
    expect(new Set(shapes).size).toBe(ADVANCED_ABILITIES.length);
    expect(shapes).not.toContain(SHAPE.round);
    const tints = ADVANCED_ABILITIES.map((a) => MOTIF[a].tint);
    expect(new Set(tints).size).toBe(ADVANCED_ABILITIES.length);
    for (const t of tints) expect(t).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('the flare takes an advanced cast’s motif, and none for the base moves', () => {
    expect(moveMotif('freeze')).toBe(MOTIF.freeze);
    expect(moveMotif('gravity')).toBe(MOTIF.gravity);
    for (const base of ['throw', 'sweep', 'guard', 'infuse'] as const)
      expect(moveMotif(base)).toBeNull();
    expect(moveMotif(null)).toBeNull();
  });

  it('splits a wielder’s motes between its two picks, half each', () => {
    const picks = ['charge', 'magnetize'] as const;
    const motifs = Array.from({ length: 10 }, (_, m) => moteMotif(picks, m, 10));
    expect(motifs.filter((x) => x === MOTIF.charge)).toHaveLength(5);
    expect(motifs.filter((x) => x === MOTIF.magnetize)).toHaveLength(5);
    expect(motifs[0]).toBe(MOTIF.charge);
    expect(motifs[9]).toBe(MOTIF.magnetize);
  });
});
