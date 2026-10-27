import type { AdvancedAbilityId } from '@ff/game-data';
import {
  IDLE_PING_FRAME,
  PROTOCOL_VERSION,
  SIM_VERSION,
  decodeServerMessage,
  encodeMessage,
  type ActionIntent,
  type ClientMessage,
  type InputSource,
  type IntentMessage,
  type PlayerSlot,
  type RoomPhase,
  type ServerMessage,
  type WelcomeMessage,
} from '@ff/protocol';
import { CLOSE } from './close-codes.js';

/** Minimal socket surface (browser WebSocket, Node WebSocket, or a simulated link in tests). */
export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
}

export type SocketFactory = (url: string) => ClientSocket;

export interface ClientClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export type RoomClientState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'failed';

export interface RoomClientEvents {
  onMessage(msg: ServerMessage, receivedAt: number): void;
  onState(state: RoomClientState, detail?: string): void;
  /** A new connection replaced the old one: intent sequence numbers restart at 0. */
  onNewConnection?(welcome: WelcomeMessage): void;
}

export interface RoomClientTimings {
  /** Ping cadence while a match is live (keeps RTT fresh; the room is awake anyway). */
  readonly livePingMs: number;
  /** Ping cadence in lobby / after the match (lets an idle room hibernate between pings). */
  readonly idlePingMs: number;
  /** No message for this long during a live match (20 Hz snapshots) = connection stalled. */
  readonly liveStaleMs: number;
  /** No message for this long outside a live match (pongs only) = connection stalled. */
  readonly idleStaleMs: number;
  /** Socket opened but no WELCOME within this time = give up on this attempt. */
  readonly connectTimeoutMs: number;
  /** Stop reconnecting after this long (the server's disconnect grace is 30 s). */
  readonly reconnectWindowMs: number;
}

export const DEFAULT_CLIENT_TIMINGS: RoomClientTimings = {
  livePingMs: 1000,
  idlePingMs: 5000,
  liveStaleMs: 4000,
  idleStaleMs: 15_000,
  connectTimeoutMs: 8000,
  reconnectWindowMs: 28_000,
};

export interface RoomClientOptions {
  /** Full WebSocket URL of the room (e.g. wss://rooms.example/ws/BCDFGH). */
  readonly url: string;
  readonly roomId: string;
  readonly ticket: string;
  readonly build: string;
  readonly clock: ClientClock;
  readonly socketFactory: SocketFactory;
  readonly events: RoomClientEvents;
  readonly timings?: Partial<RoomClientTimings>;
}

export interface RoomClientStats {
  rttMs: number;
  jitterMs: number;
  /** serverTime ≈ clientTime + offset (from PONG midpoints). */
  clockOffsetMs: number;
  reconnects: number;
  lastServerTick: number;
  messagesIn: number;
  bytesIn: number;
  intentsSent: number;
  lastMessageAt: number;
}

/** Close codes after which reconnecting cannot succeed (or would fight another tab). */
const FATAL_CLOSE = new Set<number>([
  CLOSE.PROTOCOL,
  CLOSE.REPLACED,
  CLOSE.BAD_TICKET,
  CLOSE.ROOM_CLOSED,
  CLOSE.RATE,
]);

const HEARTBEAT_MS = 500;

/**
 * Client half of the room protocol, transport- and runtime-agnostic. Handles the HELLO handshake,
 * stores the rotated resume ticket, measures RTT/jitter/clock offset, detects stalled connections,
 * and reconnects with backoff within the server's grace window. Never sends gameplay truth — only
 * intents.
 */
export class RoomClient {
  private socket: ClientSocket | null = null;
  private ticket: string;
  private state: RoomClientState = 'idle';
  private heartbeat: unknown = null;
  private retryTimer: unknown = null;
  /** Live pings count from 1; seq 0 is reserved for the fixed idle keep-alive frame. */
  private pingSeq = 1;
  private lastPingAt = 0;
  private openedAt = 0;
  private disconnectedAt = 0;
  private attempt = 0;
  private stopped = false;
  private welcomed = false;
  private fatalError: string | null = null;
  private readonly t: RoomClientTimings;
  slot: PlayerSlot | null = null;
  roomPhase: RoomPhase | null = null;
  readonly stats: RoomClientStats = {
    rttMs: 0,
    jitterMs: 0,
    clockOffsetMs: 0,
    reconnects: 0,
    lastServerTick: 0,
    messagesIn: 0,
    bytesIn: 0,
    intentsSent: 0,
    lastMessageAt: 0,
  };

  constructor(private readonly opts: RoomClientOptions) {
    this.ticket = opts.ticket;
    this.t = { ...DEFAULT_CLIENT_TIMINGS, ...opts.timings };
  }

  get connectionState(): RoomClientState {
    return this.state;
  }

  /** Latest seat credential (rotated on every WELCOME); persist it to survive a page refresh. */
  get resumeTicket(): string {
    return this.ticket;
  }

  private get live(): boolean {
    return this.roomPhase === 'live';
  }

  /** Starts (or, after `failed`, retries) the connection. */
  connect(): void {
    if (this.socket || this.retryTimer !== null) return;
    this.stopped = false;
    this.fatalError = null;
    this.disconnectedAt = 0;
    this.attempt = 0;
    this.open();
  }

  private setState(s: RoomClientState, detail?: string): void {
    this.state = s;
    this.opts.events.onState(s, detail);
  }

  private open(): void {
    this.setState(this.stats.reconnects > 0 || this.attempt > 0 ? 'reconnecting' : 'connecting');
    this.welcomed = false;
    let socket: ClientSocket;
    try {
      socket = this.opts.socketFactory(this.opts.url);
    } catch (e) {
      this.scheduleReconnect(`socket error: ${String(e)}`);
      return;
    }
    this.socket = socket;
    this.openedAt = this.opts.clock.now();
    this.startHeartbeat();
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.raw({
        t: 'hello',
        protocol: PROTOCOL_VERSION,
        sim: SIM_VERSION,
        build: this.opts.build,
        room: this.opts.roomId,
        ticket: this.ticket,
      });
    };
    socket.onmessage = (data) => {
      if (this.socket === socket) this.onData(data);
    };
    socket.onclose = (code, reason) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopHeartbeat();
      if (this.stopped) {
        this.setState('closed');
        return;
      }
      if (this.fatalError !== null || FATAL_CLOSE.has(code)) {
        this.stopped = true;
        this.setState('failed', this.fatalError ?? (reason || `closed ${code}`));
        return;
      }
      this.scheduleReconnect(reason || `connection lost (${code})`);
    };
  }

  /** Gives up on the current socket without waiting for its close event (stalled link). */
  private abandon(detail: string): void {
    const s = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    try {
      s?.close(CLOSE.TIMEOUT, detail);
    } catch {
      // already gone
    }
    if (!this.stopped) this.scheduleReconnect(detail);
  }

  private scheduleReconnect(detail: string): void {
    const now = this.opts.clock.now();
    if (this.disconnectedAt === 0) this.disconnectedAt = now;
    if (now - this.disconnectedAt > this.t.reconnectWindowMs) {
      this.stopped = true;
      this.setState('failed', `could not reconnect: ${detail}`);
      return;
    }
    this.attempt++;
    const delay = Math.min(4000, 250 * 2 ** Math.min(this.attempt - 1, 4));
    this.setState('reconnecting', detail);
    this.retryTimer = this.opts.clock.setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.open();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = this.opts.clock.setInterval(() => this.beat(), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) this.opts.clock.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private beat(): void {
    const now = this.opts.clock.now();
    if (!this.socket) return;
    if (!this.welcomed) {
      if (now - this.openedAt > this.t.connectTimeoutMs) this.abandon('connect timeout');
      return;
    }
    const stale = this.live ? this.t.liveStaleMs : this.t.idleStaleMs;
    if (now - this.stats.lastMessageAt > stale) {
      this.abandon('connection stalled');
      return;
    }
    if (now - this.lastPingAt >= (this.live ? this.t.livePingMs : this.t.idlePingMs)) {
      this.ping(now);
    }
  }

  private ping(now: number): void {
    this.lastPingAt = now;
    if (this.live) {
      this.raw({ t: 'ping', seq: this.pingSeq++, t0: now });
      return;
    }
    try {
      this.socket?.send(IDLE_PING_FRAME);
    } catch {
      // the heartbeat will notice a dead socket
    }
  }

  private onData(data: string): void {
    const now = this.opts.clock.now();
    this.stats.messagesIn++;
    this.stats.bytesIn += data.length;
    this.stats.lastMessageAt = now;
    const decoded = decodeServerMessage(data);
    if (!decoded.ok) return;
    const msg = decoded.msg;
    switch (msg.t) {
      case 'welcome':
        this.ticket = msg.resumeTicket;
        this.slot = msg.slot;
        this.welcomed = true;
        if (this.disconnectedAt !== 0) this.stats.reconnects++;
        this.disconnectedAt = 0;
        this.attempt = 0;
        this.setState('connected');
        this.opts.events.onNewConnection?.(msg);
        this.ping(now);
        break;
      case 'pong': {
        // Idle keep-alives (seq 0) may be answered by the host without a server timestamp.
        const idle = msg.seq === 0;
        const rtt = Math.max(0, now - (idle ? this.lastPingAt : msg.t0));
        const prev = this.stats.rttMs;
        this.stats.rttMs = prev === 0 ? rtt : prev * 0.8 + rtt * 0.2;
        if (prev !== 0)
          this.stats.jitterMs = this.stats.jitterMs * 0.8 + Math.abs(rtt - prev) * 0.2;
        if (!idle) {
          // Offset from the PONG midpoint (NTP-style, assuming symmetric paths).
          const offset = msg.t1 - (msg.t0 + rtt / 2);
          this.stats.clockOffsetMs =
            this.stats.clockOffsetMs === 0 ? offset : this.stats.clockOffsetMs * 0.9 + offset * 0.1;
        }
        break;
      }
      case 'lobby':
        this.roomPhase = msg.phase;
        break;
      case 'snap':
      case 'resync':
        this.stats.lastServerTick = msg.s.tick;
        break;
      case 'error':
        if (msg.fatal) this.fatalError = msg.message;
        break;
      default:
        break;
    }
    this.opts.events.onMessage(msg, now);
  }

  private raw(msg: ClientMessage): boolean {
    const s = this.socket;
    if (!s) return false;
    try {
      s.send(encodeMessage(msg));
      return true;
    } catch {
      return false;
    }
  }

  get isConnected(): boolean {
    return this.state === 'connected' && this.welcomed && this.socket !== null;
  }

  /** Sends an intent if the seat is connected. Intents are never queued across a disconnect. */
  sendIntent(intent: ActionIntent): boolean {
    if (!this.isConnected) return false;
    // The wire schema infers mutable tuples; copy out of the readonly domain type.
    const i: IntentMessage['i'] = {
      seq: intent.seq,
      clientTime: intent.clientTime,
      action: intent.action,
      phase: intent.phase,
      aim: [intent.aim[0], intent.aim[1]],
      intensity: intent.intensity,
      source: intent.source,
      ...(intent.dir ? { dir: [intent.dir[0], intent.dir[1]] as [number, number] } : {}),
      ...(intent.modifier !== undefined ? { modifier: intent.modifier } : {}),
    };
    const ok = this.raw({ t: 'intent', i });
    if (ok) this.stats.intentsSent++;
    return ok;
  }

  setReady(
    ready: boolean,
    inputMode: InputSource,
    loadout?: readonly [AdvancedAbilityId, AdvancedAbilityId],
  ): boolean {
    return (
      this.isConnected &&
      this.raw({
        t: 'ready',
        ready,
        inputMode,
        ...(loadout
          ? { loadout: [loadout[0], loadout[1]] as [AdvancedAbilityId, AdvancedAbilityId] }
          : {}),
      })
    );
  }

  requestRematch(want = true): boolean {
    return this.isConnected && this.raw({ t: 'rematch', want });
  }

  /** Leave intentionally (forfeits a live match) and close. */
  leave(): void {
    if (this.isConnected) this.raw({ t: 'leave' });
    this.close();
  }

  /** Drops the socket without leaving, as a network failure would (tests / diagnostics). */
  dropConnection(): void {
    if (this.socket) this.abandon('dropped');
  }

  close(): void {
    this.stopped = true;
    this.stopHeartbeat();
    if (this.retryTimer !== null) this.opts.clock.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const s = this.socket;
    this.socket = null;
    try {
      s?.close(CLOSE.NORMAL, 'bye');
    } catch {
      // already closed
    }
    if (this.state !== 'closed') this.setState('closed');
  }
}
