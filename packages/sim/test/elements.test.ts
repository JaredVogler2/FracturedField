/**
 * Phase 04 / D04 element engine: mandatory numeric, causal and robustness tests. Only fixture
 * placement is staged (bodies, force points, initial water patches); every reaction is caused by
 * real ability intents processed by the authority.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ABILITIES,
  DEFAULT_RULES,
  MERIDIAN_ARENA,
  type AbilityId,
  type GameRules,
} from '@ff/game-data';
import type { GameEvent, PlayerSlot } from '@ff/protocol';
import { IntentScript, skipCountdown, stepN } from '@ff/test-utils';
import { GameWorld, scoringPlaneX } from '../src/index.js';
import { REACTION_FIXTURES, ScenarioRun } from '../src/scenario-entry.js';
import { discharge, relaxToward, softenedPull, type Conductor } from '../src/elements.js';

const H = DEFAULT_RULES.core.hoverHeight;
const EL = DEFAULT_RULES.elements;

async function arena(
  opts: { loadouts?: [AbilityId[], AbilityId[]]; rules?: GameRules; seed?: number } = {},
) {
  const w = await GameWorld.create({
    seed: opts.seed ?? 5,
    autoStart: true,
    ...(opts.loadouts ? { loadouts: opts.loadouts } : {}),
    ...(opts.rules ? { rules: opts.rules } : {}),
  });
  skipCountdown(w);
  w.debugClearKickoffShield();
  return { w, s: new IntentScript(w) };
}

function reactions(events: readonly GameEvent[], kind?: string) {
  return events.filter(
    (e): e is Extract<GameEvent, { type: 'reaction' }> =>
      e.type === 'reaction' && (kind === undefined || e.kind === kind),
  );
}

function stepEvents(w: GameWorld, n: number): GameEvent[] {
  return stepN(w, n).flatMap((r) => [...r.events]);
}

function cast(
  w: GameWorld,
  s: IntentScript,
  slot: PlayerSlot,
  action: AbilityId,
  at: [number, number],
  extra: { modifier?: number; dir?: [number, number] } = {},
) {
  w.debugPlaceManipulator(slot, at[0], at[1]);
  return s.send(slot, action, 'tap', { at, ...extra });
}

describe('pure element helpers', () => {
  it('softened gravity is finite and zero at r = 0, capped near the centre, zero past the radius', () => {
    const g = EL.gravity;
    for (const r of [0, 1e-12, 1e-6, 1e-3]) {
      const a = softenedPull(r, 0, 0, g.strength, g.softening, g.maxAcceleration, g.radius);
      expect(Number.isFinite(a.x + a.y + a.z)).toBe(true);
      expect(Math.hypot(a.x, a.y, a.z)).toBeLessThanOrEqual(g.maxAcceleration + 1e-9);
    }
    expect(softenedPull(0, 0, 0, g.strength, g.softening, g.maxAcceleration, g.radius).x).toBe(0);
    let peak = 0;
    for (let r = 0.05; r < g.radius; r += 0.05) {
      const a = softenedPull(r, 0, 0, g.strength, g.softening, g.maxAcceleration, g.radius);
      peak = Math.max(peak, a.x);
      expect(a.x).toBeGreaterThanOrEqual(0); // always toward the source
    }
    expect(peak).toBeLessThanOrEqual(g.maxAcceleration + 1e-9);
    expect(softenedPull(g.radius + 0.01, 0, 0, g.strength, g.softening, 99, g.radius).x).toBe(0);
    expect(softenedPull(Number.NaN, 0, 0, 1, 1, 1, 10).x).toBe(0);
  });

  it('temperature relaxation converges to ambient without overshoot', () => {
    let t = -60;
    for (let i = 0; i < 3000; i++) {
      const next = relaxToward(t, 20, EL.ambientRelaxPerSecond, 1 / 30);
      expect(next).toBeGreaterThanOrEqual(t);
      expect(next).toBeLessThanOrEqual(20);
      t = next;
    }
    expect(t).toBeCloseTo(20, 1);
  });

  it('discharge traversal is deterministic and attenuates per hop', () => {
    const chain: Conductor[] = [
      { key: 'p3', x: 9, y: 0, z: 0, r: 2.2, flat: true },
      { key: 'p1', x: 2, y: 0, z: 0, r: 2.2, flat: true },
      { key: 'p2', x: 6, y: 0, z: 0, r: 2.2, flat: true },
    ];
    const a = discharge(chain, 0, 0, EL.charge, EL.pool.contactHeight);
    const b = discharge([...chain].reverse(), 0, 0, EL.charge, EL.pool.contactHeight);
    expect(a.order.map((i) => chain[i]!.key)).toEqual(['p1', 'p2', 'p3']);
    expect(b.order.map((i) => [...chain].reverse()[i]!.key)).toEqual(['p1', 'p2', 'p3']);
    const q = a.order.map((i) => a.charge[i]!);
    expect(q[0]).toBe(1);
    expect(q[1]).toBeCloseTo(EL.charge.attenuation, 9);
    expect(q[2]).toBeCloseTo(EL.charge.attenuation ** 2, 9);
    expect(discharge(chain, -30, 0, EL.charge, EL.pool.contactHeight).order).toEqual([]);
  });
});

describe('Phase 04 mandatory element tests', () => {
  it('numerical outcome: a full-strength PULSE gives the core Δv = J / m (within 2 %)', async () => {
    const { w, s } = await arena();
    w.debugPlaceBody(w.coreEntityId, 3, H, 0);
    cast(w, s, 0, 'pulse', [1.5, 0]);
    stepN(w, 1);
    const v = w.snapshot().entities.find((e) => e.kind === 'core')!.v;
    const dv = Math.hypot(v[0], v[1], v[2]);
    const expected = DEFAULT_ABILITIES.pulse.impulse / DEFAULT_RULES.core.mass;
    expect(Math.abs(dv - expected) / expected).toBeLessThan(0.02);
    w.dispose();
  });

  it('wet stone conducts while dry stone does not', async () => {
    const run = async (wet: boolean) => {
      const { w, s } = await arena();
      const boulder = w.debugEntities('boulder')[0]!;
      const lode = w.debugEntities('lodestone')[0]!;
      if (wet) {
        w.debugPlaceBody(boulder, -6, 0.75, 0);
        cast(w, s, 0, 'infuse', [-6, 0], { modifier: 0 }); // soak it (makes a pool there)
        stepN(w, 1);
      }
      // Move the stone away from the pool: only the stone links the caster to the steel, which
      // sits beyond the caster's own reach.
      w.debugPlaceBody(boulder, -12, 0.75, -8);
      w.debugPlaceBody(lode, -10.6, 0.55, -8);
      stepN(w, 30);
      const intent = cast(w, s, 0, 'charge', [-14.4, -8]);
      const r = stepN(w, 2);
      const ack = r.flatMap((x) => x.results).find((x) => x.result.seq === intent.seq)!.result;
      const out = {
        ack,
        boulderCharge: w.debugBodyElement(boulder)?.charge ?? 0,
        energized: (w.debugBodyElement(lode)?.energized ?? 0) > 0,
      };
      w.dispose();
      return out;
    };
    const dry = await run(false);
    const wet = await run(true);
    expect(dry.ack).toMatchObject({ accepted: false, reason: 'out_of_range' });
    expect(dry.energized).toBe(false);
    expect(wet.ack.accepted).toBe(true);
    expect(wet.boulderCharge).toBe(1);
    expect(wet.energized).toBe(true);
  });

  it('freezing water spawns an ice collider at the pool; heat removes it again (hysteresis)', async () => {
    const { w, s } = await arena();
    w.debugAddPool(0, -8, 4, 2.2, 0.8);
    expect(w.debugEntities('ice')).toEqual([]);
    cast(w, s, 0, 'freeze', [-8, 4]);
    const frozen = stepEvents(w, 2);
    expect(reactions(frozen, 'freeze')).toHaveLength(1);
    const [ice] = w.debugEntities('ice');
    expect(ice).toBeDefined();
    const plate = w.snapshot().entities.find((e) => e.id === ice)!;
    expect(plate.p[0]).toBeCloseTo(-8, 3);
    expect(plate.p[1]).toBeCloseTo(EL.ice.height / 2, 3);
    expect(plate.p[2]).toBeCloseTo(4, 3);
    const pool = w.snapshot().effects.find((e) => e.kind === 'pool')!;
    expect((pool.f ?? 0) & 1).toBe(1); // EFFECT_FLAG.ICE
    // Ambient warming alone must not melt it instantly (hysteresis band).
    stepN(w, 30);
    expect(w.debugEntities('ice')).toEqual([ice]);
    cast(w, s, 0, 'infuse', [-8, 4], { modifier: 1 });
    const melted = stepEvents(w, 3);
    expect(reactions(melted, 'melt')).toHaveLength(1);
    expect(w.debugEntities('ice')).toEqual([]);
    expect(w.debugRegions().pools[0]!.ice).toBe(-1);
    w.dispose();
  });

  it('rock below the fracture impulse survives; above it fractures exactly once within the shard budget', async () => {
    const hit = async (speed: number, rules?: GameRules) => {
      const { w } = await arena(rules ? { rules } : {});
      const b = w.debugEntities('boulder')[0]!;
      w.debugPlaceBody(b, -6, 0.75, 10, 0, 0, speed);
      const ev = stepEvents(w, 40);
      const out = {
        impulse: Math.max(
          0,
          ...ev
            .filter((e) => e.type === 'impact' && e.a === b)
            .map((e) => (e as { impulse: number }).impulse),
        ),
        fractures: reactions(ev, 'fracture').length,
        shards: w.debugEntities('shard').length,
        entities: w.counters.entities,
      };
      w.dispose();
      return out;
    };
    const below = await hit(5);
    const above = await hit(9);
    const threshold = 160; // MATERIALS.basaltFractured.fractureImpulse
    expect(below.impulse).toBeLessThan(threshold);
    expect(below.fractures).toBe(0);
    expect(above.impulse).toBeGreaterThanOrEqual(threshold);
    expect(above.fractures).toBe(1);
    expect(above.shards).toBe(EL.fracture.maxShards);
    expect(above.entities).toBeLessThanOrEqual(DEFAULT_RULES.limits.maxDynamicBodies);
    // With the body budget nearly exhausted, fewer physical shards spawn (rest is cosmetic).
    const tight: GameRules = {
      ...DEFAULT_RULES,
      limits: { ...DEFAULT_RULES.limits, maxDynamicBodies: 6 },
    };
    const capped = await hit(9, tight);
    expect(capped.fractures).toBe(1);
    expect(capped.shards).toBeLessThan(EL.fracture.maxShards);
    expect(capped.entities).toBeLessThanOrEqual(6);
  });

  it('gravity well at r ≈ 0 stays finite and never pushes bodies past the legal speed caps', async () => {
    const { w, s } = await arena({
      loadouts: [
        ['gravity', 'charge'],
        ['gravity', 'charge'],
      ],
    });
    w.debugPlaceBody(w.coreEntityId, -4, EL.gravity.height, 0);
    cast(w, s, 0, 'gravity', [-4, 0]); // well exactly at the core
    w.debugPlaceBody(w.coreEntityId, -4, EL.gravity.height, 0);
    const lim = DEFAULT_RULES.limits;
    for (let i = 0; i < 60; i++) {
      w.stepFixed();
      for (const e of w.snapshot().entities) {
        expect(Number.isFinite(e.p[0] + e.p[1] + e.p[2] + e.v[0] + e.v[1] + e.v[2])).toBe(true);
        const speed = Math.hypot(...e.v);
        expect(speed).toBeLessThanOrEqual(
          (e.kind === 'core' ? lim.maxCoreSpeed : lim.maxBodySpeed) + 0.01,
        );
      }
    }
    // A fast core flying straight through a fresh well is bent but stays capped.
    stepN(w, 200);
    cast(w, s, 1, 'gravity', [3, 0]);
    stepN(w, 10);
    w.debugPlaceBody(w.coreEntityId, -2, H, 0.3, 27, 0, 0);
    for (let i = 0; i < 40; i++) {
      w.stepFixed();
      const c = w.snapshot().entities.find((e) => e.kind === 'core')!;
      expect(Math.hypot(...c.v)).toBeLessThanOrEqual(lim.maxCoreSpeed + 0.01);
    }
    w.dispose();
  });

  it('canonical reaction events fire exactly once, even when both players repeat the cause on consecutive ticks', async () => {
    const { w, s } = await arena();
    w.debugAddPool(0, -1.5, 3, 2.6, 0.9);
    cast(w, s, 0, 'freeze', [-1.5, 3]);
    const e1 = stepEvents(w, 1);
    cast(w, s, 1, 'freeze', [-1.5, 3]); // same pool, next tick
    const e2 = stepEvents(w, 30);
    const freezes = reactions([...e1, ...e2], 'freeze');
    expect(freezes).toHaveLength(1);
    const ids = new Set([...e1, ...e2].map((e) => e.id));
    expect(ids.size).toBe(e1.length + e2.length); // ids unique
    cast(w, s, 0, 'infuse', [-1.5, 3], { modifier: 1 });
    const e3 = stepEvents(w, 1);
    cast(w, s, 1, 'infuse', [-1.5, 3], { modifier: 1 });
    const e4 = stepEvents(w, 40);
    expect(reactions([...e3, ...e4], 'melt')).toHaveLength(1);
    // Heating the meltwater further boils it exactly once.
    expect(reactions([...e3, ...e4], 'boil').length).toBeLessThanOrEqual(1);
    w.dispose();
  });

  it('same seed + same action log gives identical state hashes and events', async () => {
    const run = async () => {
      const { w, s } = await arena({
        seed: 77,
        loadouts: [
          ['freeze', 'charge'],
          ['gravity', 'magnetize'],
        ],
      });
      const log: string[] = [];
      w.debugAddPool(1, 6, 3, 2.4, 0.9);
      const plan: [number, PlayerSlot, AbilityId, [number, number], number?][] = [
        [0, 0, 'infuse', [0, 3], 0],
        [5, 1, 'gravity', [5, -2]],
        [20, 0, 'charge', [1.5, 3]],
        [40, 1, 'magnetize', [2, 9]],
        [45, 0, 'freeze', [0, 3]],
        [80, 0, 'infuse', [0, 3], 1],
        [90, 1, 'infuse', [6, 3], 1],
        [120, 0, 'pulse', [-1, 1]],
      ];
      for (let t = 0; t < 180; t++) {
        for (const [at, slot, action, pos, mod] of plan) {
          if (at !== t) continue;
          w.debugPlaceManipulator(slot, pos[0], pos[1]);
          s.send(slot, action, action === 'magnetize' ? 'start' : 'tap', {
            at: pos,
            ...(mod !== undefined ? { modifier: mod } : {}),
          });
        }
        const r = w.stepFixed();
        for (const e of r.events) log.push(JSON.stringify(e));
      }
      const out = { hash: w.stateHash(), log };
      w.dispose();
      return out;
    };
    const a = await run();
    const b = await run();
    expect(a.log.some((l) => l.includes('"reaction"'))).toBe(true);
    expect(b.hash).toBe(a.hash);
    expect(b.log).toEqual(a.log);
  });

  it('1,000 seeded random action sequences keep transforms finite and counts bounded', async () => {
    const abilities: AbilityId[] = [
      'pulse',
      'lift',
      'sweep',
      'guard',
      'infuse',
      'freeze',
      'charge',
      'gravity',
      'magnetize',
    ];
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const lim = DEFAULT_RULES.limits;
    let sequences = 0;
    let reactionCount = 0;
    let goals = 0;
    const plane = scoringPlaneX(MERIDIAN_ARENA, DEFAULT_RULES.core);
    for (let world = 0; world < 50; world++) {
      const { w, s } = await arena({
        seed: world + 1,
        loadouts: [
          ['freeze', 'charge'],
          ['gravity', 'magnetize'],
        ],
      });
      for (let seq = 0; seq < 20; seq++, sequences++) {
        for (let t = 0; t < 24; t++) {
          if (rnd() < 0.35) {
            const slot: PlayerSlot = rnd() < 0.5 ? 0 : 1;
            const action = abilities[Math.floor(rnd() * abilities.length)]!;
            const x = (rnd() * 2 - 1) * 20;
            const z = (rnd() * 2 - 1) * 12;
            const kind = DEFAULT_ABILITIES[action].kind;
            s.send(slot, action, kind === 'hold' ? (rnd() < 0.6 ? 'start' : 'end') : 'tap', {
              at: [x, z],
              modifier: Math.floor(rnd() * 3) - 1,
              ...(rnd() < 0.3 ? { dir: [rnd() * 2 - 1, rnd() * 2 - 1] as [number, number] } : {}),
            });
          } else if (rnd() < 0.5) {
            s.send(rnd() < 0.5 ? 0 : 1, 'aim', 'hold', {
              at: [(rnd() * 2 - 1) * 20, (rnd() * 2 - 1) * 12],
            });
          }
          const r = w.stepFixed();
          reactionCount += reactions(r.events).length;
          // Reactions never create scoring triggers: a goal is only ever the core centre past
          // the scoring plane inside the goal mouth.
          for (const e of r.events) {
            if (e.type !== 'goal') continue;
            goals++;
            expect(Math.abs(e.p[0])).toBeGreaterThanOrEqual(plane - 1e-3);
            expect(Math.abs(e.p[2])).toBeLessThan(w.arena.goal.mouthHalfWidth);
            expect(e.p[1]).toBeLessThan(w.arena.goal.mouthHeight);
          }
          const snap = w.snapshot();
          expect(snap.entities.length).toBeLessThanOrEqual(lim.maxDynamicBodies);
          expect(w.counters.effects).toBeLessThanOrEqual(lim.maxActiveEffects);
          expect(w.counters.regions).toBeLessThanOrEqual(EL.maxPools + EL.maxSteams + EL.maxFlames);
          for (const e of snap.entities) {
            if (!Number.isFinite(e.p[0] + e.p[1] + e.p[2] + e.v[0] + e.v[1] + e.v[2]))
              expect.fail(`non-finite entity ${e.kind} in world ${world}`);
          }
          for (const p of snap.players) {
            expect(p.energy).toBeGreaterThanOrEqual(0);
            expect(p.energy).toBeLessThanOrEqual(DEFAULT_RULES.energy.max);
          }
        }
      }
      w.dispose();
    }
    expect(sequences).toBe(1000);
    expect(reactionCount).toBeGreaterThan(100);
    expect(goals).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('steam veils are bounded and counterable: the core stays replicated and the veil expires', async () => {
    const fx = REACTION_FIXTURES.find((f) => f.id === 'R3')!;
    const run = await ScenarioRun.create(fx, 'reaction');
    const maxVeil = Math.ceil(EL.steam.lifetimeSeconds * DEFAULT_RULES.match.tickRate) + 1;
    let streak = 0;
    let longest = 0;
    let veiledTicks = 0;
    try {
      while (!run.done) {
        const { snapshot } = run.step();
        const core = snapshot.entities.find((e) => e.kind === 'core');
        // The core is never removed from what both players receive, only its aim read is withheld.
        expect(core).toBeDefined();
        expect(Number.isFinite(core!.p[0] + core!.p[1] + core!.p[2])).toBe(true);
        expect(snapshot.effects.filter((e) => e.kind === 'steam').length).toBeLessThanOrEqual(
          EL.maxSteams,
        );
        if (core!.veil) {
          veiledTicks++;
          streak++;
          longest = Math.max(longest, streak);
        } else streak = 0;
      }
    } finally {
      run.dispose();
    }
    expect(veiledTicks).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(maxVeil);
  });

  it('advanced moves outside a seat’s loadout are refused', async () => {
    const { w, s } = await arena({
      loadouts: [
        ['freeze', 'charge'],
        ['gravity', 'magnetize'],
      ],
    });
    const i1 = cast(w, s, 0, 'gravity', [-5, 0]);
    const i2 = cast(w, s, 1, 'freeze', [5, 0]);
    const results = stepN(w, 1).flatMap((r) => r.results);
    expect(results.find((r) => r.slot === 0 && r.result.seq === i1.seq)?.result).toMatchObject({
      accepted: false,
      reason: 'not_available',
    });
    expect(results.find((r) => r.slot === 1 && r.result.seq === i2.seq)?.result).toMatchObject({
      accepted: false,
      reason: 'not_available',
    });
    expect(w.setLoadout(0, ['gravity', 'gravity'])).toBe(false);
    w.dispose();
  });

  it('checkpoint/restore preserves element regions and body states exactly', async () => {
    const { w, s } = await arena();
    w.debugAddPool(0, -6, 0, 2.4, 0.9);
    cast(w, s, 0, 'freeze', [-6, 0]);
    stepN(w, 3);
    cast(w, s, 0, 'infuse', [-9, 5], { modifier: 1 });
    stepN(w, 5);
    const cp = w.checkpoint();
    const r = await GameWorld.restore({ seed: 5 }, cp);
    expect(r.stateHash()).toBe(w.stateHash());
    stepN(w, 60);
    stepN(r, 60);
    expect(r.stateHash()).toBe(w.stateHash());
    expect(r.debugRegions()).toEqual(w.debugRegions());
    w.dispose();
    r.dispose();
  });
});
