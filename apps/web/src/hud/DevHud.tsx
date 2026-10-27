import { useEffect, useState } from 'react';
import { useHud } from '../game/store';
import { renderStats } from '../render/render-stats';
import type { GameClient } from '../game/client';

/** Developer diagnostics: sim tick, bodies, frame time, transport and renderer counters. */
export function DevHud({ client, extra }: { client: GameClient; extra?: Record<string, string> }) {
  const transport = useHud((s) => s.transport);
  const tick = useHud((s) => s.serverTick);
  const bodies = useHud((s) => s.bodies);
  const sps = useHud((s) => s.snapshotsPerSecond);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const fps = 1000 / Math.max(1, renderStats.frameMs);
  const rows: [string, string][] = [
    ['build', __BUILD_ID__],
    [
      'transport',
      `${transport.kind} · ${transport.state}${transport.detail ? ` · ${transport.detail}` : ''}`,
    ],
    ['sim tick', String(tick)],
    ['bodies', String(bodies)],
    ['snapshots/s', sps.toFixed(1)],
    [
      'interp',
      `${client.buffer.delayTicks.toFixed(2)} ticks · jitter ${client.buffer.jitterMs.toFixed(1)} ms`,
    ],
    ['frame', `${renderStats.frameMs.toFixed(1)} ms (${fps.toFixed(0)} fps)`],
    ['draw calls', String(renderStats.drawCalls)],
    ['triangles', renderStats.triangles.toLocaleString()],
    ['gpu mem', `${renderStats.geometries} geo · ${renderStats.textures} tex`],
    ...Object.entries(extra ?? {}),
  ];
  return (
    <div className="dev-hud" data-testid="dev-hud">
      {rows.map(([k, v]) => (
        <div key={k}>
          <span>{k}</span>
          <b data-key={k}>{v}</b>
        </div>
      ))}
    </div>
  );
}
