/**
 * Offline Node benchmark (S18): per-tick cost of the shared simulation with the same scenario the
 * Worker benchmark uses, for 1, 10 and 50 concurrent rooms on one thread. This is NOT Worker proof;
 * it complements the in-Durable-Object benchmark (apps/room-worker/test/live-bench.ts).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BenchInputs,
  GameWorld,
  RegionLoad,
  bodyPositions,
  makeBenchArena,
  physicsVersion,
} from '../src/index.js';

const BODIES = Number(process.env.BENCH_BODIES ?? 20);
const REGIONS = Number(process.env.BENCH_REGIONS ?? 20);
const TICKS = Number(process.env.BENCH_TICKS ?? 1800); // 60 s of game time at 30 Hz
const ROOM_COUNTS = (process.env.BENCH_ROOMS ?? '1,10,50').split(',').map(Number);

interface Room {
  world: GameWorld;
  regions: RegionLoad;
  inputs: BenchInputs;
}

function pct(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

async function run(roomCount: number) {
  const rooms: Room[] = [];
  for (let i = 0; i < roomCount; i++) {
    rooms.push({
      world: await GameWorld.create({
        seed: 1000 + i,
        arena: makeBenchArena(BODIES),
        autoStart: true,
      }),
      regions: new RegionLoad(REGIONS, i + 1),
      inputs: new BenchInputs(i + 7),
    });
  }
  const perRoomTick: number[] = [];
  const allRoomsTick: number[] = [];
  let sink = 0;
  for (let t = 0; t < TICKS; t++) {
    const frameStart = performance.now();
    for (const r of rooms) {
      const s = performance.now();
      for (const { slot, intent } of r.inputs.next(r.world.tick))
        r.world.applyCommand(slot, intent);
      r.world.stepFixed();
      // Snapshot at 20 Hz like the authority (2 of every 3 ticks).
      if (t % 3 !== 2) sink += JSON.stringify(r.world.snapshot()).length;
      sink += r.regions.step(bodyPositions(r.world));
      perRoomTick.push(performance.now() - s);
    }
    allRoomsTick.push(performance.now() - frameStart);
  }
  for (const r of rooms) r.world.dispose();
  perRoomTick.sort((a, b) => a - b);
  allRoomsTick.sort((a, b) => a - b);
  const mean = perRoomTick.reduce((a, b) => a + b, 0) / perRoomTick.length;
  const budgetMs = 1000 / 30;
  return {
    rooms: roomCount,
    ticks: TICKS,
    perRoomTickMs: {
      mean: +mean.toFixed(4),
      p50: +pct(perRoomTick, 0.5).toFixed(4),
      p95: +pct(perRoomTick, 0.95).toFixed(4),
      p99: +pct(perRoomTick, 0.99).toFixed(4),
      max: +(perRoomTick.at(-1) ?? 0).toFixed(4),
    },
    allRoomsTickMs: {
      p50: +pct(allRoomsTick, 0.5).toFixed(3),
      p95: +pct(allRoomsTick, 0.95).toFixed(3),
      max: +(allRoomsTick.at(-1) ?? 0).toFixed(3),
    },
    /** Share of one CPU core consumed at 30 Hz. */
    cpuShareOfOneCore: +((pct(allRoomsTick, 0.5) * 30) / 1000).toFixed(4),
    fitsIn33msBudgetAtP95: pct(allRoomsTick, 0.95) < budgetMs,
    checksum: sink % 997,
  };
}

const results = [];
for (const n of ROOM_COUNTS) {
  const r = await run(n);
  console.log(JSON.stringify(r));
  results.push(r);
}
const out = {
  measuredAt: new Date().toISOString(),
  runtime: `node ${process.version} (offline, single thread)`,
  host: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
  },
  rapier: physicsVersion(),
  scenario: { dynamicBodies: BODIES, regions: REGIONS, ticks: TICKS, snapshotHz: 20 },
  results,
};
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../docs/benchmarks');
mkdirSync(dir, { recursive: true });
writeFileSync(
  path.join(dir, `node-sim-bench-${BODIES}b-${REGIONS}r.json`),
  JSON.stringify(out, null, 2) + '\n',
);
console.log(`saved docs/benchmarks/node-sim-bench-${BODIES}b-${REGIONS}r.json`);
