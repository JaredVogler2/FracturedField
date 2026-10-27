/** Game controller mapping on test doubles: edges, holds, triggers, D-pad and the stick curve. */
import { describe, expect, it } from 'vitest';
import { GamepadMapper, type PadState } from './gamepad';

const pad = (
  pressed: number[] = [],
  axes: number[] = [0, 0, 0, 0],
  analog: Record<number, number> = {},
): PadState => ({
  buttons: Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i) || (analog[i] ?? 0) > 0.5,
    value: analog[i] ?? (pressed.includes(i) ? 1 : 0),
  })),
  axes,
});

const actions = (m: GamepadMapper, p: PadState) =>
  m
    .update(p)
    .edges.map((e) => ('phase' in e ? `${e.action}:${e.phase}` : `${e.action}:${e.x},${e.y}`));

describe('GamepadMapper (standard layout)', () => {
  it('buttons fire once per press, not while held', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    expect(actions(m, pad([0]))).toEqual(['pulse:tap']);
    expect(actions(m, pad([0]))).toEqual([]);
    expect(actions(m, pad([]))).toEqual([]);
    expect(actions(m, pad([0, 1, 2, 3]))).toEqual([
      'pulse:tap',
      'guard:tap',
      'infuse:tap',
      'infuse:tap',
    ]);
  });

  it('LIFT follows the left trigger with hysteresis (no chatter around the threshold)', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    expect(actions(m, pad([], undefined, { 6: 0.6 }))).toEqual(['lift:start']);
    expect(actions(m, pad([], undefined, { 6: 0.45 }))).toEqual([]);
    expect(actions(m, pad([], undefined, { 6: 0.55 }))).toEqual([]);
    expect(actions(m, pad([], undefined, { 6: 0.3 }))).toEqual(['lift:end']);
  });

  it('picks follow the loadout: a tap move taps, a hold move starts and ends', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    expect(actions(m, pad([4]))).toEqual(['freeze:tap']);
    expect(actions(m, pad([4, 5]))).toEqual(['magnetize:start']);
    expect(actions(m, pad([5]))).toEqual([]);
    expect(actions(m, pad([]))).toEqual(['magnetize:end']);
  });

  it('the D-pad sweeps in screen directions; Start opens the menu', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    expect(actions(m, pad([12]))).toEqual(['sweep-screen:0,1']);
    expect(actions(m, pad([15]))).toEqual(['sweep-screen:1,0']);
    expect(m.update(pad([9])).menu).toBe(true);
  });

  it('stick: dead zone, quadratic response, y flipped to screen-up, NaN-safe', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    expect(m.update(pad([], [0.1, -0.1, 0, 0])).move).toEqual([0, 0]);
    const full = m.update(pad([], [0, -1, 0, 0])).move;
    expect(full[0]).toBeCloseTo(0, 6);
    expect(full[1]).toBeCloseTo(1, 6);
    const half = m.update(pad([], [0.5, 0, 0, 0])).move[0];
    expect(half).toBeGreaterThan(0.1);
    expect(half).toBeLessThan(0.3);
    expect(m.update(pad([], [Number.NaN, Number.NaN, 0, 0])).move).toEqual([0, 0]);
  });

  it('release() ends every hold (disconnect / pause) exactly once', () => {
    const m = new GamepadMapper(['magnetize', 'freeze']);
    m.update(pad([4], undefined, { 6: 0.9 }));
    expect(m.release().map((e) => ('phase' in e ? `${e.action}:${e.phase}` : ''))).toEqual([
      'lift:end',
      'magnetize:end',
    ]);
    expect(m.release()).toEqual([]);
  });
});
