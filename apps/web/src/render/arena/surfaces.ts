/**
 * Procedural, tileable surface textures for the arena's PBR materials (Phase 07A). Original and
 * seeded — no third-party texture is used. Each family produces two textures:
 *
 *   detail  RGBA8  R value (albedo variation), G roughness, B cavity (dirt/occlusion), A crack mask
 *   normal  RGBA8  tangent-space normal (+Z up), derived from the same height field
 *
 * Everything wraps at the tile edges (periodic lattices, octaves at exactly doubled frequency and
 * periodic Worley cells), so triplanar sampling in world space never shows seams.
 */
import * as THREE from 'three';
import { mulberry32 } from '../procedural';

export type SurfaceFamily = 'basalt' | 'fractured' | 'rift' | 'brass' | 'steel';

export interface SurfaceTextures {
  readonly detail: THREE.DataTexture;
  readonly normal: THREE.DataTexture;
}

/**
 * Tileable value-noise fbm. Octave k samples its own lattice of (px·2^k) × (py·2^k) cells at
 * 2^k times the frequency, so for u, v in [0, 1) (coordinates u·px, v·py) every octave covers the
 * tile exactly once: the sum repeats once per tile and never inside it. Unequal periods give
 * anisotropic noise (brushed streaks, long scratches).
 */
class PeriodicNoise {
  private readonly lattices: Float32Array[] = [];
  private readonly pxs: number[] = [];
  private readonly pys: number[] = [];
  constructor(seed: number, px: number, py = px, octaves = 1) {
    const rand = mulberry32(seed);
    for (let k = 0, s = 1; k < octaves; k++, s *= 2) {
      const l = new Float32Array(px * s * py * s);
      for (let i = 0; i < l.length; i++) l[i] = rand();
      this.lattices.push(l);
      this.pxs.push(px * s);
      this.pys.push(py * s);
    }
  }

  /**
   * Octave k at (x, y) in octave-0 units; with `grad`, also writes d/dx and d/dy (analytic
   * derivative of the smoothstep interpolation) into grad[0], grad[1].
   */
  private octave(k: number, x: number, y: number, grad?: Float64Array): number {
    const px = this.pxs[k]!;
    const py = this.pys[k]!;
    const s = px / this.pxs[0]!;
    const l = this.lattices[k]!;
    const fx0 = x * s;
    const fy0 = y * s;
    const xi = Math.floor(fx0);
    const yi = Math.floor(fy0);
    const fx = fx0 - xi;
    const fy = fy0 - yi;
    const x0 = xi - Math.floor(xi / px) * px;
    const y0 = yi - Math.floor(yi / py) * py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1;
    const y1 = y0 + 1 === py ? 0 : y0 + 1;
    const a = l[y0 * px + x0]!;
    const b = l[y0 * px + x1]!;
    const c = l[y1 * px + x0]!;
    const d = l[y1 * px + x1]!;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const e = a - b - c + d;
    if (grad) {
      grad[0] = s * 6 * fx * (1 - fx) * (b - a + e * sy);
      grad[1] = s * 6 * fy * (1 - fy) * (c - a + e * sx);
    }
    return a + (b - a) * sx + (c - a) * sy + e * sx * sy;
  }

  sample(x: number, y: number): number {
    return this.octave(0, x, y);
  }

  fbm(x: number, y: number, octaves = this.lattices.length): number {
    let amp = 0.5;
    let sum = 0;
    let norm = 0;
    for (let k = 0; k < octaves; k++) {
      sum += this.octave(k, x, y) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }

  private readonly g = new Float64Array(2);

  /**
   * Distance (in octave-0 units) to the fbm's 0.5 contour, normalised by the local gradient so
   * contour lines have a uniform width (raw |n − 0.5| swells into blobs where the field is flat).
   */
  contour(x: number, y: number, octaves = this.lattices.length): number {
    let amp = 0.5;
    let sum = 0;
    let gx = 0;
    let gy = 0;
    let norm = 0;
    for (let k = 0; k < octaves; k++) {
      sum += this.octave(k, x, y, this.g) * amp;
      gx += this.g[0]! * amp;
      gy += this.g[1]! * amp;
      norm += amp;
      amp *= 0.5;
    }
    const n = sum / norm - 0.5;
    return Math.abs(n) / Math.max(Math.sqrt(gx * gx + gy * gy) / norm, 1e-3);
  }
}

/** Tileable Worley noise: distance to the nearest and second-nearest jittered cell point. */
class Worley {
  private readonly pts: Float32Array;
  constructor(
    seed: number,
    private readonly cells: number,
  ) {
    const rand = mulberry32(seed);
    this.pts = new Float32Array(cells * cells * 2);
    for (let i = 0; i < this.pts.length; i++) this.pts[i] = rand();
  }

  /** u, v in [0, 1): returns [F1, F2] in cell units (reuses one array: copy if kept). */
  sample(u: number, v: number): [number, number] {
    const n = this.cells;
    const x = u * n;
    const y = v * n;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = 81;
    let f2 = 81;
    for (let oy = -1; oy <= 1; oy++) {
      const gy = cy + oy;
      const wy = gy - Math.floor(gy / n) * n;
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        const wx = gx - Math.floor(gx / n) * n;
        const i = (wy * n + wx) * 2;
        const dx = gx + this.pts[i]! - x;
        const dy = gy + this.pts[i + 1]! - y;
        const d = dx * dx + dy * dy;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    this.out[0] = Math.sqrt(f1);
    this.out[1] = Math.sqrt(f2);
    return this.out;
  }

  private readonly out: [number, number] = [0, 0];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Height → tangent-space normal, wrapping at the edges (tileable). */
function wrapNormal(h: Float32Array, n: number, strength: number): Uint8Array {
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const ym = ((y - 1 + n) % n) * n;
    const yp = ((y + 1) % n) * n;
    for (let x = 0; x < n; x++) {
      const xm = (x - 1 + n) % n;
      const xp = (x + 1) % n;
      const dx = (h[y * n + xp]! - h[y * n + xm]!) * strength;
      const dy = (h[yp + x]! - h[ym + x]!) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * n + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function texture(data: Uint8Array, n: number, linear: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** One texel of a surface (all channels 0–1 except the unbounded height). */
export interface SurfaceTexel {
  value: number;
  rough: number;
  cavity: number;
  crack: number;
  height: number;
}

/**
 * The continuous surface field of a family: (u, v) → channels, periodic with period 1 in both
 * u and v (exported for tests, which check the periodicity exactly). Writes into `out`.
 */
export function surfaceSampler(
  family: SurfaceFamily,
  seed: number,
): (u: number, v: number, out: SurfaceTexel) => SurfaceTexel {
  const big = new PeriodicNoise(seed, 6, 6, 3);
  const mid = new PeriodicNoise(seed + 1, 24, 24, 3);
  const fine = new PeriodicNoise(seed + 2, 96);
  // Which stretches of the crack network are actually cracked (a low-frequency mask).
  const crackMask = new PeriodicNoise(seed + 5, 4, 4, 2);
  // Brushing runs along U: slow along U, fast across it; scratches are long and sparse.
  const streaks = new PeriodicNoise(seed + 6, 6, 192, 2);
  const scratches = new PeriodicNoise(seed + 7, 3, 256);
  const cells = new Worley(
    seed + 3,
    { basalt: 3, fractured: 5, rift: 4, brass: 3, steel: 3 }[family],
  );
  const pits = new Worley(seed + 4, 24);
  // Cracks follow domain-warped cells (jagged, irregular — a plain cell network reads as
  // cobblestone); secondary fissures follow uniform-width contour lines of a smooth field.
  const warp = new PeriodicNoise(seed + 10, 4, 4, 3);
  const fissures = new PeriodicNoise(seed + 8, 3, 3, 4);
  return (u, v, out) => {
    const b = big.fbm(u * 6, v * 6, 3);
    const m = mid.fbm(u * 24, v * 24, 3);
    const f = fine.sample(u * 96, v * 96);
    let value: number;
    let rough: number;
    let cavity: number;
    let crack = 0;
    let h: number;
    if (family === 'brass' || family === 'steel') {
      const streak = streaks.fbm(u * 6, v * 192, 2);
      const scratch = smooth(0.8, 0.9, scratches.sample(u * 3, v * 256));
      if (family === 'steel') {
        value = 0.55 + 0.3 * (streak - 0.5) + 0.22 * (b - 0.5);
        rough = 0.35 + 0.45 * streak + 0.2 * scratch;
        cavity = smooth(0.62, 0.8, b) * 0.6;
        h = streak * 0.3 + b * 0.4;
      } else {
        // Aged brass: bright worked metal with sparse, low-lying patches of oxide (a dielectric
        // the material renders less metallic) — not an all-over camouflage of patina.
        const patina = smooth(0.6, 0.78, b * 0.6 + m * 0.4 + (f - 0.5) * 0.1);
        value = 0.8 + 0.1 * (m - 0.5) + 0.1 * (streak - 0.5) - 0.42 * patina + 0.06 * scratch;
        rough = 0.26 + 0.18 * streak + 0.42 * patina - 0.08 * scratch;
        cavity = patina * 0.8;
        h = m * 0.5 + b * 0.4 - scratch * 0.1 - patina * 0.12;
      }
    } else {
      const [p1] = pits.sample(u, v);
      const pit = 1 - smooth(0.0, 0.1, p1);
      const wu = u + (warp.fbm(u * 4, v * 4) - 0.5) * 0.16;
      const wv = v + (warp.fbm(u * 4 + 1.7, v * 4 + 2.9) - 0.5) * 0.16;
      const [f1, f2] = cells.sample(wu, wv);
      const edge = f2 - f1;
      // Crack width varies along each crack.
      const jag = 0.4 + 1.2 * m;
      const mask = crackMask.fbm(u * 4, v * 4);
      if (family === 'basalt') {
        // Polished basalt: broad tonal variation, fine grain, sparse thin fissures, worn polish.
        crack = smooth(0.56, 0.68, mask) * (1 - smooth(0.0, 0.03 * jag, edge));
        value = 0.45 + 0.4 * (b - 0.5) + 0.2 * (m - 0.5) + 0.07 * (f - 0.5) - 0.1 * crack;
        rough = 0.28 + 0.32 * smooth(0.35, 0.75, m) + 0.14 * (f - 0.5) + 0.2 * crack;
        h = b * 0.5 + m * 0.25 + f * 0.06 - crack * 0.12 - pit * 0.04;
      } else if (family === 'rift') {
        // Rift-cracked: a broken network of wide jagged fissures (they glow), fine hairlines
        // between them, the stone scorched dark along each.
        const keep = smooth(0.32, 0.46, mask);
        const fissure = keep * (1 - smooth(0.0, 0.075 * jag, edge));
        const hair = (1 - smooth(0.0, 0.02, fissures.contour(u * 3, v * 3))) * 0.7;
        crack = Math.max(fissure, hair * smooth(0.4, 0.55, mask));
        const scorch = keep * (1 - smooth(0.0, 0.24, edge));
        value = 0.36 + 0.36 * (b - 0.5) + 0.26 * (m - 0.5) + 0.1 * (f - 0.5) - 0.3 * scorch;
        rough = 0.74 + 0.18 * (m - 0.5) + 0.1 * crack;
        h = b * 0.8 + m * 0.4 + f * 0.1 - crack * 0.9 - scorch * 0.15 - pit * 0.08;
      } else {
        // Fractured basalt: weathered, mottled, a few jagged cracks and the odd hairline fissure.
        const cleavage = smooth(0.58, 0.7, mask) * (1 - smooth(0.0, 0.045 * jag, edge));
        const hair = (1 - smooth(0.0, 0.016, fissures.contour(u * 3, v * 3))) * 0.65;
        crack = Math.max(cleavage, hair * smooth(0.5, 0.62, 1 - mask));
        value = 0.4 + 0.42 * (b - 0.5) + 0.3 * (m - 0.5) + 0.12 * (f - 0.5) - 0.22 * crack;
        rough = 0.72 + 0.2 * (m - 0.5) + 0.1 * crack;
        h = b * 0.9 + m * 0.45 + f * 0.12 - crack * 0.9 - pit * 0.1;
      }
      cavity = clamp01(crack * 0.8 + pit * 0.35);
    }
    out.value = clamp01(value);
    out.rough = clamp01(rough);
    out.cavity = clamp01(cavity);
    out.crack = clamp01(crack);
    out.height = h;
    return out;
  };
}

/** Raw channel data, one texel per (x/n, y/n) of the periodic field (exported for tests). */
export function surfaceData(
  family: SurfaceFamily,
  n: number,
  seed: number,
): { detail: Uint8Array; height: Float32Array } {
  const sample = surfaceSampler(family, seed);
  const t: SurfaceTexel = { value: 0, rough: 0, cavity: 0, crack: 0, height: 0 };
  const detail = new Uint8Array(n * n * 4);
  const height = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      sample(x / n, y / n, t);
      const i = (y * n + x) * 4;
      detail[i] = t.value * 255;
      detail[i + 1] = t.rough * 255;
      detail[i + 2] = t.cavity * 255;
      detail[i + 3] = t.crack * 255;
      height[y * n + x] = t.height;
    }
  }
  return { detail, height };
}

const cache = new Map<string, SurfaceTextures>();

/** Load cost of the generated textures (main thread), for the dev HUD and the perf report. */
export const surfaceStats = { generated: 0, ms: 0 };

/** Generated once per (family, size) and shared; never disposed while the app runs. */
export function surfaceTextures(family: SurfaceFamily, size: number): SurfaceTextures {
  const key = `${family}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t0 = performance.now();
  const seed = { basalt: 11, fractured: 23, rift: 29, brass: 37, steel: 41 }[family];
  const { detail, height } = surfaceData(family, size, seed);
  const strength =
    { basalt: 3.2, fractured: 5.5, rift: 5, brass: 2.2, steel: 1.6 }[family] * (size / 512);
  const t: SurfaceTextures = {
    detail: texture(detail, size, true),
    normal: texture(wrapNormal(height, size, strength), size, true),
  };
  cache.set(key, t);
  surfaceStats.generated++;
  surfaceStats.ms += performance.now() - t0;
  return t;
}
