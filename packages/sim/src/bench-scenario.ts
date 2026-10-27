import {
  MERIDIAN_ARENA,
  type AbilityId,
  type AbilityTable,
  type ArenaLayout,
  type BoulderObstacle,
} from '@ff/game-data';
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

/** Loadouts that put every advanced element system in play (seat 0 + seat 1). */
export const ELEMENT_STRESS_LOADOUTS: readonly [readonly AbilityId[], readonly AbilityId[]] = [
  ['freeze', 'charge'],
  ['gravity', 'magnetize'],
];

/** Ability table without cooldowns or lockouts: saturates every element cap (stress only). */
export function saturatedAbilities(base: AbilityTable): AbilityTable {
  const out = {} as Record<AbilityId, AbilityTable[AbilityId]>;
  for (const id of Object.keys(base) as AbilityId[])
    out[id] = { ...base[id], cooldownSeconds: 0, lockoutSeconds: 0 };
  return out as unknown as AbilityTable;
}

/**
 * Worst-case element load (D04 "worst-case 2-player overlapping effects"): each seat works a
 * rotating set of spots on its half — soak, heat twice (boil to steam), heat dry ground (flame) —
 * while seat 0 freezes and discharges and seat 1 drops gravity wells and holds the magnet, both
 * sweeping, pulsing and guarding. Energy is topped up and boulders are periodically slammed
 * (debug hooks) so the load is sustained; this measures simulation CPU at the caps, not balance.
 * Every cast is an ordinary ActionIntent: validation, cooldowns and lockouts apply (pass
 * `saturatedAbilities` to the world to remove cooldowns and push every region to its cap).
 */
export class ElementStress {
  private seq: [number, number] = [0, 0];
  private tick = 0;
  private readonly spot: [number, number] = [0, 0];
  private readonly infuseStep: [number, number] = [0, 0];
  private readonly rng: Rng;
  private readonly infuseEvery: number;
  private readonly pace: number;
  private readonly fillPools: boolean;
  constructor(
    seed = 17,
    opts: {
      /** Ticks between infuse attempts per seat (25 ≈ the real 0.8 s cooldown). */
      readonly infuseEvery?: number;
      /** Multiplier on every other cast interval (< 1 = more often; for saturated tables). */
      readonly pace?: number;
      /** Keep standing water at the pool cap with staged patches (debug hook). */
      readonly fillPools?: boolean;
    } = {},
  ) {
    this.rng = new Rng(seed);
    this.infuseEvery = opts.infuseEvery ?? 25;
    this.pace = opts.pace ?? 1;
    this.fillPools = opts.fillPools ?? false;
  }

  private every(t: number, n: number, phase: number): boolean {
    const k = Math.max(2, Math.round(n * this.pace));
    return (t + phase) % k === 0;
  }

  private spotXZ(slot: PlayerSlot, k: number): [number, number] {
    const side = slot === 0 ? -1 : 1;
    const i = ((k % 6) + 6) % 6;
    return [side * (3.5 + (i % 3) * 5), (Math.floor(i / 3) - 0.5) * 9];
  }

  private sink: (slot: PlayerSlot, intent: ActionIntent) => void = () => undefined;

  private cast(
    world: GameWorld,
    slot: PlayerSlot,
    at: readonly [number, number],
    action: ActionIntent['action'],
    phase: ActionIntent['phase'],
    modifier?: number,
  ): void {
    world.debugPlaceManipulator(slot, at[0], at[1]);
    const side = slot === 0 ? -1 : 1;
    this.sink(slot, {
      seq: this.seq[slot]++,
      clientTime: this.tick * 33,
      action,
      phase,
      aim: [
        Math.max(-1, Math.min(1, at[0] / world.arena.halfLength)),
        Math.max(-1, Math.min(1, at[1] / world.arena.halfWidth)),
      ],
      ...(action === 'sweep' ? { dir: [0, side] as const } : {}),
      intensity: 1,
      ...(modifier !== undefined ? { modifier } : {}),
      source: 'bot',
    });
  }

  /**
   * Advances one tick of load. `apply` receives every intent (default: straight into the world);
   * hosts that also take intents from elsewhere pass a sink that keeps sequence numbers ordered.
   */
  drive(
    world: GameWorld,
    apply: (slot: PlayerSlot, intent: ActionIntent) => void = (slot, intent) => {
      world.applyCommand(slot, intent);
    },
  ): void {
    this.sink = apply;
    const t = this.tick++;
    // Rounds still end (every 30 s) so the field resets and fractured boulders are rebuilt, as in
    // play; otherwise the clock is held so the load never pauses for long.
    if (world.phase === 'matchEnd') world.rematch();
    if (t % 900 === 899) world.debugSetClock(1);
    else if (t % 240 === 0) world.debugSetClock(9000);
    for (const slot of [0, 1] as const) {
      world.debugSetEnergy(slot, 100);
      const off = slot * 5;
      const here = this.spotXZ(slot, this.spot[slot]);
      const prev = this.spotXZ(slot, this.spot[slot] - 1);
      if ((t + off) % this.infuseEvery === 0) {
        // soak → heat → heat (boils: steam) → heat on dry ground beside it (flame).
        const k = this.infuseStep[slot]++ % 4;
        if (k === 3) {
          const dry: [number, number] = [here[0], here[1] + (here[1] > 0 ? -3.6 : 3.6)];
          this.cast(world, slot, dry, 'infuse', 'tap', 1);
          this.spot[slot]++;
        } else this.cast(world, slot, here, 'infuse', 'tap', k === 0 ? 0 : 1);
        continue;
      }
      const jitter: [number, number] = [
        here[0] + this.rng.range(-1.5, 1.5),
        here[1] + this.rng.range(-1.5, 1.5),
      ];
      if (slot === 0 && this.every(t, 37, 7)) this.cast(world, 0, prev, 'freeze', 'tap');
      else if (slot === 0 && this.every(t, 41, 3)) this.cast(world, 0, jitter, 'charge', 'tap');
      else if (slot === 1 && this.every(t, 61, 11)) this.cast(world, 1, jitter, 'gravity', 'tap');
      else if (slot === 1 && t % 150 === 30) this.cast(world, 1, jitter, 'magnetize', 'start');
      else if (slot === 1 && t % 150 === 90) this.cast(world, 1, jitter, 'magnetize', 'end');
      else if (this.every(t + off, 75, 35))
        this.cast(world, slot, jitter, 'sweep', 'tap', slot === 0 ? 1 : -1);
      else if (this.every(t + off, 24, 12)) this.cast(world, slot, jitter, 'pulse', 'tap');
      else if (this.every(t + off, 110, 50)) this.cast(world, slot, jitter, 'guard', 'tap');
      else if (t % 3 === slot) this.cast(world, slot, jitter, 'aim', 'hold');
    }
    if (this.fillPools && t % 15 === 0) {
      const pools = world.debugRegions().pools;
      if (pools.length < world.rules.elements.maxPools) {
        // Standing water across the middle lanes, between the two seats' heat spots.
        const k = Math.floor(t / 15) % 8;
        const x = (k % 4) * 4 - 6;
        const z = (Math.floor(k / 4) - 0.5) * 4.5;
        world.debugAddPool(k % 2 === 0 ? 0 : 1, x, z, 2.2, 0.8);
      }
    }
    // Keep fractures (and the shard budget) busy: slam a boulder into the arena every 1.5 s.
    if (t % 45 === 10) {
      const boulders = world.debugEntities('boulder');
      const id = boulders[Math.floor(this.rng.range(0, boulders.length))];
      if (id !== undefined) world.debugApplyImpulse(id, this.rng.range(-400, 400), 0, 600);
    }
  }
}
