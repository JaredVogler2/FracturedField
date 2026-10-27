import type { RefObject } from 'react';
import { DEFAULT_ABILITIES, type AdvancedAbilityId } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { ABILITY_INFO } from './Loadout';
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
  loadout,
}: {
  manager: RefObject<InputManager | null>;
  slot: PlayerSlot;
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId];
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
      <div className="tc-elements">
        <button
          className="tc-btn tc-el el-wet"
          onPointerDown={tap({ action: 'infuse', phase: 'tap', modifier: 0 })}
          aria-label="Infuse water"
        >
          WET
        </button>
        <button
          className="tc-btn tc-el el-heat"
          onPointerDown={tap({ action: 'infuse', phase: 'tap', modifier: 1 })}
          aria-label="Infuse heat"
        >
          HEAT
        </button>
        {loadout.map((id) =>
          DEFAULT_ABILITIES[id].kind === 'hold' ? (
            <button
              key={id}
              className="tc-btn tc-el"
              onPointerDown={tap({ action: id, phase: 'start' })}
              onPointerUp={tap({ action: id, phase: 'end' })}
              onPointerCancel={tap({ action: id, phase: 'end' })}
              onPointerLeave={tap({ action: id, phase: 'end' })}
              aria-label={`${ABILITY_INFO[id].name} (hold)`}
            >
              {ABILITY_INFO[id].name.toUpperCase()}
            </button>
          ) : (
            <button
              key={id}
              className="tc-btn tc-el"
              onPointerDown={tap({ action: id, phase: 'tap' })}
              aria-label={ABILITY_INFO[id].name}
            >
              {ABILITY_INFO[id].name.toUpperCase()}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
