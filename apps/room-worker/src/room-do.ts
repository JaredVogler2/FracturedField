import { DurableObject } from 'cloudflare:workers';
import type { RulesetId } from '@ff/game-data';
import {
  FixedRateLoop,
  RoomAuthority,
  newSessionId,
  type MatchCheckpoint,
  type PersistedRoom,
  type RoomConnection,
  type SeatGrant,
} from '@ff/room-core';
import {
  IDLE_PING_FRAME,
  IDLE_PONG_FRAME,
  type PlayerSlot,
  type RoomInfoResponse,
} from '@ff/protocol';
import { ticketSecret, type Env } from './env.js';

interface SocketAttachment {
  readonly connId: string;
  readonly slot: PlayerSlot | null;
}

const STORAGE_KEY = 'room';
const CHECKPOINT_KEY = 'checkpoint';
const HOUSEKEEPING_MS = 30_000;

/**
 * One Durable Object per invite code = one authoritative room. While a match is live a fixed-rate
 * loop ticks the shared GameWorld at 30 Hz (keeping the object resident); idle rooms rely on the
 * WebSocket Hibernation API and a housekeeping alarm, persisting seat/ticket state plus a ~14 KB
 * match checkpoint at every kickoff so a restarted object resumes a live match instead of losing it.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private room: RoomAuthority | null = null;
  private loop: FixedRateLoop | null = null;
  private readonly sockets = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Idle keep-alives are answered by the runtime without waking a hibernated room.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(IDLE_PING_FRAME, IDLE_PONG_FRAME),
    );
    void ctx.blockConcurrencyWhile(async () => {
      const record = await ctx.storage.get<PersistedRoom>(STORAGE_KEY);
      if (record) {
        const checkpoint = (await ctx.storage.get<MatchCheckpoint>(CHECKPOINT_KEY)) ?? null;
        this.room = await this.instantiate(record, checkpoint);
        await this.readoptSockets();
        // A match restored from its checkpoint waits (paused) for both seats on a running loop.
        if (this.room?.wantsTicking) this.setTicking(true);
      }
    });
  }

  private async instantiate(
    record: PersistedRoom,
    checkpoint: MatchCheckpoint | null,
  ): Promise<RoomAuthority | null> {
    const secret = ticketSecret(this.env);
    if (!secret) return null;
    const room = await RoomAuthority.rehydrate(
      {
        now: () => Date.now(),
        secret,
        persist: async (state) => {
          await this.ctx.storage.put(STORAGE_KEY, state);
        },
        persistCheckpoint: async (cp) => {
          if (cp) await this.ctx.storage.put(CHECKPOINT_KEY, cp);
          else await this.ctx.storage.delete(CHECKPOINT_KEY);
        },
        onTickingChange: (want) => this.setTicking(want),
        onSeated: (connId, slot) => {
          const ws = this.sockets.get(connId);
          ws?.serializeAttachment({ connId, slot } satisfies SocketAttachment);
        },
        log: (event, data) => {
          console.log(JSON.stringify({ event, ...data }));
        },
      },
      record,
      checkpoint,
    );
    this.loop = new FixedRateLoop(
      {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => {
          clearTimeout(h as ReturnType<typeof setTimeout>);
        },
      },
      room.rules.match.tickRate,
      () => room.tick(),
    );
    return room;
  }

  /** After hibernation the object is rebuilt; sockets survive and carry their seat attachment. */
  private async readoptSockets(): Promise<void> {
    const room = this.room;
    if (!room) return;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null;
      if (!att) continue;
      const conn = this.connection(att.connId, ws);
      this.sockets.set(att.connId, ws);
      if (att.slot === null) room.onOpen(conn);
      else await room.adoptConnection(conn, att.slot);
    }
  }

  private connection(connId: string, ws: WebSocket): RoomConnection {
    return {
      id: connId,
      send: (data) => ws.send(data),
      close: (code, reason) => {
        this.sockets.delete(connId);
        try {
          ws.close(code, reason);
        } catch {
          // already closed
        }
      },
    };
  }

  private setTicking(want: boolean): void {
    if (!this.loop) return;
    if (want) this.loop.startLoop();
    else this.loop.stop();
  }

  private async scheduleHousekeeping(): Promise<void> {
    const at = this.room
      ? Math.min(this.room.nextHousekeepingAt(), Date.now() + HOUSEKEEPING_MS)
      : null;
    if (at !== null) await this.ctx.storage.setAlarm(at);
  }

  /* ------------------------------- RPC (called by the router) ------------------------------- */

  async createRoom(code: string, ruleset: RulesetId = 'standard'): Promise<SeatGrant> {
    if (this.room && this.room.roomPhase !== 'closed') {
      return { ok: false, status: 409, error: 'seat_taken', message: 'code in use' };
    }
    const secret = ticketSecret(this.env);
    if (!secret)
      return {
        ok: false,
        status: 503,
        error: 'server_error',
        message: 'TICKET_SECRET not configured',
      };
    const record = RoomAuthority.newRecord({ now: () => Date.now() }, code, ruleset);
    await this.ctx.storage.delete(CHECKPOINT_KEY);
    await this.ctx.storage.put(STORAGE_KEY, record);
    this.room = await this.instantiate(record, null);
    if (!this.room)
      return { ok: false, status: 503, error: 'server_error', message: 'room unavailable' };
    const grant = await this.room.claimHostSeat();
    await this.scheduleHousekeeping();
    return grant;
  }

  async joinRoom(): Promise<SeatGrant> {
    if (!this.room)
      return { ok: false, status: 404, error: 'room_not_found', message: 'no such room' };
    return this.room.claimGuestSeat();
  }

  roomInfo(): RoomInfoResponse | null {
    return this.room ? this.room.info() : null;
  }

  /* ----------------------------------- WebSocket upgrade ------------------------------------ */

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 });
    if (!this.room || this.room.roomPhase === 'closed')
      return new Response('room not found', { status: 404 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connId = newSessionId();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connId, slot: null } satisfies SocketAttachment);
    this.sockets.set(connId, server);
    this.room.onOpen(this.connection(connId, server));
    await this.scheduleHousekeeping();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att || !this.room) {
      ws.close(4010, 'room unavailable');
      return;
    }
    this.sockets.set(att.connId, ws);
    await this.room.onMessage(att.connId, message);
  }

  override webSocketClose(ws: WebSocket): void {
    this.handleSocketGone(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.handleSocketGone(ws);
  }

  private handleSocketGone(ws: WebSocket): void {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att) return;
    this.sockets.delete(att.connId);
    this.room?.onClose(att.connId);
  }

  override async alarm(): Promise<void> {
    if (!this.room) return;
    const finished = this.room.housekeeping();
    if (finished) {
      this.loop?.stop();
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.scheduleHousekeeping();
  }
}
