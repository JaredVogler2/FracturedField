import { MERIDIAN_ARENA, type ArenaLayout, type BoulderObstacle } from '@ff/game-data';
import type { ActionIntent, PlayerSlot } from '@ff/protocol';
import { Rng } from './rng.js';
import type { GameWorld } from './game.js';

/**
 * Representative load used by BOTH the offline Node benchmark and the in-Worker benchmark so the
 * numbers are comparable: the Meridian arena plus extra dynamic boulders (core + boulders = N
 * dynamic bodies) and a region stand-in that performs the per-tick arithmetic the Phase 04
 * element-region system is budgeted for (20 regions, neighbour exchange, body sampling).
 */
export function makeBenchArena(dynamicBodies: number): ArenaLayout {
  const boulders: BoulderObstacle[] = [];
  const needed = Math.max(0, dynamicBodies - 1); // the core is one dynamic body
  const cols = 6;
  for (let i = 0; i < needed; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // Symmetric-ish lattice across both halves, clear of goals and spawn points.
    const x = (c - (cols - 1) / 2) * 5.2;
    const z = (r - 1.5) * 4.6 + (c % 2) * 0.8;
    if (Math.abs(x) < 1.5 && Math.abs(z) < 1.5) continue;
    boulders.push({
      kind: 'boulder',
      id: `bench-${i}`,
      x,
      z,
      radius: 0.6,
      mass: 14,
      material: 'basaltFractured',
    });
  }
  return {
    ...MERIDIAN_ARENA,
    id: `bench-${dynamicBodies}`,
    obstacles: [...MERIDIAN_ARENA.obstacles.filter((o) => o.kind === 'pillar'), ...boulders],
  };
}

export class RegionLoad {
  private readonly heat: Float64Array;
  private readonly moisture: Float64Array;
  private readonly charge: Float64Array;
  private readonly cx: Float64Array;
  private readonly cz: Float64Array;
  private readonly scratch: Float64Array;

  constructor(
    readonly count: number,
    seed = 1,
  ) {
    const rng = new Rng(seed);
    this.heat = new Float64Array(count);
    this.moisture = new Float64Array(count);
    this.charge = new Float64Array(count);
    this.cx = new Float64Array(count);
    this.cz = new Float64Array(count);
    this.scratch = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      this.cx[i] = rng.range(-19, 19);
      this.cz[i] = rng.range(-11, 11);
      this.heat[i] = rng.range(0, 1);
      this.moisture[i] = rng.range(0, 1);
    }
  }

  /** One tick of bounded conduction + body sampling. Returns a checksum so work is not elided. */
  step(bodies: readonly { x: number; z: number }[]): number {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.cx[i]! - this.cx[j]!;
        const dz = this.cz[i]! - this.cz[j]!;
        const d2 = dx * dx + dz * dz;
        if (d2 < 64) acc += (this.heat[j]! - this.heat[i]!) * (1 - d2 / 64);
      }
      this.scratch[i] = acc;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      this.heat[i] = Math.min(4, Math.max(0, this.heat[i]! + this.scratch[i]! * 0.01 - 0.001));
      this.moisture[i] = Math.max(0, this.moisture[i]! - this.heat[i]! * 0.0005);
      this.charge[i] = this.charge[i]! * 0.97 + (this.moisture[i]! > 0.5 ? 0.01 : 0);
      for (const b of bodies) {
        const dx = b.x - this.cx[i]!;
        const dz = b.z - this.cz[i]!;
        if (dx * dx + dz * dz < 9) sum += this.heat[i]! * this.moisture[i]!;
      }
      sum += this.heat[i]! + this.charge[i]!;
    }
    return sum;
  }
}

/**
 * Deterministic synthetic player input for benchmarks: both seats move and cast at human-like
 * rates (10 Hz aim, a pulse every ~0.8 s, periodic sweeps and guards).
 */
export class BenchInputs {
  private seq: [number, number] = [0, 0];
  private readonly rng: Rng;
  constructor(seed = 3) {
    this.rng = new Rng(seed);
  }

  next(tick: number): { slot: PlayerSlot; intent: ActionIntent }[] {
    const out: { slot: PlayerSlot; intent: ActionIntent }[] = [];
    for (const slot of [0, 1] as const) {
      const side = slot === 0 ? -1 : 1;
      const make = (
        action: ActionIntent['action'],
        phase: ActionIntent['phase'],
        modifier?: number,
      ): ActionIntent => ({
        seq: this.seq[slot]++,
        clientTime: tick * 33,
        action,
        phase,
        aim: [side * this.rng.range(0.05, 0.8), this.rng.range(-0.8, 0.8)],
        intensity: 1,
        ...(modifier !== undefined ? { modifier } : {}),
        source: 'bot',
      });
      if (tick % 3 === slot) out.push({ slot, intent: make('aim', 'hold') });
      if (tick % 24 === slot * 7) out.push({ slot, intent: make('pulse', 'tap') });
      if (tick % 75 === 20 + slot)
        out.push({ slot, intent: make('sweep', 'tap', slot === 0 ? 1 : -1) });
      if (tick % 110 === 50 + slot) out.push({ slot, intent: make('guard', 'tap') });
    }
    return out;
  }
}

/** Positions of dynamic bodies for the region stand-in, read from the world snapshot. */
export function bodyPositions(world: GameWorld): { x: number; z: number }[] {
  return world.snapshot().entities.map((e) => ({ x: e.p[0], z: e.p[2] }));
}
