import { describe, expect, it } from 'vitest';
import { runeStripTexture } from './rune-texture';

describe('rune strip', () => {
  it('draws thin glyph strokes on a dark band: writing, not a solid glowing ring', () => {
    const glyphs = 24;
    const cell = 32;
    const height = 48;
    const tex = runeStripTexture(17, glyphs, cell, height);
    const d = tex.image.data as Uint8Array;
    const width = glyphs * cell;
    let lit = 0;
    for (let i = 0; i < width * height; i++) if (d[i * 4]! > 128) lit++;
    const share = lit / (width * height);
    expect(share).toBeGreaterThan(0.04);
    expect(share).toBeLessThan(0.3);
    // Every glyph has a stroke, and every glyph's cell keeps dark margins (they never merge).
    for (let g = 0; g < glyphs; g++) {
      let cellLit = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < cell; x++) {
          const v = d[(y * width + g * cell + x) * 4]!;
          if (v > 128) cellLit++;
          if (x === 0 || x === cell - 1) expect(v).toBeLessThan(64);
        }
      expect(cellLit).toBeGreaterThan(20);
    }
    tex.dispose();
  });

  it('is deterministic for a seed (every client draws the same inscription)', () => {
    const a = runeStripTexture(5).image.data as Uint8Array;
    const b = runeStripTexture(5).image.data as Uint8Array;
    const c = runeStripTexture(6).image.data as Uint8Array;
    const same = (x: Uint8Array, y: Uint8Array) =>
      x.length === y.length && x.every((v, i) => v === y[i]);
    expect(same(a, b)).toBe(true);
    expect(same(a, c)).toBe(false);
  });
});
