import { useEffect, useState } from 'react';
import { DEFAULT_RULES } from '@ff/game-data';
import type { GameEvent, PlayerSlot } from '@ff/protocol';
import { useHud } from '../game/store';
import type { GameClient } from '../game/client';
import { Glyph } from './Glyph';
import { teamOf } from './teams';

interface Banner {
  readonly id: number;
  readonly kind: 'goal' | 'round' | 'golden';
  readonly title: string;
  readonly sub?: string;
  readonly slot: PlayerSlot | -1;
}

let bannerId = 1;

/** Authoritative-event banners: countdown, goals, Golden Rift and round results. */
export function Banners({ client }: { client: GameClient }) {
  const match = useHud((s) => s.match);
  const [banner, setBanner] = useState<Banner | null>(null);
  useEffect(() => {
    // Banners queue so a goal that also decides the round shows GOAL first, then the result.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const queue: { b: Omit<Banner, 'id'>; ms: number }[] = [];
    const next = () => {
      const item = queue.shift();
      if (!item) {
        timer = null;
        setBanner(null);
        return;
      }
      setBanner({ ...item.b, id: bannerId++ });
      timer = setTimeout(next, item.ms);
    };
    const show = (b: Omit<Banner, 'id'>, ms: number) => {
      queue.push({ b, ms });
      if (!timer) next();
    };
    const off = client.events.on((e: GameEvent) => {
      if (e.type === 'goal')
        show(
          {
            kind: 'goal',
            title: 'GOAL',
            sub: `${teamOf(e.scorer).name} scores · ${e.speed.toFixed(0)} m/s`,
            slot: e.scorer,
          },
          1600,
        );
      else if (e.type === 'roundEnd') {
        const reasons: Record<string, string> = {
          goals: 'first to three',
          clock: 'on the clock',
          golden: 'Golden Rift',
          territory: 'territory at the horn',
          draw: 'drawn',
        };
        show(
          {
            kind: 'round',
            title:
              e.winner === -1
                ? `ROUND ${e.round} DRAWN`
                : `ROUND ${e.round} · ${teamOf(e.winner).name}`,
            sub: reasons[e.reason] ?? '',
            slot: e.winner,
          },
          2400,
        );
      } else if (e.type === 'phase' && e.phase === 'playing') {
        const latest = client.buffer.latest;
        if (latest?.match.golden)
          show(
            { kind: 'golden', title: 'GOLDEN RIFT', sub: 'next goal wins the round', slot: -1 },
            2200,
          );
      }
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [client]);

  const countdown =
    match?.phase === 'countdown'
      ? Math.max(1, Math.ceil(match.phaseTicks / DEFAULT_RULES.match.tickRate))
      : null;
  return (
    <>
      {countdown !== null ? (
        <div className="countdown" key={countdown} data-testid="countdown">
          {countdown}
        </div>
      ) : null}
      {banner ? (
        <div
          className={`banner banner-${banner.kind}`}
          key={banner.id}
          style={{
            ['--team' as string]: banner.slot === -1 ? 'var(--violet)' : teamOf(banner.slot).color,
          }}
        >
          {banner.slot !== -1 ? <Glyph slot={banner.slot} size={30} /> : null}
          <div>
            <div className="banner-title">{banner.title}</div>
            {banner.sub ? <div className="banner-sub">{banner.sub}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

const DENY_TEXT: Record<string, string> = {
  energy: 'Not enough energy',
  cooldown: 'Recharging',
  lockout: 'Too fast',
  out_of_range: 'Nothing in range',
  illegal_target: 'Cannot place there',
  not_playing: 'Wait for kickoff',
  limit: 'Limit reached',
};

/** Short, non-blocking text for refused local actions (accessible alternative to the sound). */
export function DenyToast({
  client,
  localSlots,
}: {
  client: GameClient;
  localSlots: readonly PlayerSlot[];
}) {
  const [msg, setMsg] = useState<{ id: number; text: string; slot: PlayerSlot } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let id = 0;
    const off = client.acks.on(({ slot, result }) => {
      if (result.accepted || !localSlots.includes(slot) || !result.reason) return;
      const text = DENY_TEXT[result.reason];
      if (!text) return;
      setMsg({ id: ++id, text, slot });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 900);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [client, localSlots]);
  if (!msg) return null;
  return (
    <div className={`deny-toast ${msg.slot === 0 ? 'left' : 'right'}`} key={msg.id} role="status">
      {msg.text}
    </div>
  );
}

export function MatchEndPanel({
  winner,
  roundWins,
  labels,
  onRematch,
  onMenu,
  waiting,
}: {
  winner: PlayerSlot | -1;
  roundWins: readonly [number, number];
  labels: readonly [string, string];
  onRematch: () => void;
  onMenu: () => void;
  waiting: boolean;
}) {
  return (
    <div className="modal-backdrop">
      <div
        className="panel match-end"
        data-testid="match-end"
        style={{ ['--team' as string]: winner === -1 ? 'var(--violet)' : teamOf(winner).color }}
      >
        <div className="me-eyebrow">MATCH COMPLETE</div>
        <div className="me-title">
          {winner === -1 ? (
            'DRAW'
          ) : (
            <>
              <Glyph slot={winner} size={34} /> {labels[winner]} WINS
            </>
          )}
        </div>
        <div className="me-score">
          <span>{roundWins[0]}</span>
          <small>rounds</small>
          <span>{roundWins[1]}</span>
        </div>
        <div className="row">
          <button
            className="btn primary"
            onClick={onRematch}
            disabled={waiting}
            data-testid="rematch"
          >
            {waiting ? 'Waiting for opponent…' : 'Rematch'}
          </button>
          <button className="btn" onClick={onMenu}>
            Main menu
          </button>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({
  onResume,
  onMenu,
  onControls,
}: {
  onResume: () => void;
  onMenu: () => void;
  onControls: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="panel pause" role="dialog" aria-label="Paused">
        <div className="me-eyebrow">PAUSED</div>
        <div className="col">
          <button className="btn primary" onClick={onResume} autoFocus>
            Resume
          </button>
          <button className="btn" onClick={onControls}>
            Controls
          </button>
          <button className="btn" onClick={onMenu}>
            Quit to menu
          </button>
        </div>
      </div>
    </div>
  );
}
