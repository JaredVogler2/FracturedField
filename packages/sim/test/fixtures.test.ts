/**
 * D04 regression fixtures: every element reaction must change a scoring trajectory, proven by a
 * control/reaction pair that differ only in the reaction's cause. Fixtures are JSON documents in
 * packages/sim/fixtures/reactions (seed, staged bodies and initial water patches, per-tick
 * intents, expectations), run by the same ScenarioRun the Physics Lab uses. Final state hashes are
 * pinned in test/fixtures/golden.json; regenerate with UPDATE_GOLDEN=1 after an intentional
 * SIM_VERSION change.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@ff/game-data';
import {
  REACTION_FIXTURES,
  ScenarioRun,
  parseScenarioFixture,
  type ScenarioExpectation,
  type ScenarioFixture,
  type ScenarioOutcome,
  type VariantName,
} from '../src/scenario-entry.js';

// The sim package compiles without Node typings; declare the few globals this runner needs.
declare const console: { log(...args: unknown[]): void; table(data: unknown): void };
declare const process: { env: Record<string, string | undefined> };

interface FsLike {
  readFileSync(p: string, enc: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
  existsSync(p: string): boolean;
}
// Non-literal specifier: resolved at runtime by Node, no Node typings needed at compile time.
const nodeFs = 'node:fs';
const fs = (await import(/* @vite-ignore */ nodeFs)) as FsLike;
// Relative to the repository root, where vitest runs.
const DIR = 'packages/sim/test/fixtures';

type Outcome = ScenarioOutcome & { readonly hash: string };

async function runVariant(fx: ScenarioFixture, name: VariantName): Promise<Outcome> {
  const run = await ScenarioRun.create(fx, name);
  try {
    return run.runToEnd();
  } finally {
    run.dispose();
  }
}

function check(fx: ScenarioFixture, name: string, e: ScenarioExpectation, o: Outcome): void {
  const where = `${fx.id} ${name}`;
  if (e.goal !== undefined) expect(o.goal, `${where}: goal`).toBe(e.goal);
  if (e.notGoal !== undefined) expect(o.goal, `${where}: must not score`).not.toBe(e.notGoal);
  for (const [k, n] of Object.entries(e.reactions ?? {}))
    expect(o.reactions[k] ?? 0, `${where}: reaction ${k}`).toBe(n);
  if (e.maxCoreHeight?.atLeast !== undefined)
    expect(o.maxCoreHeight, `${where}: max core height`).toBeGreaterThanOrEqual(
      e.maxCoreHeight.atLeast,
    );
  if (e.maxCoreHeight?.atMost !== undefined)
    expect(o.maxCoreHeight, `${where}: max core height`).toBeLessThanOrEqual(
      e.maxCoreHeight.atMost,
    );
  if (e.coreVeiled !== undefined) expect(o.coreVeiled, `${where}: veil`).toBe(e.coreVeiled);
}

const fixtures = REACTION_FIXTURES;
const goldenPath = `${DIR}/golden.json`;
const golden: Record<string, string> = fs.existsSync(goldenPath)
  ? (JSON.parse(fs.readFileSync(goldenPath, 'utf8')) as Record<string, string>)
  : {};
const update = process.env.UPDATE_GOLDEN === '1';
const fresh: Record<string, string> = {};
const table: Record<string, string>[] = [];

afterAll(() => {
  if (update) fs.writeFileSync(goldenPath, `${JSON.stringify(fresh, null, 2)}\n`);
  console.log('\nD04 reaction fixtures (control vs reaction):');
  console.table(table);
});

describe('D04 reaction fixtures: each reaction changes a scoring trajectory', () => {
  it('has a fixture for every reaction R1–R10', () => {
    expect(fixtures.map((f) => f.id).sort()).toEqual(
      ['R1', 'R10', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9'].sort(),
    );
    expect(DEFAULT_RULES.elements.boilTemp).toBeGreaterThan(DEFAULT_RULES.elements.meltTemp);
  });

  it('rejects malformed fixture documents', () => {
    expect(() => parseScenarioFixture({ id: 'X', title: 't', seed: 1 })).toThrow();
    expect(() =>
      parseScenarioFixture({
        id: 'X',
        title: 't',
        seed: 1,
        ticks: 10,
        script: [{ t: 0, slot: 2, act: 'pulse', at: [0, 0] }],
        variants: { control: { expect: {} }, reaction: { expect: {} } },
      }),
    ).toThrow(/bad action/);
  });

  it('rewinding to a mark replays the identical ticks (Lab rewind is deterministic)', async () => {
    const fx = fixtures.find((f) => f.id === 'R5')!;
    const run = await ScenarioRun.create(fx, 'reaction');
    try {
      for (let i = 0; i < 40; i++) run.step();
      const mark = run.mark();
      const hashes: string[] = [];
      for (let i = 0; i < 60 && !run.done; i++) {
        run.step();
        hashes.push(run.world.stateHash());
      }
      await run.rewind(mark);
      expect(run.t).toBe(40);
      const replay: string[] = [];
      for (let i = 0; i < hashes.length; i++) {
        run.step();
        replay.push(run.world.stateHash());
      }
      expect(replay).toEqual(hashes);
    } finally {
      run.dispose();
    }
  });

  it('the Lab can hold a seat’s hand: it reaches the snapshot each tick and the script still runs', async () => {
    const fx = fixtures.find((f) => f.id === 'R4')!;
    const run = await ScenarioRun.create(fx, 'reaction');
    try {
      while (run.t < 12) run.step();
      run.setHand(0, { grip: 0, push: 0.6, twist: 0 });
      const { result, snapshot } = run.step(); // t12: the script's pulse from seat 0
      expect(snapshot.players[0].hand).toEqual({ grip: 0, push: 0.6, twist: 0 });
      expect(snapshot.players[1].hand).toBeUndefined();
      expect(result.events.some((e) => e.type === 'cast' && e.slot === 0)).toBe(true);
      // Its aim is left where the script put it.
      expect(snapshot.players[0].m[0]).toBeCloseTo(1.4, 1);
      run.setHand(0, null);
      const stale = Math.ceil(DEFAULT_RULES.hand.staleSeconds * DEFAULT_RULES.match.tickRate);
      for (let i = 0; i <= stale + 1; i++) run.step();
      expect(run.world.snapshot().players[0].hand).toBeUndefined();
    } finally {
      run.dispose();
    }
  });

  for (const fx of fixtures) {
    it(`${fx.id}: ${fx.title}`, async () => {
      const control = await runVariant(fx, 'control');
      const reaction = await runVariant(fx, 'reaction');
      check(fx, 'control', fx.variants.control.expect, control);
      check(fx, 'reaction', fx.variants.reaction.expect, reaction);
      // The pair must differ in outcome, not just in decoration.
      const differs =
        control.goal !== reaction.goal ||
        Math.abs(control.maxCoreHeight - reaction.maxCoreHeight) > 1;
      expect(differs, `${fx.id}: control and reaction outcomes are identical`).toBe(true);
      for (const [name, o] of [
        ['control', control],
        ['reaction', reaction],
      ] as const) {
        const key = `${fx.id}/${name}`;
        fresh[key] = o.hash;
        if (!update && golden[key] !== undefined)
          expect(o.hash, `${key}: golden hash`).toBe(golden[key]);
      }
      const fmt = (o: Outcome) =>
        `${o.goal === null ? 'no goal' : `GOAL ${o.goal} @${o.goalTick}`} · peak ${o.maxCoreHeight.toFixed(1)} m`;
      table.push({
        id: fx.id,
        title: fx.title,
        control: fmt(control),
        reaction: fmt(reaction),
        reactions: Object.entries(reaction.reactions)
          .map(([k, n]) => `${k}×${n}`)
          .join(' '),
      });
    });
  }
});
