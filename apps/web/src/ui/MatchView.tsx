import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_LOADOUT, type AdvancedAbilityId } from '@ff/game-data';
import type { InputSource, PlayerSlot } from '@ff/protocol';
import type { BotDifficulty } from '@ff/sim';
import { GameClient } from '../game/client';
import { useHud } from '../game/store';
import { useHistory } from '../game/history';
import { resolveQuality, useSettings } from '../game/settings';
import { WorkerSession } from '../net/worker-session';
import { RemoteSession } from '../net/remote-session';
import { roomServiceUrl, roomSocketUrl } from '../net/room-service';
import { forgetSeat, updateSeatTicket, type StoredSeat } from '../net/seat-store';
import type { SeatLoadouts, SessionDriver } from '../net/session';
import { GameClientProvider, useGameClient } from '../render/frame-context';
import { GameScene } from '../render/Scene';
import { InputManager, type SeatConfig } from '../input/manager';
import { P1_BINDINGS, P2_BINDINGS, SOLO_BINDINGS } from '../input/bindings';
import { useEventAudio } from '../audio/event-audio';
import { sfx } from '../audio/sfx';
import { Hud, type HudSeat } from './Hud';
import { Banners, DenyToast, MatchEndPanel, PauseMenu } from './Overlays';
import { TouchControls } from './TouchControls';
import { LoadoutPicker, parseLoadout } from './Loadout';
import { CameraControl } from './camera/CameraControl';
import { NetStatusOverlay, OnlineLobby } from './Online';
import { teamOf } from './teams';
import { DevHud } from '../hud/DevHud';
import { NetPanel } from '../hud/NetPanel';
import { view } from '../render/view';

export type MatchMode =
  | { kind: 'attract' }
  | { kind: 'bot'; difficulty: BotDifficulty }
  | { kind: 'duel' }
  | { kind: 'online'; seat: StoredSeat };

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
          // Touch players get on-screen buttons; keyboard hints would only confuse them.
          {
            slot: 0,
            label: 'YOU · EMBER',
            ...(touch ? {} : { bindings: SOLO_BINDINGS }),
            local: true,
          },
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
    case 'online': {
      const me = mode.seat.slot;
      const rival: PlayerSlot = me === 0 ? 1 : 0;
      const labels: [string, string] = me === 0 ? ['YOU', 'RIVAL'] : ['RIVAL', 'YOU'];
      return {
        localSlots: [me],
        bots: [],
        seats: [{ slot: me, bindings: SOLO_BINDINGS, pointer: true, touch }],
        hudSeats: [
          {
            slot: me,
            label: `YOU · ${teamOf(me).name}`,
            ...(touch ? {} : { bindings: SOLO_BINDINGS }),
            local: true,
          },
          { slot: rival, label: `RIVAL · ${teamOf(rival).name}`, local: false },
        ],
        labels,
      };
    }
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
  const online = mode.kind === 'online' ? mode.seat : null;
  const client = useMemo(
    () => new GameClient(online ? { delayTicks: 3, remote: true } : 1),
    [online],
  );
  const session = useRef<SessionDriver | null>(null);
  const [remote, setRemote] = useState<RemoteSession | null>(null);
  const input = useRef<InputManager | null>(null);
  const [started, setStarted] = useState(mode.kind === 'attract');
  const [paused, setPaused] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const [inputMode, setInputMode] = useState<InputSource>(touch ? 'touch' : 'keyboard');
  const [manager, setManager] = useState<InputManager | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const fallbackMode: InputSource = touch ? 'touch' : 'keyboard';
  const matchEnd = useHud((s) => s.matchEnd);
  const phase = useHud((s) => s.match?.phase);
  const lobby = useHud((s) => s.lobby);
  const netPanel = useMemo(() => new URLSearchParams(window.location.search).has('net'), []);
  const quality = useSettings((s) => s.quality);
  const qualityOverride = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('quality');
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  }, []);
  const devHud = useSettings((s) => s.devHud);
  const loadout = useSettings((s) => s.loadout);
  const loadoutP2 = useSettings((s) => s.loadoutP2);
  useEventAudio(client, setup.localSlots);

  // Advanced-move picks of the seats played on this device (sent with READY; the authority
  // validates them and applies them when the match starts).
  const seatLoadouts = useMemo<SeatLoadouts>(() => {
    switch (mode.kind) {
      case 'duel':
        return { 0: loadout, 1: loadoutP2 };
      case 'bot':
        return { 0: loadout };
      case 'online':
        return mode.seat.slot === 0 ? { 0: loadout } : { 1: loadout };
      case 'attract':
        return {};
    }
  }, [mode, loadout, loadoutP2]);
  const seats = useMemo(
    () => setup.seats.map((s) => ({ ...s, loadout: seatLoadouts[s.slot] ?? DEFAULT_LOADOUT })),
    [setup.seats, seatLoadouts],
  );

  // Read-only test hook (?test=1): lets automated E2E "players" see the same public state a human
  // sees on screen and project world points to screen coordinates. Grants no authority.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('test')) return;
    const w = window as unknown as Record<string, unknown>;
    // Recent authority verdicts and cast events, numbered so a test can look only at what came
    // after a point in time (a short cooldown is easy to miss by polling the snapshot).
    let n = 0;
    const acks: {
      n: number;
      /** Arrival time (performance.now), for input → verdict latency. */
      at: number;
      slot: number;
      action: string | undefined;
      accepted: boolean;
      reason?: string;
    }[] = [];
    const casts: {
      n: number;
      tick: number;
      slot: number;
      ability: string;
      phase: string;
      /** Ability-specific magnitude (PULSE: strength on the core, 0 = missed it). */
      mag: number;
    }[] = [];
    const offAcks = client.acks.on(({ slot, result }) => {
      acks.push({
        n: ++n,
        at: performance.now(),
        slot,
        action: input.current?.actionForSeq(slot, result.seq),
        accepted: result.accepted,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      if (acks.length > 200) acks.shift();
    });
    const offEvents = client.events.on((e) => {
      if (e.type !== 'cast') return;
      casts.push({
        n: ++n,
        tick: e.tick,
        slot: e.slot,
        ability: e.ability,
        phase: e.phase,
        mag: e.mag,
      });
      if (casts.length > 200) casts.shift();
    });
    w.__ffDebug = {
      mark: () => n,
      acks: () => [...acks],
      casts: () => [...casts],
      snapshot: () => client.buffer.latest,
      project: (x: number, y: number, z: number) => view.worldToClient(x, y, z),
      slot: () => useHud.getState().mySlot,
      transport: () => useHud.getState().transport.state,
      lobby: () => useHud.getState().lobby,
      matchEnd: () => useHud.getState().matchEnd,
    };
    return () => {
      offAcks();
      offEvents();
      delete w.__ffDebug;
    };
  }, [client]);

  useEffect(() => {
    let s: SessionDriver;
    if (online) {
      const base = roomServiceUrl();
      let seat = online;
      const r = new RemoteSession(client, {
        seat,
        socketUrl: roomSocketUrl(base ?? '', seat.code),
        onTicket: (ticket) => {
          seat = updateSeatTicket(seat, ticket);
        },
        onNewConnection: () => input.current?.onNewConnection(),
      });
      setRemote(r);
      s = r;
    } else {
      s = new WorkerSession(client, {
        localSlots: setup.localSlots,
        bots: setup.bots,
        autoStart: mode.kind === 'attract',
        fast,
        ...(seed !== undefined ? { seed } : {}),
      });
    }
    session.current = s;
    client.attach(s);
    void s.start().catch(() => undefined);
    return () => {
      client.dispose();
      session.current = null;
      setRemote(null);
    };
  }, [client, setup, mode.kind, online, fast, seed]);

  // A rematch (or a resumed connection) restarts the stream: stop showing "waiting".
  useEffect(
    () =>
      client.resyncs.on((reason) => {
        if (reason === 'rematch') setRematchWaiting(false);
      }),
    [client],
  );

  useEffect(
    () =>
      client.matchEnds.on((end) => {
        setRematchWaiting(false);
        if (online) setStarted(false); // the room resets READY after a match
        if (mode.kind !== 'attract') {
          useHistory.getState().add({
            mode: mode.kind,
            winner: end.winner,
            roundWins: end.roundWins,
            digest: end.digest,
          });
        } else setTimeout(() => session.current?.requestRematch(), 4000); // attract loop
      }),
    [client, mode.kind, online],
  );

  const actionFor = useCallback(
    (slot: PlayerSlot, seq: number) => input.current?.actionForSeq(slot, seq),
    [],
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
    session.current?.setReady(true, inputMode, seatLoadouts);
    setStarted(true);
  }, [inputMode, seatLoadouts]);

  const setOnlineReady = (ready: boolean) => {
    sfx.unlock();
    sfx.play('ui');
    session.current?.setReady(ready, inputMode, seatLoadouts);
    setStarted(ready);
  };

  // Online, the menu is only an overlay: the authoritative match keeps running.
  const togglePause = useCallback(
    (next?: boolean) => {
      if (mode.kind === 'attract' || (!started && !online)) return;
      setPaused((p) => {
        const v = next ?? !p;
        session.current?.setPaused?.(v);
        input.current?.setPaused(v);
        return v;
      });
    },
    [mode.kind, started, online],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (phase !== 'matchEnd') togglePause();
      } else if (
        !started &&
        !online &&
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
  }, [togglePause, started, start, mode.kind, phase, online]);

  const rematch = () => {
    sfx.unlock();
    session.current?.requestRematch();
    if (online) setRematchWaiting(true);
    else useHud.setState({ matchEnd: null });
  };

  const exit = () => {
    if (online) {
      session.current?.leave?.();
      forgetSeat(online.code);
    }
    onExit();
  };

  // Online: hide the result once the rematch actually starts (both players asked).
  useEffect(() => {
    if (online && matchEnd && phase === 'countdown') useHud.setState({ matchEnd: null });
  }, [online, matchEnd, phase]);

  const mySlot = online?.slot ?? 0;
  const rivalSlot: PlayerSlot = mySlot === 0 ? 1 : 0;
  const rivalSeat = lobby?.seats[rivalSlot];
  const rivalPicks = rivalSeat?.loadout;
  const rivalLoadout = useMemo<readonly [AdvancedAbilityId, AdvancedAbilityId] | undefined>(() => {
    if (!online) return mode.kind === 'bot' ? DEFAULT_LOADOUT : undefined;
    return parseLoadout(rivalPicks) ?? DEFAULT_LOADOUT;
  }, [online, mode.kind, rivalPicks]);
  const hudSeats = useMemo(
    () =>
      setup.hudSeats.map((h) => {
        const picks = h.local ? seatLoadouts[h.slot] : rivalLoadout;
        return picks ? { ...h, loadout: picks } : h;
      }),
    [setup.hudSeats, seatLoadouts, rivalLoadout],
  );
  const serverReady = online ? (lobby?.seats[mySlot].ready ?? started) : started;
  const inLobby = online !== null && !matchEnd && (phase === undefined || phase === 'lobby');
  const matchNote = !online
    ? undefined
    : matchEnd?.reason === 'forfeit'
      ? matchEnd.winner === mySlot
        ? 'Your rival left the match — win by forfeit.'
        : 'You left the match.'
      : rivalSeat && !rivalSeat.connected
        ? 'Your rival has left the room.'
        : rivalSeat?.wantsRematch
          ? 'Your rival wants a rematch.'
          : undefined;

  return (
    <GameClientProvider client={client}>
      <div className="stage">
        <GameScene
          quality={qualityOverride ?? resolveQuality(quality)}
          localSlots={setup.localSlots}
          side={mySlot === 1 ? -1 : 1}
          portraitSlot={mySlot}
        >
          {setup.seats.length > 0 ? (
            <InputBridge
              seats={seats}
              managerRef={input}
              session={session}
              onManager={setManager}
            />
          ) : null}
        </GameScene>
        {mode.kind !== 'attract' ? (
          <>
            <Hud seats={hudSeats} denied={denied} mirror={mySlot === 1} />
            <Banners client={client} />
            <DenyToast
              client={client}
              localSlots={setup.localSlots}
              mirror={mySlot === 1}
              actionFor={actionFor}
            />
            {touch && setup.localSlots.length === 1 ? (
              <TouchControls
                manager={input}
                slot={setup.localSlots[0]!}
                loadout={seatLoadouts[setup.localSlots[0]!] ?? DEFAULT_LOADOUT}
              />
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
        {!started && !online ? (
          <ReadyGate
            mode={mode}
            onStart={start}
            onExit={exit}
            touch={touch}
            inputMode={inputMode}
            onInputMode={setInputMode}
            cameraReady={cameraReady}
          />
        ) : null}
        {inputMode === 'camera' && setup.localSlots.length === 1 ? (
          <CameraControl
            slot={setup.localSlots[0]!}
            manager={manager}
            loadout={seatLoadouts[setup.localSlots[0]!] ?? DEFAULT_LOADOUT}
            paused={paused || matchEnd !== null || (online ? inLobby : !started)}
            onFallback={() => {
              setCameraReady(false);
              setInputMode(fallbackMode);
            }}
            onReady={setCameraReady}
          />
        ) : null}
        {online && inLobby ? (
          <OnlineLobby
            seat={online}
            ready={serverReady}
            inputMode={inputMode}
            onInputMode={setInputMode}
            onReady={setOnlineReady}
            onLeave={exit}
            cameraReady={cameraReady}
            loadout={loadout}
            onLoadout={(next) => useSettings.getState().set('loadout', next)}
          />
        ) : null}
        {online ? (
          <NetStatusOverlay mySlot={mySlot} onRetry={() => remote?.retry()} onLeave={exit} />
        ) : null}
        {paused ? (
          <PauseMenu
            onResume={() => togglePause(false)}
            onMenu={exit}
            onControls={onOpenControls}
            online={online !== null}
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
            {...(matchNote ? { note: matchNote } : {})}
            rematchDisabled={online !== null && rivalSeat !== undefined && !rivalSeat.connected}
          />
        ) : null}
        {devHud ? <DevHud client={client} /> : null}
        {online && (devHud || netPanel) ? (
          <NetPanel client={client} session={remote} slot={mySlot} />
        ) : null}
      </div>
    </GameClientProvider>
  );
}

/** Lives inside the Canvas so it can bind to the real canvas element and pump aim per frame. */
function InputBridge({
  seats,
  managerRef,
  session,
  onManager,
}: {
  seats: readonly SeatConfig[];
  managerRef: React.RefObject<InputManager | null>;
  session: React.RefObject<SessionDriver | null>;
  /** Adapters outside the canvas (camera) re-attach when the manager is replaced. */
  onManager: (m: InputManager | null) => void;
}) {
  const gl = useThree((s) => s.gl);
  const client = useGameClient();
  useEffect(() => {
    const m = new InputManager(seats, gl.domElement, (slot, intent) =>
      session.current?.sendIntent(slot, intent),
    );
    managerRef.current = m;
    onManager(m);
    return () => {
      m.dispose();
      managerRef.current = null;
      onManager(null);
    };
  }, [gl, seats, managerRef, session, onManager]);
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
  inputMode,
  onInputMode,
  cameraReady,
}: {
  mode: MatchMode;
  onStart: () => void;
  onExit: () => void;
  touch: boolean;
  inputMode: InputSource;
  onInputMode: (m: InputSource) => void;
  cameraReady: boolean;
}) {
  const loadout = useSettings((s) => s.loadout);
  const loadoutP2 = useSettings((s) => s.loadoutP2);
  const set = (key: 'loadout' | 'loadoutP2', v: [AdvancedAbilityId, AdvancedAbilityId]) =>
    useSettings.getState().set(key, v);
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
            <li>WET soaks the ground · HEAT sets a flame · your two picks below</li>
          </ul>
        ) : mode.kind === 'duel' ? (
          <div className="duel-keys">
            <div>
              <b>Player 1</b> WASD move · Space pulse · L-Shift lift · Q/E sweep · F guard · 1/2 wet
              /heat · 3/4 picks · mouse aims too
            </div>
            <div>
              <b>Player 2</b> Arrows/IJKL move · Enter pulse · R-Shift lift · , . sweep · / guard ·
              7/8 wet/heat · 9/0 picks
            </div>
          </div>
        ) : (
          <ul className="hints">
            <li>Mouse or WASD moves your force point · click / Space = PULSE</li>
            <li>Right mouse / Shift (hold) = LIFT · wheel / Q E = SWEEP · F = GUARD</li>
            <li>1 / R = WET · 2 / T = HEAT · 3 / C and 4 / V = your two picks</li>
            <li>Pulse pushes the core away from your force point — get behind it</li>
          </ul>
        )}
        {mode.kind === 'duel' ? (
          <div className="loadout-pair">
            <div>
              <div className="loadout-who">Player 1</div>
              <LoadoutPicker value={loadout} onChange={(v) => set('loadout', v)} />
            </div>
            <div>
              <div className="loadout-who">Player 2</div>
              <LoadoutPicker
                value={loadoutP2}
                onChange={(v) => set('loadoutP2', v)}
                testIdPrefix="loadout-p2"
              />
            </div>
          </div>
        ) : (
          <LoadoutPicker value={loadout} onChange={(v) => set('loadout', v)} />
        )}
        {mode.kind === 'bot' ? (
          <ControlChoice
            value={inputMode}
            touch={touch}
            onChange={onInputMode}
            cameraReady={cameraReady}
          />
        ) : null}
        <div className="row">
          <button
            className="btn primary big"
            onClick={onStart}
            data-testid="start-match"
            disabled={inputMode === 'camera' && !cameraReady}
            autoFocus
          >
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

/** Keyboard & mouse / touch / camera for the local player (camera opens its own setup). */
export function ControlChoice({
  value,
  touch,
  onChange,
  cameraReady,
  disabled = false,
}: {
  value: InputSource;
  touch: boolean;
  onChange: (m: InputSource) => void;
  cameraReady: boolean;
  disabled?: boolean;
}) {
  const options: [InputSource, string][] = [
    [touch ? 'touch' : 'keyboard', touch ? 'Touch' : 'Keyboard & mouse'],
    ['camera', cameraReady ? 'Camera ✓' : 'Camera'],
  ];
  return (
    <div className="seg control-choice" role="radiogroup" aria-label="Your controls">
      {options.map(([m, label]) => (
        <button
          key={m}
          role="radio"
          aria-checked={value === m}
          className={value === m ? 'on' : ''}
          disabled={disabled}
          onClick={() => onChange(m)}
          data-testid={`controls-${m}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
