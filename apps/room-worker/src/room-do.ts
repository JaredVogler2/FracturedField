import { DurableObject } from 'cloudflare:workers';
import {
  FixedRateLoop,
  RoomAuthority,
  newSessionId,
  type PersistedRoom,
  type RoomConnection,
  type SeatGrant,
} from '@ff/room-core';
import type { PlayerSlot, RoomInfoResponse } from '@ff/protocol';
import { ticketSecret, type Env } from './env.js';

interface SocketAttachment {
  readonly connId: string;
  readonly slot: PlayerSlot | null;
}

const STORAGE_KEY = 'room';
const HOUSEKEEPING_MS = 30_000;

/**
 * One Durable Object per invite code = one authoritative room. While a match is live a fixed-rate
 * loop ticks the shared GameWorld at 30 Hz (keeping the object resident); idle rooms rely on the
 * WebSocket Hibernation API and a housekeeping alarm, persisting only seat/ticket state.
 */
export class RoomDurableObject extends DurableObject<Env> {
  private room: RoomAuthority | null = null;
  private loop: FixedRateLoop | null = null;
  private readonly sockets = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const record = await ctx.storage.get<PersistedRoom>(STORAGE_KEY);
      if (record) {
        this.room = this.instantiate(record);
        await this.readoptSockets();
      }
    });
  }

  private instantiate(record: PersistedRoom): RoomAuthority | null {
    const secret = ticketSecret(this.env);
    if (!secret) return null;
    const room = new RoomAuthority(
      {
        now: () => Date.now(),
        secret,
        persist: async (state) => {
          await this.ctx.storage.put(STORAGE_KEY, state);
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

  async createRoom(code: string): Promise<SeatGrant> {
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
    const record = RoomAuthority.newRecord({ now: () => Date.now() }, code);
    await this.ctx.storage.put(STORAGE_KEY, record);
    this.room = this.instantiate(record);
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
