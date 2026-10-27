/**
 * D04 regression fixtures: every element reaction must change a scoring trajectory, proven by a
 * control/reaction pair that differ only in the reaction's cause. Fixtures live in
 * test/fixtures/reactions/*.json (seed, staged bodies and initial water patches, per-tick intents,
 * expectations). Final state hashes are pinned in test/fixtures/golden.json; regenerate with
 * UPDATE_GOLDEN=1 after an intentional SIM_VERSION change.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type AbilityId } from '@ff/game-data';
import type { GameEvent, IntentAction, IntentPhase, PlayerSlot } from '@ff/protocol';
import { IntentScript, skipCountdown } from '@ff/test-utils';
import { GameWorld } from '../src/index.js';

// The sim package compiles without Node typings; declare the few globals this runner needs.
declare const console: { log(...args: unknown[]): void; table(data: unknown): void };
declare const process: { env: Record<string, string | undefined> };

interface FsLike {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: 'utf8'): string;
  writeFileSync(p: string, data: string): void;
  existsSync(p: string): boolean;
}
// Non-literal specifier: resolved at runtime by Node, no Node typings needed at compile time.
const nodeFs = 'node:fs';
const fs = (await import(/* @vite-ignore */ nodeFs)) as FsLike;
// Relative to the repository root, where vitest runs.
const DIR = 'packages/sim/test/fixtures';

type Vec3T = [number, number, number];
type Step =
  | { t: number; place: string; p: Vec3T; v?: Vec3T }
  | {
      t: number;
      slot: PlayerSlot;
      act: IntentAction;
      phase?: IntentPhase;
      at: [number, number];
      modifier?: number;
      dir?: [number, number];
    };

interface Expectation {
  /** Exact first scorer (null = no goal within the run). */
  goal?: PlayerSlot | null;
  /** This slot must NOT score. */
  notGoal?: PlayerSlot;
  /** Exact counts of reaction kinds over the run. */
  reactions?: Record<string, number>;
  maxCoreHeight?: { atLeast?: number; atMost?: number };
  coreVeiled?: boolean;
}

interface Variant {
  pools?: { owner: PlayerSlot; x: number; z: number; r: number; depth: number; temp?: number }[];
  script?: Step[];
  expect: Expectation;
}

interface Fixture {
  id: string;
  title: string;
  seed: number;
  ticks: number;
  loadouts?: [AbilityId[], AbilityId[]];
  script: Step[];
  variants: { control: Variant; reaction: Variant };
}

interface Outcome {
  goal: PlayerSlot | null;
  goalTick: number | null;
  reactions: Record<string, number>;
  maxCoreHeight: number;
  coreVeiled: boolean;
  hash: string;
}

async function runVariant(fx: Fixture, v: Variant): Promise<Outcome> {
  const w = await GameWorld.create({
    seed: fx.seed,
    autoStart: true,
    ...(fx.loadouts ? { loadouts: fx.loadouts } : {}),
  });
  skipCountdown(w);
  w.debugClearKickoffShield();
  const s = new IntentScript(w);
  for (const p of v.pools ?? []) w.debugAddPool(p.owner, p.x, p.z, p.r, p.depth, p.temp);
  const steps = [...fx.script, ...(v.script ?? [])].sort((a, b) => a.t - b.t);
  const out: Outcome = {
    goal: null,
    goalTick: null,
    reactions: {},
    maxCoreHeight: 0,
    coreVeiled: false,
    hash: '',
  };
  const entityFor = (ref: string): number => {
    if (ref === 'core') return w.coreEntityId;
    const [kind, index] = ref.split(':');
    const id = w.debugEntities(kind!)[Number(index ?? 0)];
    if (id === undefined) throw new Error(`fixture ${fx.id}: no ${ref}`);
    return id;
  };
  for (let t = 0; t < fx.ticks; t++) {
    for (const st of steps) {
      if (st.t !== t) continue;
      if ('place' in st) {
        const v3 = st.v ?? [0, 0, 0];
        w.debugPlaceBody(entityFor(st.place), st.p[0], st.p[1], st.p[2], v3[0], v3[1], v3[2]);
      } else {
        w.debugPlaceManipulator(st.slot, st.at[0], st.at[1]);
        s.send(st.slot, st.act, st.phase ?? 'tap', {
          at: st.at,
          ...(st.modifier !== undefined ? { modifier: st.modifier } : {}),
          ...(st.dir ? { dir: st.dir } : {}),
        });
      }
    }
    const r = w.stepFixed();
    for (const e of r.events as GameEvent[]) {
      if (e.type === 'reaction') out.reactions[e.kind] = (out.reactions[e.kind] ?? 0) + 1;
      if (e.type === 'goal' && out.goal === null) {
        out.goal = e.scorer;
        out.goalTick = t;
      }
    }
    const core = w.snapshot().entities.find((e) => e.kind === 'core');
    if (core) {
      out.maxCoreHeight = Math.max(out.maxCoreHeight, core.p[1]);
      if (core.veil) out.coreVeiled = true;
    }
    if (out.goal !== null) break;
  }
  out.hash = w.stateHash();
  w.dispose();
  return out;
}

function check(fx: Fixture, name: string, e: Expectation, o: Outcome): void {
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

const files = fs
  .readdirSync(`${DIR}/reactions`)
  .filter((f) => f.endsWith('.json'))
  .sort();
const fixtures = files.map(
  (f) => JSON.parse(fs.readFileSync(`${DIR}/reactions/${f}`, 'utf8')) as Fixture,
);
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

  for (const fx of fixtures) {
    it(`${fx.id}: ${fx.title}`, async () => {
      const control = await runVariant(fx, fx.variants.control);
      const reaction = await runVariant(fx, fx.variants.reaction);
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
