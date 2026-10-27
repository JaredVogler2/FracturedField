import type {
  ActionResult,
  GameEvent,
  LobbyMessage,
  MatchEndMessage,
  PauseMessage,
  PlayerSlot,
  WorldSnapshot,
} from '@ff/protocol';
import { DEFAULT_RULES } from '@ff/game-data';
import { SnapshotBuffer } from './snapshot-buffer';
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

/**
 * Glue between a SessionDriver and presentation: buffers snapshots for interpolation, republishes
 * authoritative events, and throttles HUD store updates.
 */
export class GameClient implements SessionCallbacks {
  readonly buffer: SnapshotBuffer;
  readonly events = new Emitter<GameEvent>();
  readonly acks = new Emitter<{ slot: PlayerSlot; result: ActionResult }>();
  readonly matchEnds = new Emitter<MatchEndMessage>();
  session: SessionDriver | null = null;
  private lastHudUpdate = 0;
  private snapCounter = 0;
  private snapWindowStart = performance.now();

  constructor(delayTicks: number) {
    this.buffer = new SnapshotBuffer(1000 / DEFAULT_RULES.match.tickRate, delayTicks);
  }

  attach(session: SessionDriver): void {
    this.session = session;
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

  onEvents(list: readonly GameEvent[]): void {
    for (const e of list) this.events.emit(e);
    // Phase changes must reach the HUD immediately, not on the throttle.
    if (
      list.some(
        (e) =>
          e.type === 'phase' || e.type === 'goal' || e.type === 'roundEnd' || e.type === 'matchEnd',
      )
    ) {
      const latest = this.buffer.latest;
      if (latest) useHud.setState({ match: latest.match, players: latest.players });
      this.lastHudUpdate = 0;
    }
  }

  onAck(slot: PlayerSlot, result: ActionResult): void {
    this.acks.emit({ slot, result });
  }

  onStatus(status: TransportStatus): void {
    useHud.getState().setTransport(status);
  }

  onMatchEnd(end: MatchEndMessage): void {
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
    useHud.setState({ match: null, players: null, matchEnd: null, pause: null, lobby: null });
  }
}
