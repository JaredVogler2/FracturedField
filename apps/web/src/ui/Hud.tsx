import {
  DEFAULT_ABILITIES,
  DEFAULT_LOADOUT,
  DEFAULT_RULES,
  type AbilityId,
  type AdvancedAbilityId,
} from '@ff/game-data';
import type { PlayerSlot, PlayerSnapshot } from '@ff/protocol';
import { useHud } from '../game/store';
import { Glyph } from './Glyph';
import { teamOf } from './teams';
import { keyLabel, type KeyBindings } from '../input/bindings';
import { ABILITY_INFO, loadoutLabel } from './Loadout';

const TICK = DEFAULT_RULES.match.tickRate;

function formatClock(ticks: number): string {
  const s = Math.max(0, Math.ceil(ticks / TICK));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface HudSeat {
  readonly slot: PlayerSlot;
  readonly label: string;
  readonly bindings?: KeyBindings;
  readonly local: boolean;
  readonly loadout?: readonly [AdvancedAbilityId, AdvancedAbilityId];
}

interface Chip {
  readonly id: AbilityId;
  readonly name: string;
  readonly key: keyof KeyBindings;
  readonly element?: 'wet' | 'heat';
}

function chipsFor(loadout: readonly [AdvancedAbilityId, AdvancedAbilityId]): Chip[] {
  return [
    { id: 'pulse', name: 'Pulse', key: 'pulse' },
    { id: 'lift', name: 'Lift', key: 'lift' },
    { id: 'sweep', name: 'Sweep', key: 'sweepUp' },
    { id: 'guard', name: 'Guard', key: 'guard' },
    { id: 'infuse', name: 'Wet', key: 'infuseWet', element: 'wet' },
    { id: 'infuse', name: 'Heat', key: 'infuseHeat', element: 'heat' },
    { id: loadout[0], name: ABILITY_INFO[loadout[0]].name, key: 'adv1' },
    { id: loadout[1], name: ABILITY_INFO[loadout[1]].name, key: 'adv2' },
  ];
}

/**
 * In-match HUD. Placed in screen corners and the top edge so it never covers the core or goals.
 * `mirror` swaps sides so each team's panel sits on the side of the goal it defends on screen
 * (the online seat-1 camera looks at the arena from the other side).
 */
export function Hud({
  seats,
  denied,
  mirror = false,
  scoreboard = true,
}: {
  seats: readonly HudSeat[];
  denied: ReadonlySet<string>;
  mirror?: boolean;
  /** The score, clock and rounds (off in the Hands Lab, which has no match to keep). */
  scoreboard?: boolean;
}) {
  const match = useHud((s) => s.match);
  const players = useHud((s) => s.players);
  if (!match || !players) return null;
  const [left, right]: [PlayerSlot, PlayerSlot] = mirror ? [1, 0] : [0, 1];
  return (
    <div className="hud" data-testid="hud">
      <div className="scoreboard" role="status" aria-live="polite" hidden={!scoreboard}>
        <div className="sb-team sb-left" style={{ ['--team' as string]: teamOf(left).color }}>
          <Glyph slot={left} size={22} />
          <span className="sb-name">{teamOf(left).name}</span>
          <span className="sb-score" data-testid={`score-${left}`}>
            {match.score[left]}
          </span>
        </div>
        <div className="sb-center">
          <div className={`sb-clock${match.golden ? ' golden' : ''}`} data-testid="clock">
            {match.golden ? 'GOLDEN RIFT' : formatClock(match.clockTicks)}
          </div>
          <div className="sb-rounds" aria-label={`Round ${match.round}`}>
            <Pips wins={match.roundWins[left]} slot={left} />
            <span className="sb-round">R{match.round}</span>
            <Pips wins={match.roundWins[right]} slot={right} />
          </div>
        </div>
        <div className="sb-team sb-right" style={{ ['--team' as string]: teamOf(right).color }}>
          <span className="sb-score" data-testid={`score-${right}`}>
            {match.score[right]}
          </span>
          <span className="sb-name">{teamOf(right).name}</span>
          <Glyph slot={right} size={22} />
        </div>
      </div>
      {seats.map((seat) => (
        <PlayerPanel
          key={seat.slot}
          seat={seat}
          side={seat.slot === left ? 'left' : 'right'}
          player={players[seat.slot]}
          denied={denied}
        />
      ))}
      <ConnectionChip />
    </div>
  );
}

/** Small, non-blocking signal for an unstable online connection (never shown offline). */
function ConnectionChip() {
  const t = useHud((s) => s.transport);
  const phase = useHud((s) => s.match?.phase);
  if (t.kind !== 'remote' || phase === 'lobby' || phase === 'matchEnd') return null;
  const rtt = t.rttMs ?? 0;
  const label =
    t.state === 'reconnecting'
      ? 'Reconnecting…'
      : t.state === 'connected' && rtt > 220
        ? `High latency · ${Math.round(rtt)} ms`
        : null;
  if (!label) return null;
  return (
    <div className="conn-chip" role="status" data-testid="conn-chip">
      {label}
    </div>
  );
}

function Pips({ wins, slot }: { wins: number; slot: PlayerSlot }) {
  const need = DEFAULT_RULES.match.roundsToWinMatch;
  return (
    <span className="pips">
      {Array.from({ length: need }, (_, i) => (
        <i
          key={i}
          className={i < wins ? 'on' : ''}
          style={{ ['--team' as string]: teamOf(slot).color }}
        />
      ))}
    </span>
  );
}

function PlayerPanel({
  seat,
  side,
  player,
  denied,
}: {
  seat: HudSeat;
  side: 'left' | 'right';
  player: PlayerSnapshot;
  denied: ReadonlySet<string>;
}) {
  const t = teamOf(seat.slot);
  const energy = Math.max(0, Math.min(100, player.energy));
  return (
    <div
      className={`player-panel ${side}${seat.local ? ' local' : ''}`}
      style={{ ['--team' as string]: t.color }}
    >
      <div className="pp-head">
        <Glyph slot={seat.slot} />
        <span className="pp-name">{seat.label}</span>
        {!player.connected ? <span className="pp-warn">offline</span> : null}
      </div>
      <div
        className="energy"
        role="meter"
        aria-label="energy"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(energy)}
      >
        <div className="energy-fill" style={{ width: `${energy}%` }} />
        {[
          DEFAULT_ABILITIES.pulse.cost,
          DEFAULT_ABILITIES.sweep.cost,
          DEFAULT_ABILITIES.guard.cost,
        ].map((c) => (
          <i key={c} className="energy-tick" style={{ left: `${c}%` }} />
        ))}
        <span className="energy-value" data-testid={`energy-${seat.slot}`}>
          {Math.floor(energy)}
        </span>
      </div>
      {!seat.local && seat.loadout ? (
        <div className="pp-picks" title="Their advanced moves">
          {loadoutLabel(seat.loadout)}
        </div>
      ) : null}
      {seat.local ? (
        <div className="abilities">
          {chipsFor(seat.loadout ?? DEFAULT_LOADOUT).map((a) => {
            const def = DEFAULT_ABILITIES[a.id];
            const cd = player.cd[a.id] ?? 0;
            const total = Math.max(1, Math.round(def.cooldownSeconds * TICK));
            const frac = Math.min(1, cd / total);
            const affordable = energy >= def.cost;
            const held = player.hold === a.id;
            const flash = denied.has(`${seat.slot}:${a.id}`);
            const key = seat.bindings?.[a.key][0];
            return (
              <div
                key={a.key}
                className={`ability${!affordable ? ' poor' : ''}${held ? ' held' : ''}${flash ? ' denied' : ''}${a.element ? ` el-${a.element}` : ''}`}
                title={`${a.name} — ${def.cost} energy · ${ABILITY_INFO[a.id].blurb}`}
              >
                <div className="ab-cd" style={{ height: `${frac * 100}%` }} />
                <span className="ab-name">{a.name}</span>
                {key ? <span className="ab-key">{keyLabel(key)}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
