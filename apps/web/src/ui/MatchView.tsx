import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { PlayerSlot } from '@ff/protocol';
import type { BotDifficulty } from '@ff/sim';
import { GameClient } from '../game/client';
import { useHud } from '../game/store';
import { useHistory } from '../game/history';
import { resolveQuality, useSettings } from '../game/settings';
import { WorkerSession } from '../net/worker-session';
import { GameClientProvider, useGameClient } from '../render/frame-context';
import { GameScene } from '../render/Scene';
import { InputManager, type SeatConfig } from '../input/manager';
import { P1_BINDINGS, P2_BINDINGS, SOLO_BINDINGS } from '../input/bindings';
import { useEventAudio } from '../audio/event-audio';
import { sfx } from '../audio/sfx';
import { Hud, type HudSeat } from './Hud';
import { Banners, DenyToast, MatchEndPanel, PauseMenu } from './Overlays';
import { TouchControls } from './TouchControls';
import { DevHud } from '../hud/DevHud';
import { view } from '../render/view';

export type MatchMode =
  { kind: 'attract' } | { kind: 'bot'; difficulty: BotDifficulty } | { kind: 'duel' };

interface ModeSetup {
  readonly localSlots: readonly PlayerSlot[];
  readonly bots: readonly { slot: PlayerSlot; difficulty: BotDifficulty }[];
  readonly seats: readonly SeatConfig[];
  readonly hudSeats: readonly HudSeat[];
  readonly labels: readonly [string, string];
}

function setupFor(mode: MatchMode, touch: boolean): ModeSetup {
  switch (mode.kind) {
    case 'attract':
      return {
        localSlots: [],
        bots: [
          { slot: 0, difficulty: 'hard' },
          { slot: 1, difficulty: 'normal' },
        ],
        seats: [],
        hudSeats: [],
        labels: ['EMBER', 'TIDE'],
      };
    case 'bot':
      return {
        localSlots: [0],
        bots: [{ slot: 1, difficulty: mode.difficulty }],
        seats: [{ slot: 0, bindings: SOLO_BINDINGS, pointer: true, touch }],
        hudSeats: [
          { slot: 0, label: 'YOU · EMBER', bindings: SOLO_BINDINGS, local: true },
          { slot: 1, label: `BOT · ${mode.difficulty.toUpperCase()}`, local: false },
        ],
        labels: ['YOU', 'BOT'],
      };
    case 'duel':
      return {
        localSlots: [0, 1],
        bots: [],
        seats: [
          { slot: 0, bindings: P1_BINDINGS, pointer: true, touch: false },
          { slot: 1, bindings: P2_BINDINGS, pointer: false, touch: false },
        ],
        hudSeats: [
          { slot: 0, label: 'PLAYER 1 · EMBER', bindings: P1_BINDINGS, local: true },
          { slot: 1, label: 'PLAYER 2 · TIDE', bindings: P2_BINDINGS, local: true },
        ],
        labels: ['PLAYER 1', 'PLAYER 2'],
      };
  }
}

const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

/**
 * One match (or the attract demo behind the menu): owns the GameClient, the local authority
 * worker and the input manager, and renders scene + HUD + overlays.
 */
export function MatchView({
  mode,
  fast = false,
  seed,
  onExit,
  onOpenControls,
}: {
  mode: MatchMode;
  fast?: boolean;
  /** Reproducible local match (tests, bug reports). */
  seed?: number;
  onExit: () => void;
  onOpenControls: () => void;
}) {
  const touch = useMemo(() => isTouchDevice(), []);
  const setup = useMemo(() => setupFor(mode, touch), [mode, touch]);
  const client = useMemo(() => new GameClient(1), []);
  const session = useRef<WorkerSession | null>(null);
  const input = useRef<InputManager | null>(null);
  const [started, setStarted] = useState(mode.kind === 'attract');
  const [paused, setPaused] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const matchEnd = useHud((s) => s.matchEnd);
  const phase = useHud((s) => s.match?.phase);
  const quality = useSettings((s) => s.quality);
  const qualityOverride = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('quality');
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  }, []);
  const devHud = useSettings((s) => s.devHud);
  useEventAudio(client, setup.localSlots);

  // Read-only test hook (?test=1): lets automated E2E "players" see the same public state a human
  // sees on screen and project world points to screen coordinates. Grants no authority.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    const w = window as unknown as Record<string, unknown>;
    w.__ffDebug = {
      snapshot: () => client.buffer.latest,
      project: (x: number, y: number, z: number) => view.worldToClient(x, y, z),
    };
    return () => {
      delete w.__ffDebug;
    };
  }, [client]);

  useEffect(() => {
    const s = new WorkerSession(client, {
      localSlots: setup.localSlots,
      bots: setup.bots,
      autoStart: mode.kind === 'attract',
      fast,
      ...(seed !== undefined ? { seed } : {}),
    });
    session.current = s;
    client.attach(s);
    void s.start().catch(() => undefined);
    return () => {
      client.dispose();
      session.current = null;
    };
  }, [client, setup, mode.kind, fast, seed]);

  useEffect(
    () =>
      client.matchEnds.on((end) => {
        setRematchWaiting(false);
        if (mode.kind !== 'attract') {
          useHistory.getState().add({
            mode: mode.kind,
            winner: end.winner,
            roundWins: end.roundWins,
            digest: end.digest,
          });
        } else setTimeout(() => session.current?.requestRematch(), 4000); // attract loop
      }),
    [client, mode.kind],
  );

  // Refused actions flash the matching HUD chip briefly.
  useEffect(
    () =>
      client.acks.on(({ slot, result }) => {
        if (result.accepted) return;
        const action = input.current?.actionForSeq(slot, result.seq);
        if (!action) return;
        const key = `${slot}:${action}`;
        setDenied((d) => new Set(d).add(key));
        setTimeout(
          () =>
            setDenied((d) => {
              const n = new Set(d);
              n.delete(key);
              return n;
            }),
          420,
        );
      }),
    [client],
  );

  // Kickoff resets manipulators; snap local reticles back to them.
  useEffect(
    () =>
      client.events.on((e) => {
        if (e.type === 'phase' && e.phase === 'countdown') {
          const latest = client.buffer.latest;
          if (latest) input.current?.snapReticles(latest);
        }
      }),
    [client],
  );

  const start = useCallback(() => {
    sfx.unlock();
    sfx.play('ui');
    session.current?.setReady(true, touch ? 'touch' : 'keyboard');
    setStarted(true);
  }, [touch]);

  const togglePause = useCallback(
    (next?: boolean) => {
      if (mode.kind === 'attract' || !started) return;
      setPaused((p) => {
        const v = next ?? !p;
        session.current?.setPaused(v);
        input.current?.setPaused(v);
        return v;
      });
    },
    [mode.kind, started],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (phase !== 'matchEnd') togglePause();
      } else if (
        !started &&
        mode.kind !== 'attract' &&
        (e.code === 'Space' || e.code === 'Enter')
      ) {
        e.preventDefault();
        start();
      } else if (e.code === 'KeyM') {
        const s = useSettings.getState();
        s.set('sound', !s.sound);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePause, started, start, mode.kind, phase]);

  const rematch = () => {
    sfx.unlock();
    setRematchWaiting(setup.localSlots.length < 2 && setup.bots.length === 0);
    session.current?.requestRematch();
    useHud.setState({ matchEnd: null });
  };

  const exit = () => {
    onExit();
  };

  return (
    <GameClientProvider client={client}>
      <div className="stage">
        <GameScene
          quality={qualityOverride ?? resolveQuality(quality)}
          localSlots={setup.localSlots}
        >
          {setup.seats.length > 0 ? (
            <InputBridge seats={setup.seats} managerRef={input} session={session} />
          ) : null}
        </GameScene>
        {mode.kind !== 'attract' ? (
          <>
            <Hud seats={setup.hudSeats} denied={denied} />
            <Banners client={client} />
            <DenyToast client={client} localSlots={setup.localSlots} />
            {touch && setup.localSlots.length === 1 ? (
              <TouchControls manager={input} slot={setup.localSlots[0]!} />
            ) : null}
            <button
              className="icon-btn pause-btn"
              onClick={() => togglePause(true)}
              aria-label="Pause"
            >
              ❚❚
            </button>
          </>
        ) : null}
        {!started ? <ReadyGate mode={mode} onStart={start} onExit={exit} touch={touch} /> : null}
        {paused ? (
          <PauseMenu
            onResume={() => togglePause(false)}
            onMenu={exit}
            onControls={onOpenControls}
          />
        ) : null}
        {matchEnd && mode.kind !== 'attract' ? (
          <MatchEndPanel
            winner={matchEnd.winner}
            roundWins={matchEnd.roundWins}
            labels={setup.labels}
            onRematch={rematch}
            onMenu={exit}
            waiting={rematchWaiting}
          />
        ) : null}
        {devHud ? <DevHud client={client} /> : null}
      </div>
    </GameClientProvider>
  );
}

/** Lives inside the Canvas so it can bind to the real canvas element and pump aim per frame. */
function InputBridge({
  seats,
  managerRef,
  session,
}: {
  seats: readonly SeatConfig[];
  managerRef: React.RefObject<InputManager | null>;
  session: React.RefObject<WorkerSession | null>;
}) {
  const gl = useThree((s) => s.gl);
  const client = useGameClient();
  useEffect(() => {
    const m = new InputManager(seats, gl.domElement, (slot, intent) =>
      session.current?.sendIntent(slot, intent),
    );
    managerRef.current = m;
    return () => {
      m.dispose();
      managerRef.current = null;
    };
  }, [gl, seats, managerRef, session]);
  useFrame(() => {
    managerRef.current?.update(client.buffer.latest);
  });
  return null;
}

function ReadyGate({
  mode,
  onStart,
  onExit,
  touch,
}: {
  mode: MatchMode;
  onStart: () => void;
  onExit: () => void;
  touch: boolean;
}) {
  return (
    <div className="modal-backdrop soft">
      <div className="panel ready-gate" data-testid="ready-gate">
        <div className="me-eyebrow">
          {mode.kind === 'duel' ? 'LOCAL DUEL · SHARED SCREEN' : 'QUICK MATCH · VS BOT'}
        </div>
        <div className="me-title">Drive the Rift Core into the rival gate</div>
        {touch ? (
          <ul className="hints">
            <li>Drag on the arena to move your force point</li>
            <li>PULSE pushes the core away from your force point</li>
            <li>LIFT (hold) raises it · SWEEP lays a crosswind · GUARD raises a barrier</li>
          </ul>
        ) : mode.kind === 'duel' ? (
          <div className="duel-keys">
            <div>
              <b>Player 1</b> WASD move · Space pulse · L-Shift lift · Q/E sweep · F guard · mouse
              aims too
            </div>
            <div>
              <b>Player 2</b> Arrows/IJKL move · Enter pulse · R-Shift lift · , . sweep · / guard
            </div>
          </div>
        ) : (
          <ul className="hints">
            <li>Mouse or WASD moves your force point · click / Space = PULSE</li>
            <li>Right mouse / Shift (hold) = LIFT · wheel / Q E = SWEEP · F = GUARD</li>
            <li>Pulse pushes the core away from your force point — get behind it</li>
          </ul>
        )}
        <div className="row">
          <button className="btn primary big" onClick={onStart} data-testid="start-match" autoFocus>
            Start match
          </button>
          <button className="btn" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
