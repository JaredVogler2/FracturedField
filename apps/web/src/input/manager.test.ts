/**
 * InputManager hot-swap invariants (D06): a mode change releases held abilities first, keeps the
 * seat's sequence space (the authority would drop restarted sequence numbers as stale), and from
 * then on every intent carries the new mode's source. A minimal event-target DOM stands in for
 * the browser: the manager only adds and removes listeners on window, document and the canvas.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionIntent, WorldSnapshot } from '@ff/protocol';
import { SOLO_BINDINGS } from './bindings';
import { InputManager } from './manager';
import type { ControlMode } from './capabilities';

const g = globalThis as Record<string, unknown>;

beforeEach(() => {
  g.window = Object.assign(new EventTarget(), { isSecureContext: true });
  g.document = Object.assign(new EventTarget(), { hidden: false });
});

afterEach(() => {
  delete g.window;
  delete g.document;
});

function rig(mode: ControlMode) {
  const sent: ActionIntent[] = [];
  const canvas = new EventTarget() as unknown as HTMLElement;
  const m = new InputManager(
    [{ slot: 0, bindings: SOLO_BINDINGS, pointer: false, mode }],
    canvas,
    (_slot, intent) => sent.push(intent),
  );
  const last = () => sent[sent.length - 1]!;
  return { m, sent, last };
}

describe('InputManager control modes', () => {
  it('a manager created in a mode aims under that source from its very first intent', () => {
    for (const [mode, source] of [
      ['touch', 'touch'],
      ['motion', 'gyro'],
      ['desktop', 'keyboard'],
      ['camera', 'camera'],
      ['accessible', 'touch'],
    ] as const) {
      const { m, sent } = rig(mode);
      m.update(null); // the first aim keep-alive
      expect(sent.map((i) => [i.action, i.source])).toEqual([['aim', source]]);
      m.dispose();
    }
  });

  it('an ability intent names the device that pressed it; aim keeps naming the aim owner', () => {
    const { m, sent, last } = rig('motion');
    m.action(0, { action: 'pulse', phase: 'tap' }); // a thumb button while the phone aims
    expect(last()).toMatchObject({ action: 'pulse', source: 'touch' });
    m.update(null);
    expect(last()).toMatchObject({ action: 'aim', source: 'gyro' });
    expect(sent).toHaveLength(2);
    m.dispose();
  });

  it('swapping mid-hold releases the hold, then continues the same sequence', () => {
    const { m, sent, last } = rig('touch');
    m.action(0, { action: 'lift', phase: 'start' });
    expect(last()).toMatchObject({ action: 'lift', phase: 'start', source: 'touch', seq: 0 });
    m.setMode(0, 'desktop');
    expect(last()).toMatchObject({ action: 'lift', phase: 'end', seq: 1 });
    expect(m.mode(0)).toBe('desktop');
    m.update(null);
    expect(last()).toMatchObject({ action: 'aim', source: 'keyboard', seq: 2 });
    // A late release from the old input sends nothing: the hold is already over.
    m.action(0, { action: 'lift', phase: 'end' });
    expect(sent).toHaveLength(3);
    m.setMode(0, 'accessible');
    m.action(0, { action: 'guard', phase: 'tap' });
    expect(last()).toMatchObject({ action: 'guard', source: 'touch', seq: 3 });
    m.dispose();
  });

  it('only motion mode has a motion adapter, and setting the same mode again is a no-op', () => {
    const { m, sent } = rig('touch');
    expect(m.motion(0)).toBeUndefined();
    m.setMode(0, 'motion');
    expect(m.motion(0)).toBeDefined();
    const adapter = m.motion(0);
    m.setMode(0, 'motion');
    expect(m.motion(0)).toBe(adapter);
    m.setMode(0, 'touch');
    expect(m.motion(0)).toBeUndefined();
    expect(sent).toHaveLength(0);
    m.dispose();
  });

  it('a touch whose pointer can no longer be captured (it already ended) still aims', async () => {
    const { view } = await import('../render/view');
    const project = vi
      .spyOn(view, 'screenToArena')
      .mockImplementation((x: number, y: number) => ({ x: -20 + x / 10, z: -12 + y / 10 }));
    const canvas = Object.assign(new EventTarget(), {
      setPointerCapture: () => {
        throw new Error('NotFoundError: no active pointer with the given id');
      },
    }) as unknown as HTMLElement;
    const m = new InputManager(
      [{ slot: 0, bindings: SOLO_BINDINGS, pointer: false, mode: 'touch' }],
      canvas,
      () => {},
    );
    canvas.dispatchEvent(
      Object.assign(new Event('pointerdown'), {
        pointerId: 9,
        pointerType: 'touch',
        clientX: 140,
        clientY: 120,
      }),
    );
    expect(m.seat(0)!.reticle).toMatchObject({ x: -6, z: 0, initialised: true });
    m.dispose();
    project.mockRestore();
  });

  it('hiding the tab releases holds', () => {
    const { m, last } = rig('touch');
    m.action(0, { action: 'lift', phase: 'start' });
    (g.document as { hidden: boolean }).hidden = true;
    (g.document as EventTarget).dispatchEvent(new Event('visibilitychange'));
    expect(last()).toMatchObject({ action: 'lift', phase: 'end' });
    m.dispose();
  });
});

describe('hands-on control (ADR-0009)', () => {
  /** A controllable clock and a fixed screen → arena mapping (no WebGL camera in unit tests). */
  async function handsRig(mode?: ControlMode, pointer = false) {
    const { view } = await import('../render/view');
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    const project = vi
      .spyOn(view, 'screenToArena')
      .mockImplementation((x: number, y: number) => ({ x: -20 + x / 10, z: -12 + y / 10 }));
    const sent: ActionIntent[] = [];
    const canvas = new EventTarget() as unknown as HTMLElement;
    const m = new InputManager(
      [{ slot: 0, bindings: SOLO_BINDINGS, pointer, ...(mode ? { mode } : {}) }],
      canvas,
      (_slot, intent) => sent.push(intent),
    );
    m.setHandsOn(0, true);
    const ev = (type: string, init: Record<string, unknown>) =>
      Object.assign(new Event(type), { pointerId: 1, button: 0, ...init });
    const frames = (ms: number, snapshot: WorldSnapshot | null = null) => {
      for (let t = 0; t < ms; t += 16) {
        now += 16;
        m.update(snapshot);
      }
    };
    const hands = () => sent.filter((i) => i.action === 'aim' && i.hand).map((i) => i.hand!);
    const restore = () => {
      m.dispose();
      clock.mockRestore();
      project.mockRestore();
    };
    return { m, sent, canvas, ev, frames, hands, restore };
  }

  it('mouse: holding the button closes the hand; the wheel turns the grip, which stays turned', async () => {
    const r = await handsRig(undefined, true);
    r.canvas.dispatchEvent(
      r.ev('pointermove', { pointerType: 'mouse', clientX: 140, clientY: 120 }),
    );
    r.canvas.dispatchEvent(r.ev('pointerdown', { pointerType: 'mouse', button: 0 }));
    r.frames(200);
    expect(r.hands().at(-1)).toMatchObject({ grip: 1, push: 0 });
    expect(r.sent.every((i) => i.action === 'aim')).toBe(true); // no PULSE from the left button
    r.canvas.dispatchEvent(
      Object.assign(new Event('wheel'), { deltaY: -100, preventDefault: () => {} }),
    );
    r.frames(50);
    expect(r.hands().at(-1)!.twist).toBeCloseTo(0.4, 6);
    r.frames(2000);
    expect(r.hands().at(-1)!.twist).toBeCloseTo(0.4, 6); // held: the grip stays turned
    (globalThis.window as unknown as EventTarget).dispatchEvent(
      r.ev('pointerup', { pointerType: 'mouse', button: 0 }),
    );
    r.frames(2000);
    expect(r.hands().at(-1)).toMatchObject({ grip: 0, twist: 0 }); // let go; the hand eases back
    r.restore();
  });

  it('touch: a finger that lands on a body holds it until lifted; on open floor it does not', async () => {
    const r = await handsRig('touch');
    const core = { id: 1, kind: 'core', owner: -1, p: [-6, 1.2, 0], q: [0, 0, 0, 1], v: [0, 0, 0] };
    const player = { m: [-15, 0] };
    const snap = { entities: [core], players: [player, player] } as unknown as WorldSnapshot;
    r.frames(32, snap);
    // (−6, 0) on the arena is screen (140, 120) in this rig.
    r.canvas.dispatchEvent(
      r.ev('pointerdown', { pointerType: 'touch', clientX: 140, clientY: 120 }),
    );
    r.frames(100, snap);
    expect(r.hands().at(-1)).toMatchObject({ grip: 1 });
    (globalThis.window as unknown as EventTarget).dispatchEvent(
      r.ev('pointerup', { pointerType: 'touch' }),
    );
    r.frames(100, snap);
    expect(r.hands().at(-1)).toMatchObject({ grip: 0 });
    r.canvas.dispatchEvent(r.ev('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 40 }));
    r.frames(100, snap);
    expect(r.hands().at(-1)).toMatchObject({ grip: 0 });
    r.restore();
  });

  it('turned off, the seat opens its hand once (what it held is let go), then sends no hand', async () => {
    const r = await handsRig(undefined, true);
    r.canvas.dispatchEvent(
      r.ev('pointermove', { pointerType: 'mouse', clientX: 140, clientY: 120 }),
    );
    r.canvas.dispatchEvent(r.ev('pointerdown', { pointerType: 'mouse', button: 0 }));
    r.frames(200);
    expect(r.hands().at(-1)!.grip).toBe(1);
    r.m.setHandsOn(0, false);
    const n = r.sent.length;
    r.frames(600);
    const after = r.sent.slice(n).filter((i) => i.action === 'aim');
    expect(after.length).toBeGreaterThan(1);
    expect(after[0]!.hand).toEqual({ grip: 0, push: 0, twist: 0 });
    expect(after.slice(1).every((i) => i.hand === undefined)).toBe(true);
    r.restore();
  });
});
