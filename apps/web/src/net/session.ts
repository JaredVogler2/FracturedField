import type {
  ActionIntent,
  ActionResult,
  GameEvent,
  InputSource,
  LobbyMessage,
  MatchEndMessage,
  PauseMessage,
  PlayerSlot,
  WorldSnapshot,
} from '@ff/protocol';

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
  setReady(ready: boolean, inputMode: InputSource): void;
  requestRematch(): void;
  dispose(): void;
}
