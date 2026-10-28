/**
 * Rune inscriptions (Phase 07B): a strip of original glyphs for the emissive bands around the
 * field pillars, so the glow reads as carved writing lit from within instead of a flat saturated
 * ring. Each glyph is a stem plus one or two strokes (branches, ticks, hooks, a chevron) on a
 * small grid, chosen by a seeded generator — writing-like, but not any real or fictional script.
 */
import * as THREE from 'three';
import { mulberry32 } from './procedural';

type Seg = readonly [number, number, number, number];

/** Glyph strokes in cell units: x ∈ [0, 4], y ∈ [0, 6] (y up). */
function glyphStrokes(rand: () => number): Seg[] {
  const x = rand() < 0.5 ? 1 : 2;
  const segs: Seg[] = [[x, 0, x, 6]];
  const strokes = 1 + (rand() < 0.55 ? 1 : 0);
  for (let s = 0; s < strokes; s++) {
    const y = [1, 2, 3, 4, 5][Math.floor(rand() * 5)]!;
    const side = rand() < 0.5 ? -1 : 1;
    const end = x + side * 2;
    switch (Math.floor(rand() * 4)) {
      case 0: // branch rising away from the stem
        segs.push([x, y, Math.min(4, Math.max(0, end)), Math.min(6, y + 2)]);
        break;
      case 1: // branch falling away from the stem
        segs.push([x, y, Math.min(4, Math.max(0, end)), Math.max(0, y - 2)]);
        break;
      case 2: // a tick across
        segs.push([Math.max(0, x - 1), y, Math.min(4, x + 1), y]);
        break;
      default: {
        // a chevron opening away from the stem
        const tip = Math.min(4, Math.max(0, x + side * 1.5));
        segs.push([x, y + 1, tip, y], [tip, y, x, y - 1]);
      }
    }
  }
  return segs;
}

/**
 * An RGBA strip of `glyphs` glyphs (white strokes on black, anti-aliased), `cell` px wide and
 * `height` px tall each; wraps horizontally.
 */
export function runeStripTexture(
  seed = 17,
  glyphs = 24,
  cell = 32,
  height = 48,
): THREE.DataTexture {
  const rand = mulberry32(seed);
  const width = glyphs * cell;
  const data = new Uint8Array(width * height * 4);
  // Glyph box inside its cell: margins left/right and top/bottom.
  const mx = cell * 0.2;
  const my = height * 0.16;
  const sx = (cell - 2 * mx) / 4;
  const sy = (height - 2 * my) / 6;
  const halfWidth = 1.3;
  for (let g = 0; g < glyphs; g++) {
    const segs = glyphStrokes(rand).map(
      ([x0, y0, x1, y1]) => [mx + x0 * sx, my + y0 * sy, mx + x1 * sx, my + y1 * sy] as const,
    );
    for (let py = 0; py < height; py++)
      for (let px = 0; px < cell; px++) {
        const fx = px + 0.5;
        const fy = py + 0.5;
        let d = Infinity;
        for (const [ax, ay, bx, by] of segs) {
          const vx = bx - ax;
          const vy = by - ay;
          const len2 = vx * vx + vy * vy || 1;
          const t = Math.min(1, Math.max(0, ((fx - ax) * vx + (fy - ay) * vy) / len2));
          d = Math.min(d, Math.hypot(fx - ax - t * vx, fy - ay - t * vy));
        }
        const v = Math.round(255 * Math.min(1, Math.max(0, halfWidth + 0.7 - d)));
        const i = (py * width + g * cell + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
  }
  const tex = new THREE.DataTexture(data, width, height);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
