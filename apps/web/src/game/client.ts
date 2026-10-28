import type {
  ActionResult,
  GameEvent,
  LobbyMessage,
  MatchEndMessage,
  PauseMessage,
  PlayerSlot,
  ResyncMessage,
  WorldSnapshot,
} from '@ff/protocol';
import { DEFAULT_RULES } from '@ff/game-data';
import { SnapshotBuffer, type RenderFrame } from './snapshot-buffer';
import { useHud } from './store';
import type { SessionCallbacks, SessionDriver, TransportStatus } from '../net/session';

type Listener<T> = (value: T) => void;

/** Tiny synchronous pub/sub for authoritative events (VFX, audio, HUD toasts). */
export class Emitter<T> {
  private readonly listeners = new Set<Listener<T>>();
  on(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(value: T): void {
    for (const fn of this.listeners) fn(value);
  }
}

export interface GameClientOptions {
  /** Interpolation delay in ticks (local authority: 1; remote: adaptive from ~3). */
  readonly delayTicks: number;
  /** Remote play: adapt the delay to measured jitter and release events on the render timeline. */
  readonly remote?: boolean;
  /** Wall-clock ms per tick (a slowed test authority); 1000 / tickRate by default. */
  readonly tickMs?: number;
  /** Run ahead of the newest snapshot (up to ~100 ms); false shows it exactly (Physics Lab). */
  readonly extrapolate?: boolean;
}

/** Events older than this are released even if no frame has been rendered (hidden tab). */
const EVENT_MAX_HOLD_MS = 400;
const HUD_EVENTS = new Set<GameEvent['type']>(['phase', 'goal', 'roundEnd', 'matchEnd']);

/**
 * Glue between a SessionDriver and presentation: buffers snapshots for interpolation, republishes
 * authoritative events, and throttles HUD store updates.
 */
export class GameClient implements SessionCallbacks {
  readonly buffer: SnapshotBuffer;
  readonly events = new Emitter<GameEvent>();
  readonly acks = new Emitter<{ slot: PlayerSlot; result: ActionResult }>();
  readonly matchEnds = new Emitter<MatchEndMessage>();
  /** Fired when the authority restarts this seat's stream (new connection or rematch). */
  readonly resyncs = new Emitter<ResyncMessage['reason']>();
  session: SessionDriver | null = null;
  private lastHudUpdate = 0;
  private snapCounter = 0;
  private snapWindowStart = performance.now();
  private readonly remote: boolean;
  /** Remote events wait until the interpolated view reaches their tick. */
  private readonly held: { e: GameEvent; at: number }[] = [];

  constructor(opts: GameClientOptions | number) {
    const o = typeof opts === 'number' ? { delayTicks: opts } : opts;
    this.remote = o.remote ?? false;
    this.buffer = new SnapshotBuffer(o.tickMs ?? 1000 / DEFAULT_RULES.match.tickRate, o.delayTicks);
    if (o.extrapolate === false) this.buffer.maxExtrapolationTicks = 0;
    if (this.remote) {
      const spacing = DEFAULT_RULES.match.tickRate / DEFAULT_RULES.match.snapshotRate;
      this.buffer.adaptive = { min: spacing + 1, max: 9, base: spacing + 1.5 };
    }
  }

  attach(session: SessionDriver): void {
    this.session = session;
  }

  /** Samples the interpolated frame for rendering and releases events that are now due. */
  sample(now: number): RenderFrame {
    const frame = this.buffer.sample(now);
    if (this.held.length > 0) this.release(frame.tick, now);
    return frame;
  }

  private release(renderTick: number, now: number): void {
    let n = 0;
    while (n < this.held.length) {
      const h = this.held[n]!;
      if (h.e.tick > renderTick && now - h.at < EVENT_MAX_HOLD_MS) break;
      n++;
    }
    if (n === 0) return;
    this.publish(this.held.splice(0, n).map((h) => h.e));
  }

  private publish(list: readonly GameEvent[]): void {
    for (const e of list) this.events.emit(e);
    // Phase changes must reach the HUD immediately, not on the throttle.
    if (list.some((e) => HUD_EVENTS.has(e.type))) {
      const latest = this.buffer.latest;
      if (latest) useHud.setState({ match: latest.match, players: latest.players });
      this.lastHudUpdate = 0;
    }
  }

  onSnapshot(snapshot: WorldSnapshot, receivedAt: number): void {
    this.buffer.push(snapshot, receivedAt);
    this.snapCounter++;
    const now = performance.now();
    if (now - this.snapWindowStart >= 1000) {
      useHud.setState({
        snapshotsPerSecond: (this.snapCounter * 1000) / (now - this.snapWindowStart),
      });
      this.snapCounter = 0;
      this.snapWindowStart = now;
    }
    // Safety valve for hidden tabs (no frames rendered): never sit on events for long.
    if (this.held.length > 0) this.release(-Infinity, now);
    if (now - this.lastHudUpdate > 66) {
      this.lastHudUpdate = now;
      useHud.setState({
        match: snapshot.match,
        players: snapshot.players,
        serverTick: snapshot.tick,
        bodies: snapshot.entities.length,
      });
    }
  }

  onResync(snapshot: WorldSnapshot, reason: ResyncMessage['reason'], receivedAt: number): void {
    // A full state replaces history: interpolating from pre-gap snapshots would sweep bodies.
    this.buffer.clear();
    this.held.length = 0;
    this.onSnapshot(snapshot, receivedAt);
    useHud.setState({ match: snapshot.match, players: snapshot.players });
    this.resyncs.emit(reason);
  }

  onEvents(list: readonly GameEvent[]): void {
    if (!this.remote) {
      this.publish(list);
      return;
    }
    const now = performance.now();
    for (const e of list) this.held.push({ e, at: now });
  }

  onAck(slot: PlayerSlot, result: ActionResult): void {
    this.acks.emit({ slot, result });
  }

  onStatus(status: TransportStatus): void {
    useHud.getState().setTransport(status);
  }

  onMatchEnd(end: MatchEndMessage): void {
    // Let any held events (the final goal) play before the result panel.
    if (this.held.length > 0) this.publish(this.held.splice(0).map((h) => h.e));
    useHud.setState({ matchEnd: end });
    this.matchEnds.emit(end);
  }

  onLobby(lobby: LobbyMessage): void {
    useHud.setState({ lobby });
  }

  onPause(pause: PauseMessage): void {
    useHud.setState({ pause: pause.paused ? pause : null });
  }

  onWelcome(info: {
    slot: PlayerSlot;
    roomCode: string;
    tickRate: number;
    snapshotRate: number;
  }): void {
    useHud.setState({ mySlot: info.slot, roomCode: info.roomCode });
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
    this.buffer.clear();
    this.held.length = 0;
    useHud.setState({
      match: null,
      players: null,
      matchEnd: null,
      pause: null,
      lobby: null,
      roomCode: null,
      mySlot: null,
    });
  }
}
