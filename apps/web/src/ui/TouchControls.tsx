import type { RefObject } from 'react';
import type { PlayerSlot } from '@ff/protocol';
import type { InputManager } from '../input/manager';
import { view } from '../render/view';
import { sfx } from '../audio/sfx';

/**
 * Thumb-zone ability buttons for touch devices (large targets, bottom-right; aiming is a drag on
 * the arena). Phase 06 extends this with layouts, handedness and gyro aiming.
 */
export function TouchControls({
  manager,
  slot,
}: {
  manager: RefObject<InputManager | null>;
  slot: PlayerSlot;
}) {
  const tap = (edge: Parameters<InputManager['action']>[1]) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    sfx.unlock();
    manager.current?.action(slot, edge);
  };
  const sweep = (up: boolean) => {
    const axes = view.groundAxes();
    return tap({
      action: 'sweep',
      phase: 'tap',
      modifier: up ? 1 : -1,
      dir: up ? [axes.up.x, axes.up.z] : [-axes.up.x, -axes.up.z],
    });
  };
  return (
    <div className="touch-controls" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className="tc-btn tc-pulse"
        onPointerDown={tap({ action: 'pulse', phase: 'tap' })}
        aria-label="Pulse"
      >
        PULSE
      </button>
      <button
        className="tc-btn tc-lift"
        onPointerDown={tap({ action: 'lift', phase: 'start' })}
        onPointerUp={tap({ action: 'lift', phase: 'end' })}
        onPointerCancel={tap({ action: 'lift', phase: 'end' })}
        onPointerLeave={tap({ action: 'lift', phase: 'end' })}
        aria-label="Lift (hold)"
      >
        LIFT
      </button>
      <button className="tc-btn tc-sweep-up" onPointerDown={sweep(true)} aria-label="Sweep up">
        SWEEP ↑
      </button>
      <button className="tc-btn tc-sweep-down" onPointerDown={sweep(false)} aria-label="Sweep down">
        SWEEP ↓
      </button>
      <button
        className="tc-btn tc-guard"
        onPointerDown={tap({ action: 'guard', phase: 'tap' })}
        aria-label="Guard"
      >
        GUARD
      </button>
    </div>
  );
}
