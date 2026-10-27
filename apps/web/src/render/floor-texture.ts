import * as THREE from 'three';
import type { ArenaLayout } from '@ff/game-data';
import { ValueNoise2D, heightToNormal, hexToRgb, mulberry32 } from './procedural';
import { PALETTE, TEAM_COLORS } from './art-tokens';

export interface FloorTextures {
  readonly map: THREE.DataTexture;
  readonly normalMap: THREE.DataTexture;
  /** R = ambient occlusion, G = roughness, B = metalness (three.js ORM convention). */
  readonly ormMap: THREE.DataTexture;
  /** World extents covered by the textures (half sizes). */
  readonly halfX: number;
  readonly halfZ: number;
}

/**
 * Generates the arena floor: rows of dressed basalt flagstones with recessed grout and bevels,
 * quartz veining, brass inlays (centre line, centre rings, goal arcs, boundary trim) and a subtle
 * team tint inside each goal area. One unique (non-repeating) texture spans the whole platform.
 */
export function generateFloorTextures(
  arena: ArenaLayout,
  width: number,
  seed = 1337,
): FloorTextures {
  const halfX = arena.halfLength + arena.goal.depth + 0.6;
  const halfZ = arena.halfWidth + 2;
  const W = width;
  const H = Math.round((W * halfZ) / halfX);
  const pxPerM = W / (2 * halfX);
  const rand = mulberry32(seed);
  const noise = new ValueNoise2D(seed ^ 0x9e37, 256);
  const vein = new ValueNoise2D(seed ^ 0x51ed, 256);

  // Row layout: fixed row height, random tile lengths per row (running bond).
  const ROW = 1.5;
  const rows = Math.ceil((2 * halfZ) / ROW) + 1;
  const edges: number[][] = [];
  const tones: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const e: number[] = [];
    const t: number[] = [];
    let x = -halfX - rand() * 2;
    while (x < halfX + 3) {
      e.push(x);
      t.push(0.8 + rand() * 0.32);
      x += 1.3 + rand() * 1.4;
    }
    e.push(x);
    edges.push(e);
    tones.push(t);
  }

  const color = new Uint8Array(W * H * 4);
  const orm = new Uint8Array(W * H * 4);
  const height = new Float32Array(W * H);
  const base = hexToRgb(PALETTE.basaltPolished);
  const dark = hexToRgb(PALETTE.basaltShadow);
  const brass = hexToRgb(PALETTE.brass);
  const steel = hexToRgb(PALETTE.coldSilver);
  const teams = TEAM_COLORS.map(hexToRgb);
  const L = arena.halfLength;
  const Wd = arena.halfWidth;
  const C = arena.cornerChamfer;
  const GROUT = 0.03;
  const BEVEL = 0.085;

  for (let py = 0; py < H; py++) {
    const z = halfZ - ((py + 0.5) / H) * 2 * halfZ;
    const rowF = (z + halfZ) / ROW;
    const row = Math.min(rows - 1, Math.max(0, Math.floor(rowF)));
    const zIn = (rowF - row) * ROW;
    const dzEdge = Math.min(zIn, ROW - zIn);
    const rowEdges = edges[row]!;
    const rowTones = tones[row]!;
    let ti = 0;
    for (let px = 0; px < W; px++) {
      const x = -halfX + ((px + 0.5) / W) * 2 * halfX;
      while (ti < rowEdges.length - 2 && x > rowEdges[ti + 1]!) ti++;
      const dxEdge = Math.min(x - rowEdges[ti]!, rowEdges[ti + 1]! - x);
      const edgeDist = Math.min(dxEdge, dzEdge);
      const i = py * W + px;
      const o = i * 4;

      const ax = Math.abs(x);
      const az = Math.abs(z);
      // Chamfer line passes through (L - C, W) and (L, W - C): x + z = L + W - C.
      const inside = ax <= L && az <= Wd && ax + az <= L + Wd - C;
      const inGoal = ax > L && ax <= L + arena.goal.depth && az <= arena.goal.mouthHalfWidth;

      const n = noise.fbm(x * 1.7, z * 1.7, 3);
      const speck = noise.sample(x * 23, z * 23);
      let r: number;
      let g: number;
      let b: number;
      let rough: number;
      let metal = 0;
      let ao = 1;
      let h: number;

      if (inside || inGoal) {
        const tone = (rowTones[ti] ?? 1) * (0.86 + n * 0.28) * (0.94 + speck * 0.12);
        r = base[0] * tone;
        g = base[1] * tone;
        b = base[2] * tone;
        rough = 0.6 + (1 - (rowTones[ti] ?? 1)) * 0.6 + speck * 0.12;
        h = 1;
        if (edgeDist < GROUT) {
          r = dark[0] * 0.45;
          g = dark[1] * 0.45;
          b = dark[2] * 0.45;
          rough = 0.95;
          ao = 0.5;
          h = 0;
        } else if (edgeDist < BEVEL) {
          const k = (edgeDist - GROUT) / (BEVEL - GROUT);
          h = 0.35 + 0.65 * Math.sqrt(k);
          ao = 0.72 + 0.28 * k;
          r *= 0.82 + 0.18 * k;
          g *= 0.82 + 0.18 * k;
          b *= 0.82 + 0.18 * k;
        }
        // Thin quartz veins (ridged noise) — sparse, slightly glassy.
        const v = Math.abs(vein.fbm(x * 0.55 + 7.1, z * 0.55 - 3.3, 4) - 0.5);
        if (v < 0.012 && edgeDist >= GROUT) {
          const k = 1 - v / 0.012;
          r += (150 - r) * k * 0.22;
          g += (165 - g) * k * 0.22;
          b += (178 - b) * k * 0.22;
          rough -= 0.25 * k;
          h -= 0.15 * k;
        }
        // Team tint inside each goal area (redundant with arc shape for colour-blind readability).
        const goalEnd = x < 0 ? 0 : 1;
        const dGoal = Math.hypot(ax - L, z);
        if (dGoal < 6 && !inGoal) {
          const tint = teams[goalEnd]!;
          const k = 0.07 * (1 - dGoal / 6);
          r += (tint[0] - r) * k;
          g += (tint[1] - g) * k;
          b += (tint[2] - b) * k;
        }
        if (inGoal) {
          r *= 0.55;
          g *= 0.55;
          b *= 0.6;
        }
        // Brass inlays.
        const rCenter = Math.hypot(x, z);
        const inlay =
          (inside && ax < 0.045) ||
          Math.abs(rCenter - 3.2) < 0.05 ||
          Math.abs(rCenter - 2.85) < 0.022 ||
          (inside && Math.abs(dGoal - 6) < 0.04) ||
          (inside && Math.abs(dGoal - 6.25) < 0.02);
        if (inlay) {
          const wear = 0.8 + noise.sample(x * 9, z * 9) * 0.3;
          r = brass[0] * wear;
          g = brass[1] * wear;
          b = brass[2] * wear;
          rough = 0.26 + speck * 0.12;
          metal = 1;
          h = 0.92;
          ao = 1;
        }
        // Steel trim along the inner boundary.
        const boundary = Math.min(
          L - ax,
          Wd - az,
          (L - C + (Wd - C) - ax - az) / Math.SQRT2 + C / Math.SQRT2,
        );
        if (inside && boundary < 0.12) {
          r = steel[0] * 0.75;
          g = steel[1] * 0.75;
          b = steel[2] * 0.75;
          rough = 0.4;
          metal = 1;
          h = 0.9;
        }
      } else {
        // Beyond the walls the paving runs on under the walls to the platform's slabs: the same
        // courses, undressed — darker, rougher, wider joints, no veins, tint or inlays.
        const tone = (rowTones[ti] ?? 1) * (0.6 + n * 0.3) * (0.92 + speck * 0.16);
        r = base[0] * tone;
        g = base[1] * tone;
        b = base[2] * tone;
        rough = 0.82 + speck * 0.12;
        h = 1;
        if (edgeDist < GROUT * 1.6) {
          r = dark[0] * 0.4;
          g = dark[1] * 0.4;
          b = dark[2] * 0.4;
          rough = 0.95;
          ao = 0.45;
          h = 0;
        } else if (edgeDist < BEVEL) {
          const k = (edgeDist - GROUT * 1.6) / (BEVEL - GROUT * 1.6);
          h = 0.3 + 0.7 * Math.sqrt(k);
          ao = 0.68 + 0.32 * k;
          r *= 0.8 + 0.2 * k;
          g *= 0.8 + 0.2 * k;
          b *= 0.8 + 0.2 * k;
        }
      }

      color[o] = clamp255(r);
      color[o + 1] = clamp255(g);
      color[o + 2] = clamp255(b);
      color[o + 3] = 255;
      orm[o] = clamp255(ao * 255);
      orm[o + 1] = clamp255(rough * 255);
      orm[o + 2] = metal * 255;
      orm[o + 3] = 255;
      height[i] = h;
    }
  }

  const normal = heightToNormal(height, W, H, pxPerM * 0.02);
  const make = (data: Uint8Array, srgb: boolean) => {
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  };
  return {
    map: make(color, true),
    normalMap: make(normal, false),
    ormMap: make(orm, false),
    halfX,
    halfZ,
  };
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
