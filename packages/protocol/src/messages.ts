import * as v from 'valibot';
import { ClientMessageSchema, type ClientMessage } from './schemas.js';
import type { ActionResult, GameEvent, InputSource, PlayerSlot, WorldSnapshot } from './types.js';

/** Session lifecycle of a room (the in-match phase lives in MatchSnapshot.phase). */
export const ROOM_PHASES = ['open', 'lobby', 'live', 'ended', 'closed'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

export const ERROR_CODES = [
  'bad_message',
  'protocol_mismatch',
  'sim_mismatch',
  'bad_ticket',
  'room_full',
  'room_not_found',
  'expired',
  'seat_taken',
  'rate_limited',
  'not_seated',
  'origin',
  'server_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface LobbySeat {
  readonly slot: PlayerSlot;
  readonly occupied: boolean;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly inputMode: InputSource | null;
  readonly wantsRematch: boolean;
  /** Advanced moves this seat picked (public: part of the strategy both players see). */
  readonly loadout: readonly string[] | null;
}

export interface WelcomeMessage {
  readonly t: 'welcome';
  readonly protocol: number;
  readonly sim: number;
  readonly slot: PlayerSlot;
  readonly sessionId: string;
  readonly roomId: string;
  readonly roomCode: string;
  readonly serverTick: number;
  readonly seed: number;
  /** Rotated on every successful HELLO; present it to resume the same seat after a drop. */
  readonly resumeTicket: string;
  readonly tickRate: number;
  readonly snapshotRate: number;
  readonly arenaId: string;
  readonly resumed: boolean;
}

export interface LobbyMessage {
  readonly t: 'lobby';
  readonly phase: RoomPhase;
  readonly seats: readonly [LobbySeat, LobbySeat];
}

export interface SnapshotMessage {
  readonly t: 'snap';
  readonly s: WorldSnapshot;
  /** Server wall clock in ms at send time (diagnostics / clock-offset estimate only). */
  readonly st: number;
}

export interface EventsMessage {
  readonly t: 'events';
  readonly list: readonly GameEvent[];
}

export interface AckMessage {
  readonly t: 'ack';
  readonly r: ActionResult;
}

export interface PongMessage {
  readonly t: 'pong';
  readonly seq: number;
  readonly t0: number;
  readonly t1: number;
}

export interface ResyncMessage {
  readonly t: 'resync';
  readonly reason: 'join' | 'resume' | 'gap' | 'rematch';
  readonly s: WorldSnapshot;
}

export interface PauseMessage {
  readonly t: 'pause';
  readonly paused: boolean;
  readonly reason: 'disconnect' | 'resumed' | 'forfeit';
  readonly slot: PlayerSlot | -1;
  /** Ticks remaining before the absent player forfeits. */
  readonly graceTicks: number;
}

export interface MatchEndMessage {
  readonly t: 'matchEnd';
  readonly winner: PlayerSlot | -1;
  readonly score: readonly [number, number];
  readonly roundWins: readonly [number, number];
  readonly seed: number;
  /** Hash of the authoritative final state for cross-client comparison. */
  readonly digest: string;
  readonly reason: 'complete' | 'forfeit';
}

export interface ErrorMessage {
  readonly t: 'error';
  readonly code: ErrorCode;
  readonly message: string;
  readonly fatal: boolean;
}

export type ServerMessage =
  | WelcomeMessage
  | LobbyMessage
  | SnapshotMessage
  | EventsMessage
  | AckMessage
  | PongMessage
  | ResyncMessage
  | PauseMessage
  | MatchEndMessage
  | ErrorMessage;

export type ServerMessageType = ServerMessage['t'];

export type DecodeResult<T> =
  | { readonly ok: true; readonly msg: T }
  | {
      readonly ok: false;
      readonly error: 'too_large' | 'binary' | 'json' | 'schema';
      readonly detail: string;
    };

/** UTF-8 byte length of a string, computed without allocation or platform globals. */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Decode and strictly validate an untrusted client frame. Size is checked before parsing so a
 * hostile peer cannot make the server parse megabytes of JSON.
 */
export function decodeClientMessage(raw: unknown, maxBytes: number): DecodeResult<ClientMessage> {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'binary', detail: 'binary frames are not accepted' };
  }
  if (raw.length > maxBytes || utf8Length(raw) > maxBytes) {
    return { ok: false, error: 'too_large', detail: `frame exceeds ${maxBytes} bytes` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'json', detail: 'malformed JSON' };
  }
  const result = v.safeParse(ClientMessageSchema, parsed);
  if (!result.success) {
    const first = result.issues[0];
    const path = first?.path?.map((p) => String(p.key)).join('.') ?? '';
    return {
      ok: false,
      error: 'schema',
      detail: `${path || 'message'}: ${first?.message ?? 'invalid'}`,
    };
  }
  return { ok: true, msg: result.output };
}

export function encodeMessage(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg);
}

/**
 * Fixed keep-alive frames used outside live play. The host may answer IDLE_PING with IDLE_PONG
 * itself (Cloudflare WebSocket auto-response) without waking a hibernated room; the client then
 * measures RTT from its own send time. Both are valid ordinary PING/PONG messages, so any host
 * that does not special-case them still answers correctly.
 */
export const IDLE_PING_FRAME = '{"t":"ping","seq":0,"t0":0}';
export const IDLE_PONG_FRAME = '{"t":"pong","seq":0,"t0":0,"t1":0}';

const SERVER_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  'welcome',
  'lobby',
  'snap',
  'events',
  'ack',
  'pong',
  'resync',
  'pause',
  'matchEnd',
  'error',
]);

/**
 * Client-side decode of server frames. The server is trusted for game truth, but the client
 * still refuses malformed frames instead of crashing the render loop.
 */
export function decodeServerMessage(raw: unknown): DecodeResult<ServerMessage> {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'binary', detail: 'binary frames are not expected' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'json', detail: 'malformed JSON' };
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('t' in parsed) ||
    typeof parsed.t !== 'string' ||
    !SERVER_TYPES.has(parsed.t)
  ) {
    return { ok: false, error: 'schema', detail: 'unknown server message type' };
  }
  return { ok: true, msg: parsed as ServerMessage };
}

/** Rounds to millimetre precision for compact snapshot encoding. */
export function q3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Rounds to 4 decimals (quaternion components). */
export function q4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Rounds to 2 decimals (a hand's grip, push and twist, which are only drawn). */
export function q2(n: number): number {
  return Math.round(n * 100) / 100;
}
