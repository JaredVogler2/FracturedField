import { DEFAULT_RULES, secondsToTicks, type GameRules } from '@ff/game-data';
import {
  PROTOCOL_VERSION,
  SIM_VERSION,
  checkCompatibility,
  decodeClientMessage,
  encodeMessage,
  type ActionResult,
  type ClientMessage,
  type CreateRoomResponse,
  type ErrorCode,
  type HelloMessage,
  type InputSource,
  type JoinRoomResponse,
  type LobbySeat,
  type PlayerSlot,
  type RoomInfoResponse,
  type RoomPhase,
  type ServerMessage,
} from '@ff/protocol';
import { GameWorld, type SeatResult } from '@ff/sim';
import { signTicket, verifyTicket } from './tickets.js';
import { cryptoRandom, newRoomId, newSeed, newSessionId, type RandomSource } from './ids.js';
import { TokenBucket } from './rate-limit.js';

/** Platform services injected by the adapter (Durable Object, Node server, tests). */
export interface RoomEnv {
  /** Wall clock (ms). Used for delivery, timeouts and ticket expiry — never for simulation. */
  now(): number;
  /** HMAC secret for seat tickets. */
  readonly secret: string;
  readonly random?: RandomSource;
  readonly rules?: GameRules;
  /** Persist minimal session state so a restarted host can rehydrate seats and tickets. */
  persist?(state: PersistedRoom): void | Promise<void>;
  /** Called whenever `wantsTicking` may have changed. */
  onTickingChange?(wantsTicking: boolean): void;
  /** Called after a connection is authenticated into a seat (adapters persist this on the socket). */
  onSeated?(connId: string, slot: PlayerSlot): void;
  log?(event: string, data?: Record<string, unknown>): void;
}

export interface RoomConnection {
  readonly id: string;
  send(data: string): void;
  close(code: number, reason: string): void;
}

interface SeatState {
  issued: boolean;
  /** Current ticket generation; the previous one is also accepted once (lost WELCOME). */
  nonce: number;
  ready: boolean;
  inputMode: InputSource | null;
  wantsRematch: boolean;
  conn: string | null;
  disconnectedAt: number | null;
}

interface ConnState {
  readonly conn: RoomConnection;
  readonly openedAt: number;
  slot: PlayerSlot | null;
  helloPending: boolean;
  readonly frames: TokenBucket;
  readonly intents: TokenBucket;
  violations: number;
  /** Frames dropped by the per-connection rate limit. */
  dropped: number;
}

export interface PersistedSeat {
  readonly issued: boolean;
  readonly nonce: number;
  readonly ready: boolean;
  readonly inputMode: InputSource | null;
}

export interface PersistedRoom {
  readonly v: 1;
  readonly roomId: string;
  readonly code: string;
  readonly seed: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly phase: RoomPhase;
  readonly seats: readonly [PersistedSeat, PersistedSeat];
}

export type SeatGrant =
  | { readonly ok: true; readonly response: CreateRoomResponse | JoinRoomResponse }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: ErrorCode;
      readonly message: string;
    };

/** Close codes used on the WebSocket (4000-4999 are application defined). */
export const CLOSE = {
  NORMAL: 1000,
  PROTOCOL: 4000,
  REPLACED: 4001,
  BAD_TICKET: 4003,
  TIMEOUT: 4008,
  ROOM_CLOSED: 4010,
  RATE: 4029,
} as const;

const HELLO_TIMEOUT_MS = 10_000;
const MAX_VIOLATIONS = 20;
const MAX_DROPPED_FRAMES = 300;

/**
 * One authoritative RIFTBALL room. Owns seats, tickets, connection lifecycle, the GameWorld and the
 * fixed tick. Transport-agnostic: adapters forward socket events and drive `tick()` at tickRate.
 */
export class RoomAuthority {
  readonly rules: GameRules;
  readonly roomId: string;
  readonly code: string;
  readonly seed: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  private phase: RoomPhase;
  private readonly seats: [SeatState, SeatState];
  private readonly conns = new Map<string, ConnState>();
  private world: GameWorld | null = null;
  private worldInit: Promise<GameWorld> | null = null;
  private snapshotDebt = 0;
  private pausedSlot: PlayerSlot | -1 = -1;
  private graceTicks = 0;
  private lastActivity: number;
  private readonly random: RandomSource;

  constructor(
    private readonly env: RoomEnv,
    init: PersistedRoom,
  ) {
    this.rules = env.rules ?? DEFAULT_RULES;
    this.random = env.random ?? cryptoRandom;
    this.roomId = init.roomId;
    this.code = init.code;
    this.seed = init.seed;
    this.createdAt = init.createdAt;
    this.expiresAt = init.expiresAt;
    // A live match that was lost to a host restart cannot resume mid-simulation (no checkpoint
    // yet): fall back to the lobby so both seats can ready up again.
    this.phase = init.phase === 'live' ? 'lobby' : init.phase;
    this.seats = [seatFrom(init.seats[0]), seatFrom(init.seats[1])];
    this.lastActivity = env.now();
  }

  /** Creates a brand-new room record for an invite code. */
  static newRecord(env: Pick<RoomEnv, 'now' | 'random' | 'rules'>, code: string): PersistedRoom {
    const now = env.now();
    const rules = env.rules ?? DEFAULT_RULES;
    const random = env.random ?? cryptoRandom;
    const emptySeat: PersistedSeat = { issued: false, nonce: 0, ready: false, inputMode: null };
    return {
      v: 1,
      roomId: newRoomId(random),
      code,
      seed: newSeed(random),
      createdAt: now,
      expiresAt: now + rules.network.roomTtlSeconds * 1000,
      phase: 'open',
      seats: [emptySeat, emptySeat],
    };
  }

  get roomPhase(): RoomPhase {
    return this.phase;
  }

  get wantsTicking(): boolean {
    return this.phase === 'live';
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  /** Exposed for diagnostics and tests (read-only use). */
  get gameWorld(): GameWorld | null {
    return this.world;
  }

  toPersisted(): PersistedRoom {
    return {
      v: 1,
      roomId: this.roomId,
      code: this.code,
      seed: this.seed,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
      phase: this.phase,
      seats: [persistSeat(this.seats[0]), persistSeat(this.seats[1])],
    };
  }

  private async save(): Promise<void> {
    await this.env.persist?.(this.toPersisted());
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Seat issuance (HTTP layer)                                                                */
  /* ---------------------------------------------------------------------------------------- */

  /** Issues the host seat (slot 0) exactly once. */
  async claimHostSeat(): Promise<SeatGrant> {
    return this.issueSeat(0);
  }

  /** Issues the guest seat (slot 1) exactly once; a third caller is refused. */
  async claimGuestSeat(): Promise<SeatGrant> {
    if (!this.seats[0].issued)
      return { ok: false, status: 404, error: 'room_not_found', message: 'room not open' };
    return this.issueSeat(1);
  }

  private async issueSeat(slot: PlayerSlot): Promise<SeatGrant> {
    const now = this.env.now();
    if (now >= this.expiresAt || this.phase === 'closed') {
      return { ok: false, status: 410, error: 'expired', message: 'room expired' };
    }
    const seat = this.seats[slot];
    if (seat.issued)
      return { ok: false, status: 409, error: 'room_full', message: 'seat already taken' };
    seat.issued = true;
    seat.nonce = 1;
    const ticket = await signTicket(this.env.secret, {
      r: this.roomId,
      s: slot,
      n: seat.nonce,
      e: this.expiresAt,
    });
    this.lastActivity = now;
    await this.save();
    this.env.log?.('seat_issued', { room: this.roomId, slot });
    return {
      ok: true,
      response: {
        roomId: this.roomId,
        code: this.code,
        slot,
        ticket,
        expiresAt: this.expiresAt,
        protocol: PROTOCOL_VERSION,
      },
    };
  }

  info(): RoomInfoResponse {
    return {
      code: this.code,
      phase: this.phase,
      seatsTaken: (this.seats[0].issued ? 1 : 0) + (this.seats[1].issued ? 1 : 0),
      protocol: PROTOCOL_VERSION,
    };
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Connections                                                                               */
  /* ---------------------------------------------------------------------------------------- */

  onOpen(conn: RoomConnection): void {
    const now = this.env.now();
    const net = this.rules.network;
    this.conns.set(conn.id, {
      conn,
      openedAt: now,
      slot: null,
      helloPending: false,
      // All frames (pings included) and intents are limited separately.
      frames: new TokenBucket(net.maxIntentsPerSecond * 1.5, net.intentBurst * 2, now),
      intents: new TokenBucket(net.maxIntentsPerSecond, net.intentBurst, now),
      violations: 0,
      dropped: 0,
    });
    this.lastActivity = now;
  }

  async onMessage(connId: string, raw: unknown): Promise<void> {
    const c = this.conns.get(connId);
    if (!c) return;
    const now = this.env.now();
    this.lastActivity = now;
    if (!c.frames.take(now)) {
      // Drop silently (replying to each frame would amplify a flood); notify sparingly and
      // disconnect only on sustained abuse.
      c.dropped++;
      if (c.dropped === 1 || c.dropped % 100 === 0) {
        this.sendTo(c, {
          t: 'error',
          code: 'rate_limited',
          message: 'too many frames',
          fatal: false,
        });
      }
      if (c.dropped > MAX_DROPPED_FRAMES) this.fatal(c, 'rate_limited', 'frame flood', CLOSE.RATE);
      return;
    }
    const decoded = decodeClientMessage(raw, this.rules.network.maxMessageBytes);
    if (!decoded.ok) {
      this.violation(c, 'bad_message', decoded.detail);
      return;
    }
    const msg = decoded.msg;
    if (msg.t === 'hello') {
      await this.onHello(c, msg);
      return;
    }
    if (msg.t === 'ping') {
      this.sendTo(c, { t: 'pong', seq: msg.seq, t0: msg.t0, t1: now });
      return;
    }
    if (c.slot === null) {
      this.violation(c, 'not_seated', 'HELLO required first');
      return;
    }
    this.onSeatedMessage(c, c.slot, msg);
  }

  /**
   * Re-registers an already authenticated socket after the host was evicted/hibernated while the
   * room was idle (not live). The socket's seat was persisted by the adapter at HELLO time.
   */
  async adoptConnection(conn: RoomConnection, slot: PlayerSlot): Promise<void> {
    this.onOpen(conn);
    const c = this.conns.get(conn.id);
    const seat = this.seats[slot];
    if (!c || !seat.issued) return;
    if (seat.conn && seat.conn !== conn.id) return;
    c.slot = slot;
    seat.conn = conn.id;
    seat.disconnectedAt = null;
    const world = await this.ensureWorld();
    world.setConnected(slot, true);
  }

  onClose(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    this.conns.delete(connId);
    const slot = c.slot;
    if (slot === null) return;
    const seat = this.seats[slot];
    if (seat.conn !== connId) return; // already replaced by a newer connection
    seat.conn = null;
    seat.disconnectedAt = this.env.now();
    this.world?.setConnected(slot, false);
    this.env.log?.('seat_disconnected', { room: this.roomId, slot });
    if (
      this.phase === 'live' &&
      this.world &&
      this.world.phase !== 'matchEnd' &&
      this.pausedSlot === -1
    ) {
      this.world.setPaused(true);
      this.pausedSlot = slot;
      this.graceTicks = secondsToTicks(
        this.rules.network.disconnectGraceSeconds,
        this.rules.match.tickRate,
      );
      this.broadcast({
        t: 'pause',
        paused: true,
        reason: 'disconnect',
        slot,
        graceTicks: this.graceTicks,
      });
    }
    this.broadcastLobby();
  }

  private async onHello(c: ConnState, msg: HelloMessage): Promise<void> {
    if (c.slot !== null || c.helloPending) {
      this.violation(c, 'bad_message', 'duplicate HELLO');
      return;
    }
    c.helloPending = true;
    const compat = checkCompatibility({ protocol: msg.protocol, sim: msg.sim });
    if (!compat.ok) {
      this.fatal(c, compat.reason, compat.detail, CLOSE.PROTOCOL);
      return;
    }
    if (msg.room !== this.roomId) {
      this.fatal(c, 'bad_ticket', 'ticket is not valid for this room', CLOSE.BAD_TICKET);
      return;
    }
    const payload = await verifyTicket(this.env.secret, msg.ticket, this.env.now());
    if (!this.conns.has(c.conn.id)) return; // closed while verifying
    if (!payload || payload.r !== this.roomId) {
      this.fatal(c, 'bad_ticket', 'invalid or expired seat ticket', CLOSE.BAD_TICKET);
      return;
    }
    const slot = payload.s;
    const seat = this.seats[slot];
    if (!seat.issued || (payload.n !== seat.nonce && payload.n !== seat.nonce - 1)) {
      this.fatal(c, 'bad_ticket', 'seat ticket was superseded', CLOSE.BAD_TICKET);
      return;
    }
    if (this.phase === 'closed') {
      this.fatal(c, 'expired', 'room closed', CLOSE.ROOM_CLOSED);
      return;
    }

    // Exactly one live connection per seat: a refresh replaces the old socket (no ghost seat).
    if (seat.conn && seat.conn !== c.conn.id) {
      const old = this.conns.get(seat.conn);
      if (old) {
        old.slot = null;
        this.conns.delete(seat.conn);
        old.conn.close(CLOSE.REPLACED, 'replaced by a newer connection');
      }
    }
    const resumed = seat.disconnectedAt !== null || seat.conn !== null;
    seat.nonce += 1; // rekey: the presented ticket generation can no longer be used twice
    seat.conn = c.conn.id;
    seat.disconnectedAt = null;
    c.slot = slot;
    c.helloPending = false;
    this.env.onSeated?.(c.conn.id, slot);
    const resumeTicket = await signTicket(this.env.secret, {
      r: this.roomId,
      s: slot,
      n: seat.nonce,
      e: this.expiresAt,
    });

    const world = await this.ensureWorld();
    if (!this.conns.has(c.conn.id)) return;
    world.setConnected(slot, true);
    world.resetSequence(slot);
    if (this.pausedSlot === slot) {
      this.pausedSlot = -1;
      world.setPaused(false);
      this.broadcast({ t: 'pause', paused: false, reason: 'resumed', slot, graceTicks: 0 });
    }
    if (this.phase === 'open' && this.seats[0].issued && this.seats[1].issued) this.phase = 'lobby';

    this.sendTo(c, {
      t: 'welcome',
      protocol: PROTOCOL_VERSION,
      sim: SIM_VERSION,
      slot,
      sessionId: newSessionId(this.random),
      roomId: this.roomId,
      roomCode: this.code,
      serverTick: world.tick,
      seed: this.seed,
      resumeTicket,
      tickRate: this.rules.match.tickRate,
      snapshotRate: this.rules.match.snapshotRate,
      arenaId: world.arena.id,
      resumed,
    });
    this.sendTo(c, { t: 'resync', reason: resumed ? 'resume' : 'join', s: world.snapshot() });
    this.broadcastLobby();
    this.env.log?.('seat_connected', { room: this.roomId, slot, resumed });
    await this.save();
  }

  private onSeatedMessage(c: ConnState, slot: PlayerSlot, msg: ClientMessage): void {
    const seat = this.seats[slot];
    const world = this.world;
    switch (msg.t) {
      case 'ready': {
        seat.ready = msg.ready;
        seat.inputMode = msg.inputMode;
        this.maybeStartMatch();
        this.broadcastLobby();
        void this.save();
        return;
      }
      case 'intent': {
        const now = this.env.now();
        if (!c.intents.take(now)) {
          if (msg.i.action !== 'aim')
            this.ack(c, {
              seq: msg.i.seq,
              accepted: false,
              reason: 'rate_limited',
              tick: world?.tick ?? 0,
            });
          return;
        }
        if (!world || this.phase !== 'live') {
          if (msg.i.action !== 'aim')
            this.ack(c, {
              seq: msg.i.seq,
              accepted: false,
              reason: 'not_playing',
              tick: world?.tick ?? 0,
            });
          return;
        }
        world.applyCommand(slot, msg.i);
        return;
      }
      case 'rematch': {
        seat.wantsRematch = msg.want;
        if (
          this.phase === 'ended' &&
          world &&
          this.seats[0].wantsRematch &&
          this.seats[1].wantsRematch
        ) {
          this.seats[0].wantsRematch = false;
          this.seats[1].wantsRematch = false;
          world.rematch();
          this.phase = 'live';
          this.snapshotDebt = 0;
          this.broadcast({ t: 'resync', reason: 'rematch', s: world.snapshot() });
          this.env.onTickingChange?.(true);
        }
        this.broadcastLobby();
        return;
      }
      case 'leave': {
        if (this.phase === 'live' && world && world.phase !== 'matchEnd') {
          world.forfeit(slot);
          this.finishMatch('forfeit');
        }
        c.conn.close(CLOSE.NORMAL, 'left');
        this.onClose(c.conn.id);
        return;
      }
      case 'hello':
      case 'ping':
        return; // handled earlier
    }
  }

  private maybeStartMatch(): void {
    if (this.phase !== 'lobby' || !this.world) return;
    const both = this.seats.every((s) => s.issued && s.conn !== null && s.ready);
    if (!both) return;
    this.world.startMatch();
    this.phase = 'live';
    this.snapshotDebt = 0;
    this.env.log?.('match_start', { room: this.roomId });
    this.env.onTickingChange?.(true);
  }

  private async ensureWorld(): Promise<GameWorld> {
    if (this.world) return this.world;
    this.worldInit ??= GameWorld.create({ seed: this.seed, rules: this.rules }).then((w) => {
      this.world = w;
      return w;
    });
    return this.worldInit;
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Fixed tick                                                                                */
  /* ---------------------------------------------------------------------------------------- */

  /** Advances the authoritative world one fixed step and fans out results. */
  tick(): void {
    const world = this.world;
    if (!world || this.phase !== 'live') return;

    if (this.pausedSlot !== -1) {
      this.graceTicks--;
      if (this.graceTicks % this.rules.match.tickRate === 0 && this.graceTicks > 0) {
        this.broadcast({
          t: 'pause',
          paused: true,
          reason: 'disconnect',
          slot: this.pausedSlot,
          graceTicks: this.graceTicks,
        });
      }
      if (this.graceTicks <= 0) {
        const loser = this.pausedSlot;
        this.pausedSlot = -1;
        world.setPaused(false);
        world.forfeit(loser);
        this.broadcast({
          t: 'pause',
          paused: false,
          reason: 'forfeit',
          slot: loser,
          graceTicks: 0,
        });
        this.finishMatch('forfeit');
        return;
      }
    }

    const result = world.stepFixed();
    if (result.results.length > 0) this.deliverResults(result.results);
    if (result.events.length > 0) {
      this.broadcast({ t: 'events', list: result.events });
    }

    this.snapshotDebt += this.rules.match.snapshotRate / this.rules.match.tickRate;
    if (this.snapshotDebt >= 1) {
      this.snapshotDebt -= 1;
      this.broadcast({ t: 'snap', s: world.snapshot(), st: this.env.now() });
    }

    if (world.phase === 'matchEnd') this.finishMatch('complete');
  }

  private finishMatch(reason: 'complete' | 'forfeit'): void {
    const world = this.world;
    if (!world || this.phase === 'ended') return;
    this.phase = 'ended';
    for (const s of this.seats) {
      s.ready = false;
      s.wantsRematch = false;
    }
    const summary = world.matchSummary;
    this.broadcast({ t: 'snap', s: world.snapshot(), st: this.env.now() });
    this.broadcast({
      t: 'matchEnd',
      winner: summary.winner ?? -1,
      score: summary.score,
      roundWins: summary.roundWins,
      seed: this.seed,
      digest: world.outcomeDigest(),
      reason,
    });
    this.broadcastLobby();
    this.env.log?.('match_end', { room: this.roomId, winner: summary.winner, reason });
    this.env.onTickingChange?.(false);
    void this.save();
  }

  /** Routes each intent outcome only to the seat that sent it. */
  private deliverResults(results: readonly SeatResult[]): void {
    for (const { slot, result } of results) {
      const connId = this.seats[slot].conn;
      const c = connId ? this.conns.get(connId) : undefined;
      if (c) this.ack(c, result);
    }
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Housekeeping                                                                              */
  /* ---------------------------------------------------------------------------------------- */

  /**
   * Periodic maintenance (adapter alarm, ~every 10 s): drops silent sockets, expires the room.
   * Returns true when the room is finished and its storage may be deleted.
   */
  housekeeping(): boolean {
    const now = this.env.now();
    for (const c of [...this.conns.values()]) {
      if (c.slot === null && now - c.openedAt > HELLO_TIMEOUT_MS) {
        this.conns.delete(c.conn.id);
        c.conn.close(CLOSE.TIMEOUT, 'HELLO timeout');
      }
    }
    const idleLimit = this.rules.network.lobbyIdleSeconds * 1000;
    const idle = this.conns.size === 0 && now - this.lastActivity > idleLimit;
    if (now >= this.expiresAt || (idle && this.phase !== 'live')) {
      this.close('room expired');
      return true;
    }
    return false;
  }

  /** Earliest time the adapter should call `housekeeping` again. */
  nextHousekeepingAt(): number {
    return Math.min(this.expiresAt, this.env.now() + 10_000);
  }

  close(reason: string): void {
    this.phase = 'closed';
    for (const c of this.conns.values()) {
      this.sendTo(c, { t: 'error', code: 'expired', message: reason, fatal: true });
      c.conn.close(CLOSE.ROOM_CLOSED, reason);
    }
    this.conns.clear();
    this.world?.dispose();
    this.world = null;
    this.worldInit = null;
    this.env.onTickingChange?.(false);
  }

  /* ---------------------------------------------------------------------------------------- */
  /* Messaging helpers                                                                         */
  /* ---------------------------------------------------------------------------------------- */

  private lobbyMessage(): ServerMessage {
    const seat = (slot: PlayerSlot): LobbySeat => {
      const s = this.seats[slot];
      return {
        slot,
        occupied: s.issued,
        connected: s.conn !== null,
        ready: s.ready,
        inputMode: s.inputMode,
        wantsRematch: s.wantsRematch,
      };
    };
    return { t: 'lobby', phase: this.phase, seats: [seat(0), seat(1)] };
  }

  private broadcastLobby(): void {
    this.broadcast(this.lobbyMessage());
  }

  private broadcast(msg: ServerMessage): void {
    const text = encodeMessage(msg);
    for (const c of this.conns.values()) {
      if (c.slot !== null) safeSend(c.conn, text);
    }
  }

  private sendTo(c: ConnState, msg: ServerMessage): void {
    safeSend(c.conn, encodeMessage(msg));
  }

  private ack(c: ConnState, r: ActionResult): void {
    this.sendTo(c, { t: 'ack', r });
  }

  private violation(c: ConnState, code: ErrorCode, message: string): void {
    c.violations++;
    this.sendTo(c, { t: 'error', code, message, fatal: false });
    if (c.violations > MAX_VIOLATIONS)
      this.fatal(c, code, 'too many invalid frames', CLOSE.PROTOCOL);
  }

  private fatal(c: ConnState, code: ErrorCode, message: string, closeCode: number): void {
    this.sendTo(c, { t: 'error', code, message, fatal: true });
    this.conns.delete(c.conn.id);
    c.conn.close(closeCode, message.slice(0, 120));
    this.env.log?.('connection_rejected', { room: this.roomId, code });
  }
}

function seatFrom(p: PersistedSeat): SeatState {
  return {
    issued: p.issued,
    nonce: p.nonce,
    ready: false,
    inputMode: p.inputMode,
    wantsRematch: false,
    conn: null,
    disconnectedAt: p.issued ? 0 : null,
  };
}

function persistSeat(s: SeatState): PersistedSeat {
  return { issued: s.issued, nonce: s.nonce, ready: s.ready, inputMode: s.inputMode };
}

function safeSend(conn: RoomConnection, text: string): void {
  try {
    conn.send(text);
  } catch {
    // Socket already closing; the close handler performs cleanup.
  }
}
