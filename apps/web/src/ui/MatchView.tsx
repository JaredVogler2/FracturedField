import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DEFAULT_LOADOUT, DEFAULT_RULES, type AdvancedAbilityId } from '@ff/game-data';
import type { PlayerSlot } from '@ff/protocol';
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
import { GameScene, type CameraOverride } from '../render/Scene';
import { InputManager, isControlActivation, type SeatConfig } from '../input/manager';
import { P1_BINDINGS, P2_BINDINGS, SOLO_BINDINGS, applyOverride } from '../input/bindings';
import {
  MODE_SOURCE,
  controlModes,
  defaultMode,
  detectCapabilities,
  type Capabilities,
  type ControlMode,
} from '../input/capabilities';
import { useEventAudio } from '../audio/event-audio';
import { sfx } from '../audio/sfx';
import { Hud, type HudSeat } from './Hud';
import { Banners, DenyToast, MatchEndPanel, PauseMenu } from './Overlays';
import { TouchControls } from './TouchControls';
import { LoadoutPicker, parseLoadout } from './Loadout';
import { CameraControl } from './camera/CameraControl';
import { ControlPicker } from './controls/ControlPicker';
import { ModeChip } from './controls/ModeChip';
import { MotionPanel } from './controls/MotionPanel';
import { GamepadNotice } from './controls/GamepadNotice';
import { NetStatusOverlay, OnlineLobby } from './Online';
import { teamOf } from './teams';
import { DevHud } from '../hud/DevHud';
import { NetPanel } from '../hud/NetPanel';
import { view } from '../render/view';
import { renderStats } from '../render/render-stats';
import { surfaceStats } from '../render/arena/surfaces';
import type { TierName } from '../render/adaptive-quality';
import type { LightVariantName } from '../render/art-tokens';

/**
 * ?test=1 only: what this device sent (source and action, never the aim), numbered so an E2E
 * check can look at what came after a point in time.
 */
const intentLog:
  { n: number; slot: number; source: string; action: string; phase: string }[] | null =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('test')
    ? []
    : null;
let intentCount = 0;

/** Named camera poses for the visual review loop (Phase 07, D07/D11): ?test=1&shot=NAME. */
const REVIEW_SHOTS = {
  /** Along the field from just above the near wall: both gates, the core, the storm beyond. */
  hero: { position: [-2, 7.5, 27], target: [2, 1.2, -2], fov: 58 },
  /** Close on the +X rift gate from the field. */
  gate: { position: [9, 3.2, 8.5], target: [21.5, 4.2, -0.5], fov: 50 },
  /** Over the broken rim: slabs, fragments, the underside and the distant formations. */
  rim: { position: [-14, 8, 44], target: [-16, -3, 20], fov: 50 },
  /** High and far: the whole platform in its storm. */
  wide: { position: [-48, 46, 62], target: [0, -4, 0], fov: 42 },
  /** Zoom crops for material review: wall blocks and slabs at a field corner. */
  stone: { position: [-16.5, 2.4, 18.5], target: [-19.5, 0.3, 14], fov: 38 },
  /** Brass and steel on a gate pylon. */
  brass: { position: [16.8, 2.6, 8.2], target: [21.4, 1.4, 4.6], fov: 34 },
  /** Under the rim: the stepped mass, the steel ribs, hanging fragments. */
  under: { position: [-34, -5, 44], target: [-8, -4, 8], fov: 48 },
  /** Behind the +X gate: the carved channel and its inlay, the gyroscope's hanger and axle. */
  channel: { position: [37, 7.5, 9], target: [25, 2.5, 0], fov: 50 },
} as const satisfies Record<string, CameraOverride>;

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

function setupFor(mode: MatchMode): ModeSetup {
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
        seats: [{ slot: 0, bindings: SOLO_BINDINGS, pointer: true, gamepad: true }],
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
          { slot: 0, bindings: P1_BINDINGS, pointer: true },
          { slot: 1, bindings: P2_BINDINGS, pointer: false },
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
        seats: [{ slot: me, bindings: SOLO_BINDINGS, pointer: true, gamepad: true }],
        hudSeats: [
          { slot: me, label: `YOU · ${teamOf(me).name}`, bindings: SOLO_BINDINGS, local: true },
          { slot: rival, label: `RIVAL · ${teamOf(rival).name}`, local: false },
        ],
        labels,
      };
    }
  }
}

/**
 * The mode a match opens in: the player's last choice when this device still offers it — except
 * motion, whose sensor permission needs a fresh tap (iOS), so it reopens as touch.
 */
function startingMode(saved: ControlMode | null, caps: Capabilities): ControlMode {
  const offered = (m: ControlMode) => controlModes(caps).some((o) => o.mode === m && o.available);
  if (saved === 'motion') return offered('touch') ? 'touch' : defaultMode(caps);
  return saved && offered(saved) ? saved : defaultMode(caps);
}

/**
 * One match (or the attract demo behind the menu): owns the GameClient, the local authority
 * worker and the input manager, and renders scene + HUD + overlays.
 */
/**
 * Test runs only (`?test=1&timescale=0.5`): the local authority's wall-clock speed. A scripted
 * stand-in whose every reaction goes through a software-rendered page reacts many times slower
 * than a person on a phone, while the bot reacts every tick; slowing the clock — never the rules
 * or the physics — keeps such a race about the input path instead of the test machine's speed.
 */
function testTimeScale(): number | undefined {
  const p = new URLSearchParams(window.location.search);
  if (!p.has('test')) return undefined;
  const v = Number.parseFloat(p.get('timescale') ?? '');
  return Number.isFinite(v) ? Math.min(1, Math.max(0.25, v)) : undefined;
}

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
  const caps = useMemo(() => detectCapabilities(), []);
  const touch = caps.touch;
  const setup = useMemo(() => setupFor(mode), [mode]);
  const online = mode.kind === 'online' ? mode.seat : null;
  const timeScale = useMemo(() => testTimeScale(), []);
  const client = useMemo(
    () =>
      new GameClient(
        online
          ? { delayTicks: 3, remote: true }
          : timeScale
            ? { delayTicks: 1, tickMs: 1000 / DEFAULT_RULES.match.tickRate / timeScale }
            : 1,
      ),
    [online, timeScale],
  );
  const session = useRef<SessionDriver | null>(null);
  const [remote, setRemote] = useState<RemoteSession | null>(null);
  const input = useRef<InputManager | null>(null);
  const [started, setStarted] = useState(mode.kind === 'attract');
  const [paused, setPaused] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const controls = useSettings((s) => s.controls);
  const bindingOverride = useSettings((s) => s.bindings);
  const [controlMode, setControlModeState] = useState<ControlMode>(() =>
    startingMode(useSettings.getState().controls.mode, caps),
  );
  const setControlMode = useCallback((m: ControlMode) => {
    setControlModeState(m);
    const s = useSettings.getState();
    s.set('controls', { ...s.controls, mode: m });
  }, []);
  // What READY reports for the chosen mode (the authority treats them all alike).
  const inputMode = MODE_SOURCE[controlMode];
  const [manager, setManager] = useState<InputManager | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const fallbackMode: ControlMode = touch ? 'touch' : 'desktop';
  const soloSlot = setup.localSlots.length === 1 ? setup.localSlots[0]! : null;
  const soloBindings = useMemo(
    () => applyOverride(SOLO_BINDINGS, bindingOverride),
    [bindingOverride],
  );
  const motionCfg = useMemo(
    () => ({ style: controls.motionStyle, sensitivity: controls.motionSensitivity }),
    [controls.motionStyle, controls.motionSensitivity],
  );
  // A replaced manager starts in the current mode (its first intents already carry its source).
  const modeRef = useRef(controlMode);
  // Hot-swap the seat's adapters (never recreate the manager: its intent stream continues).
  useEffect(() => {
    modeRef.current = controlMode;
    if (manager && soloSlot !== null) manager.setMode(soloSlot, controlMode, motionCfg);
  }, [manager, soloSlot, controlMode, motionCfg]);
  useEffect(() => {
    if (manager && soloSlot !== null) manager.motion(soloSlot)?.configure(motionCfg);
  }, [manager, soloSlot, motionCfg]);
  useEffect(() => {
    if (manager && soloSlot !== null) manager.setBindings(soloSlot, soloBindings);
  }, [manager, soloSlot, soloBindings]);
  const matchEnd = useHud((s) => s.matchEnd);
  const phase = useHud((s) => s.match?.phase);
  const lobby = useHud((s) => s.lobby);
  const netPanel = useMemo(() => new URLSearchParams(window.location.search).has('net'), []);
  const quality = useSettings((s) => s.quality);
  // ?test=1&shot=NAME: a fixed cinematic camera for golden screenshots (visual review only).
  const reviewShot = useMemo(() => {
    const p = new URLSearchParams(window.location.search);
    const name = p.get('shot');
    return p.has('test') && name && name in REVIEW_SHOTS
      ? REVIEW_SHOTS[name as keyof typeof REVIEW_SHOTS]
      : null;
  }, []);
  const qualityOverride = useMemo(() => {
    const q = new URLSearchParams(window.location.search).get('quality');
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  }, []);
  // Test-only: the D08 lighting comparison variants, and opting a test run into adaptation
  // (otherwise test runs keep a fixed tier, so they stay reproducible).
  const testParams = useMemo((): {
    test: boolean;
    adaptive: boolean;
    light: LightVariantName | undefined;
  } => {
    const p = new URLSearchParams(window.location.search);
    const light = p.get('light');
    return {
      test: p.has('test'),
      adaptive: p.get('adaptive') === '1',
      light: light === 'flat' || light === 'dark' || light === 'final' ? light : undefined,
    };
  }, []);
  // The adapted tier is remembered with the base tier it started from: a new base starts over.
  const [adapted, setAdapted] = useState<{ base: string; tier: TierName } | null>(null);
  const baseQuality = qualityOverride ?? resolveQuality(quality);
  const adaptive =
    quality === 'auto' && !qualityOverride && (!testParams.test || testParams.adaptive);
  const effectiveQuality = adaptive && adapted?.base === baseQuality ? adapted.tier : baseQuality;
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
      intents: () => [...(intentLog ?? [])],
      slot: () => useHud.getState().mySlot,
      transport: () => useHud.getState().transport.state,
      lobby: () => useHud.getState().lobby,
      matchEnd: () => useHud.getState().matchEnd,
      // Renderer counters (all passes of the last frame) and texture-generation cost at load.
      renderStats: () => ({ ...renderStats, surfaces: { ...surfaceStats } }),
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
        ...(timeScale !== undefined ? { timeScale } : {}),
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
  }, [client, setup, mode.kind, online, fast, seed, timeScale]);

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
        (e.code === 'Space' || e.code === 'Enter') &&
        // A control reached with the keyboard (a mode, a pick) handles its own Enter / Space.
        !isControlActivation(e)
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
        let seat: HudSeat = picks ? { ...h, loadout: picks } : h;
        // A single local player sees key hints only when playing with the keyboard.
        if (h.local && h.slot === soloSlot) {
          const { bindings: _hints, ...rest } = seat;
          seat = controlMode === 'desktop' ? { ...rest, bindings: soloBindings } : rest;
        }
        return seat;
      }),
    [setup.hudSeats, seatLoadouts, rivalLoadout, soloSlot, controlMode, soloBindings],
  );
  const serverReady = online ? (lobby?.seats[mySlot].ready ?? started) : started;
  // On-screen thumb controls (touch, motion, simplified): the HUD and camera make room for them.
  const touchUi =
    soloSlot !== null &&
    mode.kind !== 'attract' &&
    (controlMode === 'touch' || controlMode === 'motion' || controlMode === 'accessible');
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
      <div className={`stage${touchUi ? ` touch-ui hand-${controls.hand}` : ''}`}>
        <GameScene
          quality={effectiveQuality}
          textureTier={baseQuality}
          {...(adaptive
            ? { onAdapt: (tier: TierName) => setAdapted({ base: baseQuality, tier }) }
            : {})}
          {...(testParams.test && testParams.light ? { light: testParams.light } : {})}
          localSlots={setup.localSlots}
          side={mySlot === 1 ? -1 : 1}
          portraitSlot={mySlot}
          controlsSide={touchUi ? controls.hand : null}
          {...(reviewShot ? { camera: reviewShot } : {})}
        >
          {setup.seats.length > 0 ? (
            <InputBridge
              seats={seats}
              startMode={modeRef}
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
            {touchUi && soloSlot !== null ? (
              <TouchControls
                manager={input}
                slot={soloSlot}
                loadout={seatLoadouts[soloSlot] ?? DEFAULT_LOADOUT}
                hand={controls.hand}
                sticky={controlMode === 'accessible' || controls.sticky}
                simplified={controlMode === 'accessible'}
                denied={denied}
              />
            ) : null}
            {soloSlot !== null && controlMode === 'motion' ? (
              <MotionPanel
                onRecenter={() => manager?.motion(soloSlot)?.recenter()}
                onUseTouch={() => setControlMode('touch')}
              />
            ) : null}
            {soloSlot !== null ? <GamepadNotice /> : null}
            {soloSlot !== null && (started || (online !== null && !inLobby)) ? (
              <ModeChip
                caps={caps}
                mode={controlMode}
                onChange={setControlMode}
                cameraReady={cameraReady}
              />
            ) : null}
            {touch ? (
              <div className="rotate-hint" aria-hidden="true">
                Rotate your phone for the full arena
              </div>
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
            caps={caps}
            controlMode={controlMode}
            onControlMode={setControlMode}
            cameraReady={cameraReady}
          />
        ) : null}
        {controlMode === 'camera' && soloSlot !== null ? (
          <CameraControl
            slot={soloSlot}
            manager={manager}
            loadout={seatLoadouts[soloSlot] ?? DEFAULT_LOADOUT}
            paused={paused || matchEnd !== null || (online ? inLobby : !started)}
            onFallback={() => {
              setCameraReady(false);
              setControlMode(fallbackMode);
            }}
            onReady={setCameraReady}
          />
        ) : null}
        {online && inLobby ? (
          <OnlineLobby
            seat={online}
            ready={serverReady}
            caps={caps}
            controlMode={controlMode}
            onControlMode={setControlMode}
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
  startMode,
  managerRef,
  session,
  onManager,
}: {
  seats: readonly SeatConfig[];
  /** The single local player's current control mode (shared-keyboard duel seats have none). */
  startMode: React.RefObject<ControlMode>;
  managerRef: React.RefObject<InputManager | null>;
  session: React.RefObject<SessionDriver | null>;
  /** Adapters outside the canvas (camera) re-attach when the manager is replaced. */
  onManager: (m: InputManager | null) => void;
}) {
  const gl = useThree((s) => s.gl);
  const client = useGameClient();
  useEffect(() => {
    const configs = seats.length === 1 ? [{ ...seats[0]!, mode: startMode.current }] : seats;
    const m = new InputManager(configs, gl.domElement, (slot, intent) => {
      if (intentLog) {
        const { source, action, phase } = intent;
        intentLog.push({ n: ++intentCount, slot, source, action, phase });
        if (intentLog.length > 600) intentLog.shift();
      }
      session.current?.sendIntent(slot, intent);
    });
    managerRef.current = m;
    onManager(m);
    return () => {
      m.dispose();
      managerRef.current = null;
      onManager(null);
    };
  }, [gl, seats, startMode, managerRef, session, onManager]);
  useFrame(() => {
    managerRef.current?.update(client.buffer.latest);
  });
  return null;
}

function ReadyGate({
  mode,
  onStart,
  onExit,
  caps,
  controlMode,
  onControlMode,
  cameraReady,
}: {
  mode: MatchMode;
  onStart: () => void;
  onExit: () => void;
  caps: Capabilities;
  controlMode: ControlMode;
  onControlMode: (m: ControlMode) => void;
  cameraReady: boolean;
}) {
  const loadout = useSettings((s) => s.loadout);
  const loadoutP2 = useSettings((s) => s.loadoutP2);
  const set = (key: 'loadout' | 'loadoutP2', v: [AdvancedAbilityId, AdvancedAbilityId]) =>
    useSettings.getState().set(key, v);
  // Focus START without scrolling the panel (on short phone screens that hid the title).
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    startRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="modal-backdrop soft">
      <div className="panel ready-gate" data-testid="ready-gate">
        <div className="me-eyebrow">
          {mode.kind === 'duel' ? 'LOCAL DUEL · SHARED SCREEN' : 'QUICK MATCH · VS BOT'}
        </div>
        <div className="me-title">Drive the Rift Core into the rival gate</div>
        {mode.kind !== 'duel' && controlMode === 'motion' ? (
          <ul className="hints">
            <li>Tilt your phone to move your force point · RECENTER re-zeroes it</li>
            <li>PULSE pushes the core away from your force point</li>
            <li>LIFT (hold) raises it · swipe the SWEEP pad for a crosswind · GUARD shields</li>
            <li>WET soaks the ground · HEAT sets a flame · your two picks below</li>
          </ul>
        ) : mode.kind !== 'duel' && (controlMode === 'touch' || controlMode === 'accessible') ? (
          <ul className="hints">
            <li>
              {controlMode === 'accessible'
                ? 'Tap the arena where your force point should go'
                : 'Drag on the arena to move your force point'}
            </li>
            <li>PULSE pushes the core away from your force point</li>
            <li>
              {controlMode === 'accessible'
                ? 'LIFT toggles on and off · SWEEP blows forward or swipe its pad · GUARD shields'
                : 'LIFT (hold) raises it · swipe the SWEEP pad for a crosswind · GUARD shields'}
            </li>
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
          <ControlPicker
            caps={caps}
            value={controlMode}
            onChange={onControlMode}
            cameraReady={cameraReady}
          />
        ) : null}
        <div className="row">
          <button
            className="btn primary big"
            onClick={onStart}
            data-testid="start-match"
            disabled={mode.kind === 'bot' && controlMode === 'camera' && !cameraReady}
            ref={startRef}
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
