/**
 * Surface preview sheet (dev tool for Phase 07 art work): renders each surface recipe's texture
 * tile 2 × 2 — repetition inside a tile, or a seam, is then obvious — with its colours, cavity
 * darkening and crack glow. For tuning textures quickly; in-game captures remain the evidence.
 *
 *   pnpm preview:surfaces /tmp/tiles.png
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { SURFACES } from '../src/render/art-tokens';
import { surfaceData } from '../src/render/arena/surfaces';

const OUT = process.argv[2] ?? 'surface-preview.png';

function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const table = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function main(): void {
  const N = 256;
  const recipes = [
    SURFACES.basaltPolished,
    SURFACES.basaltFractured,
    SURFACES.riftCracked,
    SURFACES.brassAged,
    SURFACES.steelCold,
  ];
  const W = N * 2 * recipes.length;
  const H = N * 2;
  const out = new Uint8Array(W * H * 3);
  recipes.forEach((r, ri) => {
    const d = surfaceData(
      r.family,
      N,
      { basalt: 11, fractured: 23, rift: 29, brass: 37, steel: 41 }[r.family],
    ).detail;
    const [lo, hi] = [rgb(r.colorLo), rgb(r.colorHi)];
    const glow = 'glowColor' in r && r.glowColor ? rgb(r.glowColor) : null;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < N * 2; x++) {
        const i = ((y % N) * N + (x % N)) * 4;
        const v = d[i]! / 255;
        const cavity = d[i + 2]! / 255;
        const crack = d[i + 3]! / 255;
        const o = (y * W + ri * N * 2 + x) * 3;
        for (let k = 0; k < 3; k++) {
          // Display only: lift the dark albedo so detail is visible on screen.
          let c = (lo[k]! + (hi[k]! - lo[k]!) * v) * (1 - 0.5 * cavity * r.cavity) * 1.8;
          if (glow) c += glow[k]! * Math.min(1, Math.max(0, (crack - 0.35) / 0.55)) * 1.2;
          out[o + k] = Math.min(255, c);
        }
      }
    }
  });
  writeFileSync(OUT, png(W, H, out));
  console.log(`wrote ${OUT}`);
}

main();
