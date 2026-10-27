/**
 * Procedural surface textures: seeded, non-degenerate in every channel, and exactly periodic
 * (triplanar world-space sampling would expose any seam across the whole arena). Coverage checks
 * pin the art direction: polished stone carries only sparse fissures, aged brass stays mostly
 * bright metal.
 */
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../procedural';
import { surfaceData, surfaceSampler, type SurfaceFamily, type SurfaceTexel } from './surfaces';

const N = 64;

function channelStats(d: Uint8Array, c: number) {
  let min = 255;
  let max = 0;
  for (let i = c; i < d.length; i += 4) {
    min = Math.min(min, d[i]!);
    max = Math.max(max, d[i]!);
  }
  return { min, max };
}

/** Fraction of texels whose channel exceeds a threshold (0–255). */
function coverage(d: Uint8Array, c: number, above: number): number {
  let n = 0;
  for (let i = c; i < d.length; i += 4) if (d[i]! > above) n++;
  return n / (d.length / 4);
}

const texel = (): SurfaceTexel => ({ value: 0, rough: 0, cavity: 0, crack: 0, height: 0 });

describe('surface textures', () => {
  for (const family of ['basalt', 'fractured', 'rift', 'brass', 'steel'] as SurfaceFamily[]) {
    it(`${family}: seeded, varied value/roughness channels, exactly periodic (seamless)`, () => {
      const a = surfaceData(family, N, 5);
      const b = surfaceData(family, N, 5);
      expect(a.detail.every((v, i) => v === b.detail[i])).toBe(true);
      for (const c of [0, 1]) {
        const s = channelStats(a.detail, c);
        expect(s.max - s.min, `${family} channel ${c} range`).toBeGreaterThan(40);
      }
      // The field repeats exactly one tile over in u and in v: no seam anywhere in the world.
      const f = surfaceSampler(family, 5);
      const rand = mulberry32(99);
      const [p, q, r] = [texel(), texel(), texel()];
      let worst = 0;
      for (let i = 0; i < 300; i++) {
        const u = rand();
        const v = rand();
        f(u, v, p);
        f(u + 1, v, q);
        f(u, v - 1, r);
        for (const k of ['value', 'rough', 'cavity', 'crack', 'height'] as const) {
          worst = Math.max(worst, Math.abs(p[k] - q[k]), Math.abs(p[k] - r[k]));
        }
      }
      expect(worst, `${family} periodicity error`).toBeLessThan(1e-6);
    });
  }

  it('stone carries a crack mask; metals do not', () => {
    expect(channelStats(surfaceData('fractured', N, 5).detail, 3).max).toBeGreaterThan(200);
    expect(channelStats(surfaceData('rift', N, 5).detail, 3).max).toBeGreaterThan(200);
    expect(channelStats(surfaceData('brass', N, 5).detail, 3).max).toBe(0);
  });

  it('crack density by family: sparse on polished basalt, more on fractured, most where rift-cracked', () => {
    const basalt = coverage(surfaceData('basalt', 128, 11).detail, 3, 128);
    const fractured = coverage(surfaceData('fractured', 128, 23).detail, 3, 128);
    const rift = coverage(surfaceData('rift', 128, 29).detail, 3, 128);
    expect(basalt).toBeGreaterThan(0.002);
    expect(basalt).toBeLessThan(0.02);
    expect(fractured).toBeGreaterThan(basalt);
    expect(fractured).toBeLessThan(0.1);
    expect(rift).toBeGreaterThan(fractured);
    expect(rift).toBeLessThan(0.16);
    const brass = surfaceData('brass', 128, 37).detail;
    expect(coverage(brass, 2, 0.4 * 255), 'patina coverage').toBeLessThan(0.25);
    expect(coverage(brass, 0, 0.65 * 255), 'bright metal coverage').toBeGreaterThan(0.6);
  });
});
