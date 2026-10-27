import { describe, expect, it } from 'vitest';
import { DEFAULT_ABILITIES, DEFAULT_RULES } from '@ff/game-data';
import { GameWorld, createWorld, Rng } from '../src/index.js';
import { IntentScript, makeIntent, skipCountdown, stepN } from '@ff/test-utils';

describe('seeded determinism', () => {
  it('Rng is reproducible and seed-sensitive', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 8 }, () => a.nextU32());
    const sb = Array.from({ length: 8 }, () => b.nextU32());
    const sc = Array.from({ length: 8 }, () => c.nextU32());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    const restored = Rng.fromState(a.state());
    expect(restored.nextU32()).toBe(a.nextU32());
  });

  async function scripted(seed: number): Promise<string> {
    const w = await GameWorld.create({ seed, autoStart: true });
    const s = new IntentScript(w);
    skipCountdown(w);
    for (let t = 0; t < 240; t++) {
      if (t % 20 === 0) s.send(0, 'aim', 'hold', { at: [-6 + (t % 7), (t % 11) - 5] });
      if (t % 45 === 10) s.send(0, 'pulse', 'tap', { at: [-3, 0] });
      if (t % 60 === 30) s.send(1, 'sweep', 'tap', { at: [6, 2], modifier: -1 });
      if (t === 90) s.send(1, 'guard', 'tap', { at: [12, 0] });
      w.stepFixed();
    }
    const h = w.stateHash();
    w.dispose();
    return h;
  }

  it('same seed + same action log => identical state hash', async () => {
    expect(await scripted(7)).toBe(await scripted(7));
  });

  it('different seeds diverge (seeded kickoff)', async () => {
    expect(await scripted(7)).not.toBe(await scripted(8));
  });
});

describe('checkpoint / restore', () => {
  it('a restored world continues bit-identically', async () => {
    const a = await GameWorld.create({ seed: 99, autoStart: true });
    const s = new IntentScript(a);
    skipCountdown(a);
    s.send(0, 'pulse', 'tap', { at: [-2, 0.5] });
    stepN(a, 20);
    const cp = a.checkpoint();
    const b = await GameWorld.restore({ seed: 99 }, cp);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let i = 0; i < 90; i++) {
      a.stepFixed();
      b.stepFixed();
    }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.snapshot()).toEqual(a.snapshot());
    a.dispose();
    b.dispose();
  });
});

describe('NaN / hostile numeric input (S04)', () => {
  it('non-finite aim and intensity never produce non-finite state', async () => {
    const w = await createWorld(5, DEFAULT_RULES, { autoStart: true });
    skipCountdown(w);
    const bad = makeIntent(0, 'pulse', 'tap', {
      aim: [Number.NaN, Number.POSITIVE_INFINITY],
      intensity: Number.NaN,
    });
    w.applyCommand(0, bad);
    w.applyCommand(0, makeIntent(1, 'aim', 'hold', { aim: [1e308, -1e308] }));
    stepN(w, 30);
    const snap = w.snapshot();
    for (const e of snap.entities) {
      for (const n of [...e.p, ...e.v, ...e.q]) expect(Number.isFinite(n)).toBe(true);
    }
    for (const p of snap.players) {
      expect(Number.isFinite(p.m[0]) && Number.isFinite(p.m[1])).toBe(true);
    }
    w.dispose();
  });
});

describe('pulse obeys impulse = m Δv', () => {
  it('full-strength pulse changes core velocity by impulse / mass toward the push direction', async () => {
    const w = await GameWorld.create({ seed: 1, autoStart: true });
    skipCountdown(w);
    stepN(w, 15); // let the kickoff shield expire
    const coreId = w.coreEntityId;
    w.debugPlaceBody(coreId, 0, DEFAULT_RULES.core.hoverHeight, 0);
    w.debugPlaceManipulator(0, -1.5, 0);
    const before = w.snapshot().entities.find((e) => e.id === coreId)!;
    w.applyCommand(0, makeIntent(1000, 'pulse', 'tap', { at: [-1.5, 0] }));
    const r = w.stepFixed();
    expect(r.results[0]?.result.accepted).toBe(true);
    const after = w.snapshot().entities.find((e) => e.id === coreId)!;
    const p = DEFAULT_ABILITIES.pulse;
    const expected = p.impulse / DEFAULT_RULES.core.mass; // intensity 1 => full strength
    const horizontalDv = after.v[0] - before.v[0];
    // Linear damping over one 1/30 s step removes ~0.6%; allow 3%.
    expect(horizontalDv).toBeGreaterThan(expected * 0.97 * Math.cos(Math.atan(p.lift)));
    expect(horizontalDv).toBeLessThan(expected * 1.01);
    expect(Math.abs(after.v[2])).toBeLessThan(0.05);
    w.dispose();
  });
});
