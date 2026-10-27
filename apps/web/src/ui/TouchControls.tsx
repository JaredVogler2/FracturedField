import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  DEFAULT_ABILITIES,
  DEFAULT_RULES,
  type AbilityId,
  type AdvancedAbilityId,
} from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { ABILITY_INFO } from './Loadout';
import type { InputManager } from '../input/manager';
import { view } from '../render/view';
import { sfx } from '../audio/sfx';
import { useGameClient } from '../render/frame-context';
import { useHud } from '../game/store';

type Edge = Parameters<InputManager['action']>[1];

const TICK = DEFAULT_RULES.match.tickRate;

/** A short tick where the browser supports vibration (most iOS browsers don't: sound covers it). */
const buzz = () => {
  try {
    navigator.vibrate?.(8);
  } catch {
    // vibration blocked by the browser or the OS
  }
};

/** Screen direction (x right, y up) of a swipe → a SWEEP edge with the matching world wind. */
function sweepEdge(sx: number, sy: number): Edge {
  const { right, up } = view.groundAxes();
  const horizontal = Math.abs(sx) > Math.abs(sy);
  const x = horizontal ? Math.sign(sx) : 0;
  const y = horizontal ? 0 : Math.sign(sy) || 1;
  return {
    action: 'sweep',
    phase: 'tap',
    modifier: y !== 0 ? (y > 0 ? 1 : -1) : x < 0 ? 1 : -1,
    dir: [right.x * x + up.x * y, right.z * x + up.z * y],
  };
}

/** Minimum travel (px) for a swipe on the SWEEP pad; a shorter touch blows forward. */
const SWIPE_PX = 22;
/** How long a hold button trusts its own tap before showing the server's answer again. */
const PENDING_MS = 900;

/**
 * Thumb controls for touch, motion and simplified play. Large targets (≥ 56 px) in one thumb
 * cluster, mirrored for left-handed players; the other thumb aims (drag or tap on the arena, or
 * tilt in motion mode). SWEEP is a pad: swipe in the wind's direction, or tap to blow forward.
 * With `sticky`, hold moves (LIFT, MAGNET) toggle on tap — no held finger needed. Each button
 * shows its own cooldown and dims when there is not enough energy, so the thumb's eye never has
 * to leave the cluster.
 */
export function TouchControls({
  manager,
  slot,
  loadout,
  hand = 'right',
  sticky = false,
  simplified = false,
  denied,
}: {
  manager: RefObject<InputManager | null>;
  slot: PlayerSlot;
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId];
  hand?: 'right' | 'left';
  sticky?: boolean;
  simplified?: boolean;
  /** `slot:action` keys the authority just refused (the button shakes, like the HUD chip). */
  denied?: ReadonlySet<string>;
}) {
  const client = useGameClient();
  const player = useHud((s) => s.players?.[slot] ?? null);
  // A hold button shows the authoritative hold (the server may end it: energy, hold limit, a goal),
  // except just after a tap, when it shows what the tap asked for until the server has answered.
  const [pending, setPending] = useState<{ action: AbilityId; on: boolean; at: number } | null>(
    null,
  );
  const swipe = useRef<{ id: number; x: number; y: number; fired: boolean } | null>(null);

  // A refused START (out of range, no energy) or END shows the server's state at once, so the
  // next tap asks again instead of "releasing" a hold that never began.
  useEffect(
    () =>
      client.acks.on(({ slot: s, result }) => {
        if (s !== slot || result.accepted) return;
        const action = manager.current?.actionForSeq(slot, result.seq);
        setPending((p) => (p && p.action === action ? null : p));
      }),
    [client, slot, manager],
  );

  const hold = player?.hold ?? null;
  const isOn = (action: AbilityId) => (pending?.action === action ? pending.on : hold === action);
  /** Cooldown fraction left (0..1) and whether the move is affordable right now. */
  const status = (id: AbilityId) => {
    const def = DEFAULT_ABILITIES[id];
    const total = Math.max(1, Math.round(def.cooldownSeconds * TICK));
    const cd = player?.cd[id] ?? 0;
    return { frac: Math.min(1, cd / total), poor: (player?.energy ?? 100) < def.cost };
  };
  const cls = (id: AbilityId, base: string) => {
    const s = status(id);
    const refused = denied?.has(`${slot}:${id}`) ? ' denied' : '';
    const cooling = s.frac > 0 ? ' cooling' : '';
    return `${base}${s.poor ? ' poor' : ''}${cooling}${isOn(id) ? ' on' : ''}${refused}`;
  };
  const cooldown = (id: AbilityId) => {
    const { frac } = status(id);
    return frac > 0 ? (
      <i className="tc-cd" style={{ height: `${(frac * 100).toFixed(0)}%` }} aria-hidden="true" />
    ) : null;
  };

  const send = (edge: Edge) => {
    sfx.unlock();
    manager.current?.action(slot, edge);
  };
  const stop = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  /**
   * Keyboard, switch and screen-reader activation arrives as a click with no pointer press before
   * it (`detail` 0): those players get the same actions (holds toggle).
   */
  const viaKeyboard = (e: React.MouseEvent) => e.detail === 0;
  const tap = (edge: Edge) => ({
    onPointerDown: (e: React.PointerEvent) => {
      stop(e);
      buzz();
      send(edge);
    },
    onClick: (e: React.MouseEvent) => {
      if (viaKeyboard(e)) send(edge);
    },
  });

  /** `at` is the event's timestamp (same clock as performance.now()). */
  const toggle = (action: AbilityId, at: number) => {
    const on = isOn(action);
    send({ action, phase: on ? 'end' : 'start' });
    setPending({ action, on: !on, at });
    setTimeout(() => setPending((p) => (p?.at === at ? null : p)), PENDING_MS);
  };

  /** Hold move: press-and-hold (pointer captured, so a sliding thumb doesn't drop it) or toggle. */
  const holdProps = (action: AbilityId) => ({
    ...(sticky
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            stop(e);
            buzz();
            toggle(action, e.timeStamp);
          },
        }
      : {
          onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
            stop(e);
            buzz();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            send({ action, phase: 'start' });
          },
          onPointerUp: () => send({ action, phase: 'end' }),
          onPointerCancel: () => send({ action, phase: 'end' }),
          onLostPointerCapture: () => send({ action, phase: 'end' }),
        }),
    onClick: (e: React.MouseEvent) => {
      if (viaKeyboard(e)) toggle(action, e.timeStamp);
    },
    'aria-pressed': isOn(action),
  });

  const pad = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      stop(e);
      e.currentTarget.setPointerCapture?.(e.pointerId);
      swipe.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = swipe.current;
      if (!s || s.id !== e.pointerId || s.fired) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.hypot(dx, dy) < SWIPE_PX) return;
      s.fired = true;
      buzz();
      send(sweepEdge(dx, -dy));
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s || s.id !== e.pointerId || s.fired) return;
      buzz();
      send(sweepEdge(0, 1));
    },
    onPointerCancel: () => {
      swipe.current = null;
    },
    onClick: (e: React.MouseEvent) => {
      if (viaKeyboard(e)) send(sweepEdge(0, 1));
    },
  };

  return (
    <div
      className={`touch-controls hand-${hand}${simplified ? ' simplified' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="touch-controls"
    >
      <button
        className={cls('pulse', 'tc-btn tc-pulse')}
        {...tap({ action: 'pulse', phase: 'tap' })}
        aria-label="Pulse"
        data-testid="tc-pulse"
      >
        {cooldown('pulse')}
        <span>PULSE</span>
      </button>
      <button
        className={cls('lift', 'tc-btn tc-lift')}
        {...holdProps('lift')}
        aria-label={sticky ? 'Lift (tap to toggle)' : 'Lift (hold)'}
        data-testid="tc-lift"
      >
        {cooldown('lift')}
        <span>LIFT</span>
      </button>
      <button
        className={cls('guard', 'tc-btn tc-guard')}
        {...tap({ action: 'guard', phase: 'tap' })}
        aria-label="Guard"
        data-testid="tc-guard"
      >
        {cooldown('guard')}
        <span>GUARD</span>
      </button>
      <button
        className={cls('sweep', 'tc-btn tc-sweep')}
        {...pad}
        aria-label="Sweep: swipe in the wind's direction, or tap to blow forward"
        data-testid="tc-sweep"
      >
        {cooldown('sweep')}
        <span>SWEEP</span>
        <small aria-hidden="true">swipe</small>
      </button>
      <div className="tc-elements">
        <button
          className={cls('infuse', 'tc-btn tc-el el-wet')}
          {...tap({ action: 'infuse', phase: 'tap', modifier: 0 })}
          aria-label="Infuse water"
          data-testid="tc-wet"
        >
          {cooldown('infuse')}
          <span>WET</span>
        </button>
        <button
          className={cls('infuse', 'tc-btn tc-el el-heat')}
          {...tap({ action: 'infuse', phase: 'tap', modifier: 1 })}
          aria-label="Infuse heat"
          data-testid="tc-heat"
        >
          {cooldown('infuse')}
          <span>HEAT</span>
        </button>
        {loadout.map((id, i) =>
          DEFAULT_ABILITIES[id].kind === 'hold' ? (
            <button
              key={id}
              className={cls(id, 'tc-btn tc-el')}
              {...holdProps(id)}
              aria-label={`${ABILITY_INFO[id].name} (${sticky ? 'tap to toggle' : 'hold'})`}
              data-testid={`tc-pick${i + 1}`}
            >
              {cooldown(id)}
              <span>{ABILITY_INFO[id].name.toUpperCase()}</span>
            </button>
          ) : (
            <button
              key={id}
              className={cls(id, 'tc-btn tc-el')}
              {...tap({ action: id, phase: 'tap' })}
              aria-label={ABILITY_INFO[id].name}
              data-testid={`tc-pick${i + 1}`}
            >
              {cooldown(id)}
              <span>{ABILITY_INFO[id].name.toUpperCase()}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
