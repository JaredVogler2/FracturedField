/** Solo keyboard rebinding: swaps on conflict, never leaves an action unbound, rejects junk. */
import { describe, expect, it } from 'vitest';
import {
  BINDING_ACTIONS,
  SOLO_BINDINGS,
  applyOverride,
  rebind,
  validBindingOverride,
} from './bindings';

describe('key rebinding', () => {
  it('a free key replaces the action’s keys', () => {
    const o = rebind(SOLO_BINDINGS, {}, 'pulse', 'KeyZ');
    expect(applyOverride(SOLO_BINDINGS, o).pulse).toEqual(['KeyZ']);
  });

  it('a key taken by another action swaps: that action gets this one’s old key', () => {
    // KeyF is GUARD by default; give it to PULSE (old primary key: Space).
    const o = rebind(SOLO_BINDINGS, {}, 'pulse', 'KeyF');
    const b = applyOverride(SOLO_BINDINGS, o);
    expect(b.pulse).toEqual(['KeyF']);
    expect(b.guard).not.toContain('KeyF');
    expect(b.guard.length).toBeGreaterThan(0);
  });

  it('every action keeps at least one key after any sequence of rebinds', () => {
    let o = {};
    const keys = ['KeyF', 'Space', 'KeyW', 'KeyQ', 'Digit1', 'KeyZ', 'KeyF', 'KeyW'];
    keys.forEach((k, i) => {
      o = rebind(SOLO_BINDINGS, o, BINDING_ACTIONS[i % BINDING_ACTIONS.length]!, k);
      const b = applyOverride(SOLO_BINDINGS, o);
      for (const a of BINDING_ACTIONS) expect(b[a].length, a).toBeGreaterThan(0);
      // No key fires two actions.
      const all = BINDING_ACTIONS.flatMap((a) => b[a]);
      expect(new Set(all).size).toBe(all.length);
    });
  });

  it('reserved and malformed keys are refused; stored data is sanitised', () => {
    expect(rebind(SOLO_BINDINGS, {}, 'pulse', 'Escape')).toEqual({});
    expect(rebind(SOLO_BINDINGS, {}, 'pulse', '<script>')).toEqual({});
    expect(
      validBindingOverride({ pulse: ['KeyZ', 7, 'KeyZ'], hack: ['KeyQ'], lift: 'ShiftLeft' }),
    ).toEqual({ pulse: ['KeyZ'] });
  });
});
