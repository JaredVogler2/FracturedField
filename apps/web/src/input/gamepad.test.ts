/**
 * Game controller mapping on test doubles: edges, holds, triggers, D-pad and the stick curve, and
 * the hands-on hand (ADR-0009).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GamepadController, GamepadMapper, type PadState } from './gamepad';
import { SeatInput } from './manager';

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

  it('a button still held across a pause does not fire again; a new pad starts fresh', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    expect(actions(m, pad([0]))).toEqual(['pulse:tap']);
    m.release(); // pause
    expect(actions(m, pad([0]))).toEqual([]); // A never let go: no second PULSE
    m.reset(); // a different controller
    expect(actions(m, pad([0]))).toEqual(['pulse:tap']);
  });

  it('hands-on: RT is an analog grip (no PULSE), the right stick turns (x) and pushes (y)', () => {
    const m = new GamepadMapper(['freeze', 'magnetize']);
    // A trigger resting just off zero is an open hand.
    expect(m.update(pad([], undefined, { 7: 0.03 }), true).hand).toEqual({
      grip: 0,
      push: 0,
      twist: 0,
    });
    const squeeze = m.update(pad([], undefined, { 7: 0.8 }), true);
    expect(squeeze.edges).toEqual([]);
    expect(squeeze.hand!.grip).toBeCloseTo((0.8 - 0.05) / 0.95, 6);
    const turned = m.update(pad([], [0, 0, 1, 0], { 7: 1 }), true).hand!;
    expect(turned.grip).toBe(1);
    expect(turned.twist).toBeCloseTo(1, 6); // right is clockwise
    expect(turned.push).toBeCloseTo(0, 6);
    const pushed = m.update(pad([], [0, 0, 0, -1]), true).hand!; // up (pads report y down)
    expect(pushed.push).toBeCloseTo(1, 6);
    expect(pushed.grip).toBe(0);
    // The right stick no longer fine-aims; A still PULSEs.
    expect(m.update(pad([], [0, 0, 1, 0]), true).move).toEqual([0, 0]);
    expect(actions(m, pad([0]))).toEqual(['pulse:tap']);
    // Hands-on off, nothing changes: RT PULSEs and no hand is described.
    const off = new GamepadMapper(['freeze', 'magnetize']);
    const f = off.update(pad([], undefined, { 7: 0.8 }));
    expect(f.edges.map((e) => e.action)).toEqual(['pulse']);
    expect(f.hand).toBeNull();
  });
});

describe('GamepadController, hands-on', () => {
  const g = globalThis as Record<string, unknown>;
  beforeEach(() => {
    g.window = new EventTarget();
  });
  afterEach(() => {
    delete g.window;
  });

  it('a squeezed trigger takes the seat over and holds; pausing or unplugging opens the hand', () => {
    const seat = new SeatInput(0, 'pointer', () => {});
    seat.handsOn = true;
    let state = pad([], undefined, { 7: 1 });
    const device = () =>
      ({
        ...state,
        connected: true,
        mapping: 'standard',
        index: 0,
        id: 'pad',
      }) as unknown as Gamepad;
    const c = new GamepadController(seat, () => [device()]);
    c.tick(1000);
    expect(seat.source).toBe('gamepad');
    expect(seat.hand).toMatchObject({ grip: 1 });
    c.pause();
    expect(seat.hand).toBeNull();
    c.resume();
    state = pad([], undefined, { 7: 0.02 }); // resting trigger: open, and no take-over
    c.tick(1016);
    expect(seat.hand).toEqual({ grip: 0, push: 0, twist: 0 });
    c.dispose();
    expect(seat.hand).toBeNull();
  });
});
