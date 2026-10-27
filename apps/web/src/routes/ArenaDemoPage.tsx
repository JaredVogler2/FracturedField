import { useEffect, useMemo, useState } from 'react';
import type { PlayerSlot } from '@ff/protocol';
import type { SnapshotBot } from '@ff/sim';
import { GameClient } from '../game/client';
import { LocalSession } from '../net/local-session';
import { GameClientProvider } from '../render/frame-context';
import { GameScene } from '../render/Scene';
import { SimDebugOverlay } from '../render/SimDebugOverlay';
import { DevHud } from '../hud/DevHud';
import { useHud } from '../game/store';
import { checkRoomService } from '../net/room-service';

/**
 * Phase 01 rendering spike: the real shared GameWorld runs locally at 30 Hz with two snapshot bots
 * driving both seats; the 3D view interpolates authoritative snapshots exactly as online play will.
 */
export function ArenaDemoPage({ debug = false }: { debug?: boolean }) {
  const client = useMemo(() => new GameClient(1), []);
  const [serviceStatus, setServiceStatus] = useState('checking…');
  const match = useHud((s) => s.match);

  useEffect(() => {
    let bots: SnapshotBot[] = [];
    const session = new LocalSession(client, {
      localSlots: [0, 1] as PlayerSlot[],
      autoStart: true,
      beforeTick: (world) => {
        const snap = world.snapshot();
        for (const bot of bots)
          for (const intent of bot.think(snap)) world.applyCommand(bot.slot, intent);
      },
    });
    client.attach(session);
    void import('@ff/sim').then(({ SnapshotBot: Bot }) => {
      bots = [new Bot(0, 'hard', 1), new Bot(1, 'normal', 2)];
    });
    void session.start();
    void checkRoomService().then(setServiceStatus);
    return () => client.dispose();
  }, [client]);

  return (
    <GameClientProvider client={client}>
      <div className="stage">
        <GameScene quality="high">{debug ? <SimDebugOverlay /> : null}</GameScene>
        <DevHud
          client={client}
          extra={{
            'room service': serviceStatus,
            match: match
              ? `${match.phase} · R${match.round} · ${match.score[0]}-${match.score[1]}`
              : '—',
          }}
        />
        <div className="spike-banner">
          FRACTURE FIELD · Phase 01 spike — shared authoritative sim, bot vs bot
        </div>
      </div>
    </GameClientProvider>
  );
}
