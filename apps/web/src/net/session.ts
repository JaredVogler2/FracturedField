import type { AdvancedAbilityId } from '@ff/game-data';
import type {
  ActionIntent,
  ActionResult,
  GameEvent,
  InputSource,
  LobbyMessage,
  MatchEndMessage,
  PauseMessage,
  PlayerSlot,
  ResyncMessage,
  WorldSnapshot,
} from '@ff/protocol';

/** Advanced-move picks per seat (only the caller's own seats are honoured). */
export type SeatLoadouts = Partial<
  Record<PlayerSlot, readonly [AdvancedAbilityId, AdvancedAbilityId]>
>;

export type TransportState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface TransportStatus {
  readonly state: TransportState;
  readonly kind: 'local' | 'remote';
  readonly detail?: string;
  /** Smoothed round-trip time (ms), remote only. */
  readonly rttMs?: number;
}

/** Everything the presentation layer needs from a session, independent of where authority runs. */
export interface SessionCallbacks {
  onSnapshot(snapshot: WorldSnapshot, receivedAt: number): void;
  /** Full-state resynchronisation (join, resume, rematch): discard interpolation history. */
  onResync?(snapshot: WorldSnapshot, reason: ResyncMessage['reason'], receivedAt: number): void;
  onEvents(events: readonly GameEvent[]): void;
  onAck(slot: PlayerSlot, result: ActionResult): void;
  onStatus(status: TransportStatus): void;
  onLobby?(lobby: LobbyMessage): void;
  onPause?(pause: PauseMessage): void;
  onMatchEnd?(end: MatchEndMessage): void;
  onWelcome?(info: {
    slot: PlayerSlot;
    roomCode: string;
    tickRate: number;
    snapshotRate: number;
  }): void;
}

/**
 * The single seam between game presentation and authority. LocalSession runs the shared
 * GameWorld in-browser (practice / same-device duel); RemoteSession talks to the authoritative
 * room over WebSocket. UI, input and rendering never know which one is active.
 */
export interface SessionDriver {
  readonly kind: 'local' | 'remote';
  /** Seats this client controls (both for a same-device local duel). */
  readonly localSlots: readonly PlayerSlot[];
  readonly tickRate: number;
  start(): Promise<void>;
  sendIntent(slot: PlayerSlot, intent: ActionIntent): void;
  /** `loadouts` = advanced-move picks per local seat, applied when the match starts. */
  setReady(ready: boolean, inputMode: InputSource, loadouts?: SeatLoadouts): void;
  requestRematch(): void;
  /** Local practice only: freeze the local authority (online matches never pause on request). */
  setPaused?(paused: boolean): void;
  /** Online only: leave the room (forfeits a live match). */
  leave?(): void;
  dispose(): void;
}
