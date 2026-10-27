/**
 * InputManager hot-swap invariants (D06): a mode change releases held abilities first, keeps the
 * seat's sequence space (the authority would drop restarted sequence numbers as stale), and from
 * then on every intent carries the new mode's source. A minimal event-target DOM stands in for
 * the browser: the manager only adds and removes listeners on window, document and the canvas.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionIntent } from '@ff/protocol';
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

  it('hiding the tab releases holds', () => {
    const { m, last } = rig('touch');
    m.action(0, { action: 'lift', phase: 'start' });
    (g.document as { hidden: boolean }).hidden = true;
    (g.document as EventTarget).dispatchEvent(new Event('visibilitychange'));
    expect(last()).toMatchObject({ action: 'lift', phase: 'end' });
    m.dispose();
  });
});
