import { useEffect, useState } from 'react';
import { DEFAULT_RULES } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
import { useHud } from '../game/store';
import type { GameClient } from '../game/client';
import type { RemoteSession } from '../net/remote-session';
import { localAim } from '../render/vfx/local-aim';

const TICK_MS = 1000 / DEFAULT_RULES.match.tickRate;

interface NetView {
  readonly poor: boolean;
  readonly rows: readonly (readonly [string, string])[];
}

/**
 * Network diagnostics for online play (developer HUD or `?net=1`; hidden by default): link state,
 * RTT/jitter, snapshot cadence, interpolation health, sequence/ACK progress and reconnects.
 */
export function NetPanel({
  client,
  session,
  slot,
}: {
  client: GameClient;
  session: RemoteSession | null;
  slot: PlayerSlot;
}) {
  const [view, setView] = useState<NetView | null>(null);
  useEffect(() => {
    if (!session) return;
    let lastBytes = session.client.stats.bytesIn;
    let lastAt = performance.now();
    let rate = 0;
    const update = () => {
      const now = performance.now();
      const st = session.client.stats;
      if (now - lastAt >= 1000) {
        rate = ((st.bytesIn - lastBytes) * 1000) / (now - lastAt);
        lastBytes = st.bytesIn;
        lastAt = now;
      }
      const hud = useHud.getState();
      const buf = client.buffer;
      const latest = buf.latest;
      const extrapolated =
        buf.sampledFrames > 0 ? (buf.extrapolatedFrames / buf.sampledFrames) * 100 : 0;
      const aim = localAim.get(slot);
      const m = latest?.players[slot].m;
      const lag = aim && m ? Math.hypot(aim.x - m[0], aim.z - m[1]) : 0;
      const t = hud.transport;
      setView({
        poor: st.rttMs > 150 || st.jitterMs > 30 || buf.jitterMs > 30 || extrapolated > 10,
        rows: [
          ['room', `${hud.roomCode ?? '—'} · seat ${slot}`],
          ['link', `${t.state}${t.detail ? ` · ${t.detail}` : ''}`],
          ['rtt', `${st.rttMs.toFixed(0)} ms · jitter ${st.jitterMs.toFixed(1)} ms`],
          [
            'snapshots/s',
            `${hud.snapshotsPerSecond.toFixed(1)} · arrival jitter ${buf.jitterMs.toFixed(1)} ms`,
          ],
          [
            'interp delay',
            `${(buf.delayTicks * TICK_MS).toFixed(0)} ms (${buf.delayTicks.toFixed(2)} ticks)`,
          ],
          ['extrapolated', `${extrapolated.toFixed(1)}% of frames`],
          ['stale snapshots', String(buf.staleCount)],
          ['teleports snapped', String(buf.teleports)],
          ['server tick', `${st.lastServerTick} · view ${buf.renderTick.toFixed(1)}`],
          [
            'intents',
            `${st.intentsSent} sent · server acked seq ${latest ? latest.ack[slot] : '—'}`,
          ],
          ['force point lag', `${lag.toFixed(2)} m`],
          ['reconnects', String(st.reconnects)],
          ['downlink', `${(rate / 1024).toFixed(1)} KiB/s`],
          ['clock offset', `${st.clockOffsetMs.toFixed(0)} ms`],
        ],
      });
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [client, session, slot]);
  if (!view) return null;
  return (
    <div className="dev-hud net-panel" data-testid="net-panel">
      <div className={`net-quality ${view.poor ? 'poor' : 'good'}`}>
        {view.poor ? 'POOR CONNECTION' : 'CONNECTION OK'}
      </div>
      {view.rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b data-key={k}>{v}</b>
        </div>
      ))}
    </div>
  );
}
