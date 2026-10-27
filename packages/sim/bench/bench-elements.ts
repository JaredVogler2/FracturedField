/**
 * Offline Node benchmark (D04): per-tick cost of the shared simulation under worst-case element
 * load on the 20-dynamic-body bench arena, in two scenarios:
 *  - `rules`: ElementStress with the real cooldowns (the most two players can legally sustain);
 *  - `saturated`: cooldowns and lockouts removed, so pools, steam, flames, shards and bodies sit
 *    at their caps (beyond anything reachable in play — a safety margin for the cap values).
 * Reports step and snapshot-encode cost plus the load actually reached, so the numbers can be
 * checked against the caps. Single Node thread on this machine — NOT a Worker or device result.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ABILITIES, DEFAULT_RULES, type AbilityTable } from '@ff/game-data';
import { encodeMessage } from '@ff/protocol';
import {
  ELEMENT_STRESS_LOADOUTS,
  ElementStress,
  GameWorld,
  makeBenchArena,
  physicsVersion,
  saturatedAbilities,
} from '../src/index.js';

const BODIES = Number(process.env.BENCH_BODIES ?? 20);
const TICKS = Number(process.env.BENCH_TICKS ?? 3600); // 120 s of game time at 30 Hz
const WARMUP = 150;
const BUDGET_MS = 1000 / DEFAULT_RULES.match.tickRate;

function pct(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  return {
    mean: +mean.toFixed(4),
    p50: +pct(sorted, 0.5).toFixed(4),
    p95: +pct(sorted, 0.95).toFixed(4),
    p99: +pct(sorted, 0.99).toFixed(4),
    max: +(sorted.at(-1) ?? 0).toFixed(4),
  };
}

const avg = (a: number[]) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(2);

async function run(
  name: string,
  abilities: AbilityTable,
  opts: ConstructorParameters<typeof ElementStress>[1],
) {
  const world = await GameWorld.create({
    seed: 4242,
    arena: makeBenchArena(BODIES),
    abilities,
    autoStart: true,
    loadouts: ELEMENT_STRESS_LOADOUTS,
  });
  const stress = new ElementStress(19, opts);
  const step: number[] = [];
  const snap: number[] = [];
  const bytes: number[] = [];
  const load = { pools: [] as number[], steams: [] as number[], flames: [] as number[] };
  const peak = { entities: 0, effects: 0, elementBodies: 0, shards: 0, wells: 0 };
  const reactions: Record<string, number> = {};
  const phases: Record<string, number> = {};
  let accepted = 0;
  let refused = 0;
  let snapDebt = 0;
  for (let t = 0; t < TICKS + WARMUP; t++) {
    stress.drive(world);
    const s0 = performance.now();
    const r = world.stepFixed();
    const s1 = performance.now();
    snapDebt += DEFAULT_RULES.match.snapshotRate / DEFAULT_RULES.match.tickRate;
    let encodeMs = 0;
    if (snapDebt >= 1) {
      snapDebt -= 1;
      const e0 = performance.now();
      const text = encodeMessage({ t: 'snap', s: world.snapshot(), st: 0 });
      encodeMs = performance.now() - e0;
      if (t >= WARMUP) bytes.push(text.length);
    }
    if (t < WARMUP) continue;
    step.push(s1 - s0);
    if (encodeMs > 0) snap.push(encodeMs);
    phases[world.phase] = (phases[world.phase] ?? 0) + 1;
    for (const e of r.events)
      if (e.type === 'reaction') reactions[e.kind] = (reactions[e.kind] ?? 0) + 1;
    for (const res of r.results) {
      if (res.result.accepted) accepted++;
      else refused++;
    }
    if (t % 10 === 0) {
      const reg = world.debugRegions();
      load.pools.push(reg.pools.length);
      load.steams.push(reg.steams.length);
      load.flames.push(reg.flames.length);
      const c = world.counters;
      peak.entities = Math.max(peak.entities, c.entities);
      peak.effects = Math.max(peak.effects, c.effects);
      peak.elementBodies = Math.max(peak.elementBodies, c.elementBodies);
      peak.shards = Math.max(peak.shards, world.debugEntities('shard').length);
      const wells = world.snapshot().effects.filter((e) => e.kind === 'well').length;
      peak.wells = Math.max(peak.wells, wells);
    }
  }
  world.dispose();
  const stepMs = stats(step);
  return {
    scenario: name,
    stepMs,
    snapshotEncodeMs: stats(snap),
    snapshotBytes: { mean: Math.round(avg(bytes)), max: Math.max(0, ...bytes) },
    loadReached: {
      meanPools: avg(load.pools),
      meanSteams: avg(load.steams),
      meanFlames: avg(load.flames),
      maxPools: Math.max(0, ...load.pools),
      maxSteams: Math.max(0, ...load.steams),
      maxFlames: Math.max(0, ...load.flames),
      ...peak,
    },
    intents: { accepted, refused },
    /** Ticks per match phase (casts are only legal while playing). */
    phases,
    reactions,
    /** p99 step cost as a share of the 33.3 ms tick budget. */
    p99ShareOfTickBudget: +(stepMs.p99 / BUDGET_MS).toFixed(4),
  };
}

const el = DEFAULT_RULES.elements;
const results = [
  await run('rules (real cooldowns)', DEFAULT_ABILITIES, { infuseEvery: 25 }),
  await run(
    'saturated (no cooldowns, staged pools: caps reached)',
    saturatedAbilities(DEFAULT_ABILITIES),
    {
      infuseEvery: 3,
      pace: 0.25,
      fillPools: true,
    },
  ),
];
const out = {
  measuredAt: new Date().toISOString(),
  runtime: `node ${process.version} (offline, single thread) — NOT a Worker or device measurement`,
  host: {
    platform: os.platform(),
    arch: os.arch(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
  },
  rapier: physicsVersion(),
  setup: {
    driver: 'ElementStress (both seats, overlapping element casts + periodic boulder slams)',
    dynamicBodiesInArena: BODIES,
    ticksMeasured: TICKS,
    warmupTicks: WARMUP,
    loadouts: ELEMENT_STRESS_LOADOUTS,
    caps: {
      pools: el.maxPools,
      steams: el.maxSteams,
      flames: el.maxFlames,
      shardsPerFracture: el.fracture.maxShards,
      dynamicBodies: DEFAULT_RULES.limits.maxDynamicBodies,
      effects: DEFAULT_RULES.limits.maxActiveEffects,
    },
  },
  results,
};
console.log(JSON.stringify(out, null, 2));
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../docs/benchmarks');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'node-elements-worst-case.json'), JSON.stringify(out, null, 2) + '\n');
console.log('saved docs/benchmarks/node-elements-worst-case.json');
