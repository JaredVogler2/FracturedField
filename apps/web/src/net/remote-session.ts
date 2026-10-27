import { DEFAULT_RULES } from '@ff/game-data';
import type { ActionIntent, InputSource, PlayerSlot, ServerMessage } from '@ff/protocol';
import {
  RoomClient,
  type ClientClock,
  type ClientSocket,
  type RoomClientState,
} from '@ff/room-core/client';
import type { SeatLoadouts, SessionCallbacks, SessionDriver, TransportState } from './session';
import type { StoredSeat } from './seat-store';

/** Adapts the browser WebSocket to the transport-agnostic client socket. */
function browserSocket(url: string): ClientSocket {
  const ws = new WebSocket(url);
  const s: ClientSocket = {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => s.onopen?.();
  ws.onmessage = (ev: MessageEvent<unknown>) => {
    if (typeof ev.data === 'string') s.onmessage?.(ev.data);
  };
  // `error` is always followed by `close`, which carries the code.
  ws.onclose = (ev) => s.onclose?.(ev.code, ev.reason);
  return s;
}

const browserClock: ClientClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
};

const STATE_MAP: Record<RoomClientState, TransportState> = {
  idle: 'idle',
  connecting: 'connecting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  closed: 'closed',
  failed: 'error',
};

export interface RemoteSessionOptions {
  readonly seat: StoredSeat;
  readonly socketUrl: string;
  /** Called with every rotated seat ticket (persist it so a refresh resumes the seat). */
  readonly onTicket: (ticket: string) => void;
  /** A new connection replaced the old one (sequence restart; held actions were cancelled). */
  readonly onNewConnection?: () => void;
}

/**
 * Online play: the authority is the room's Durable Object. This client only sends intents and
 * renders the authoritative snapshots/events it receives; it never simulates outcomes.
 */
export class RemoteSession implements SessionDriver {
  readonly kind = 'remote' as const;
  readonly tickRate = DEFAULT_RULES.match.tickRate;
  readonly localSlots: readonly PlayerSlot[];
  readonly client: RoomClient;
  private started = false;
  private state: RoomClientState = 'idle';
  private detail: string | undefined;
  private lastRtt = 0;
  private statusTimer = 0;

  constructor(
    private readonly cb: SessionCallbacks,
    private readonly opts: RemoteSessionOptions,
  ) {
    this.localSlots = [opts.seat.slot];
    this.client = new RoomClient({
      url: opts.socketUrl,
      roomId: opts.seat.roomId,
      ticket: opts.seat.ticket,
      build: __BUILD_ID__.replace(/[^A-Za-z0-9_\-.+]/g, '').slice(0, 64),
      clock: browserClock,
      socketFactory: browserSocket,
      events: {
        onState: (state, detail) => {
          this.state = state;
          this.detail = detail;
          this.emitStatus();
        },
        onNewConnection: (welcome) => {
          this.opts.onTicket(welcome.resumeTicket);
          this.opts.onNewConnection?.();
          this.cb.onWelcome?.({
            slot: welcome.slot,
            roomCode: welcome.roomCode,
            tickRate: welcome.tickRate,
            snapshotRate: welcome.snapshotRate,
          });
        },
        onMessage: (msg) => this.route(msg),
      },
    });
  }

  private emitStatus(): void {
    this.lastRtt = this.client.stats.rttMs;
    this.cb.onStatus({
      state: STATE_MAP[this.state],
      kind: 'remote',
      ...(this.detail ? { detail: this.detail } : {}),
      rttMs: this.lastRtt,
    });
  }

  private route(msg: ServerMessage): void {
    const now = performance.now();
    switch (msg.t) {
      case 'snap':
        this.cb.onSnapshot(msg.s, now);
        break;
      case 'resync':
        if (this.cb.onResync) this.cb.onResync(msg.s, msg.reason, now);
        else this.cb.onSnapshot(msg.s, now);
        break;
      case 'events':
        this.cb.onEvents(msg.list);
        break;
      case 'ack':
        this.cb.onAck(this.opts.seat.slot, msg.r);
        break;
      case 'lobby':
        this.cb.onLobby?.(msg);
        break;
      case 'pause':
        this.cb.onPause?.(msg);
        break;
      case 'matchEnd':
        this.cb.onMatchEnd?.(msg);
        break;
      case 'error':
        if (!msg.fatal) console.warn(`[room] ${msg.code}: ${msg.message}`);
        break;
      case 'welcome':
      case 'pong':
        break;
    }
  }

  start(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.client.connect();
      // Keep the HUD's latency readout fresh without re-rendering on every PONG.
      this.statusTimer = window.setInterval(() => {
        if (Math.abs(this.client.stats.rttMs - this.lastRtt) > 5) this.emitStatus();
      }, 1000);
    }
    return Promise.resolve();
  }

  /** Retry after the connection gave up (state `error`). */
  retry(): void {
    this.client.connect();
  }

  sendIntent(slot: PlayerSlot, intent: ActionIntent): void {
    if (slot !== this.opts.seat.slot) return;
    this.client.sendIntent(intent);
  }

  setReady(ready: boolean, inputMode: InputSource, loadouts?: SeatLoadouts): void {
    this.client.setReady(ready, inputMode, loadouts?.[this.opts.seat.slot]);
  }

  requestRematch(): void {
    this.client.requestRematch(true);
  }

  leave(): void {
    this.client.leave();
  }

  dispose(): void {
    window.clearInterval(this.statusTimer);
    this.client.close();
  }
}
