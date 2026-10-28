import {
  isRoomCode,
  normalizeRoomCode,
  parseSeatResponse,
  type CreateRoomResponse,
  type RoomInfoResponse,
} from '@ff/protocol';
import { awakeDeadline } from './awake-deadline';
import { roomServiceUrl } from './room-service';

/** A seat granted by the room service: public invite code + private seat ticket. */
export type SeatGrant = CreateRoomResponse;

export class RoomApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const FRIENDLY: Record<string, string> = {
  room_not_found: 'No room with that code. Check the code or ask for a new invite.',
  room_full: 'That room already has two players.',
  expired: 'That room has expired. Create a new one.',
  origin: 'This site is not allowed to use the room service.',
  server_error: 'The room service is unavailable. Try again in a moment.',
};

async function call(path: string, method: 'GET' | 'POST'): Promise<unknown> {
  const base = roomServiceUrl();
  if (!base) throw new RoomApiError('not_configured', 'Online play is not configured.', 0);
  const ctrl = new AbortController();
  // 8 s of waiting while the page is awake (a page busy compiling shaders must not abort a reply
  // that already arrived).
  const stop = awakeDeadline(8000, () => ctrl.abort());
  let res: Response;
  try {
    // No custom headers or body: a CORS "simple request" (no preflight round trip).
    res = await fetch(`${base}${path}`, { method, cache: 'no-store', signal: ctrl.signal });
  } catch {
    throw new RoomApiError('network', 'Could not reach the room service.', 0);
  } finally {
    stop();
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // fall through with null body
  }
  if (!res.ok) {
    const err = (body ?? {}) as { error?: unknown; message?: unknown };
    const code = typeof err.error === 'string' ? err.error : 'server_error';
    const fallback = typeof err.message === 'string' ? err.message : `HTTP ${res.status}`;
    throw new RoomApiError(code, FRIENDLY[code] ?? fallback, res.status);
  }
  return body;
}

function seat(body: unknown): SeatGrant {
  const parsed = parseSeatResponse(body);
  if (!parsed) throw new RoomApiError('bad_response', 'Unexpected reply from the room service.', 0);
  return parsed;
}

/** Creates a room and claims the host seat. `fast` requests short test rules (dev hosts only). */
export async function createRoom(opts: { fast?: boolean } = {}): Promise<SeatGrant> {
  return seat(await call(`/api/rooms${opts.fast ? '?rules=fast' : ''}`, 'POST'));
}

/** Claims the guest seat of an existing room. */
export async function joinRoom(rawCode: string): Promise<SeatGrant> {
  const code = normalizeRoomCode(rawCode);
  if (!isRoomCode(code)) {
    throw new RoomApiError('bad_code', 'Room codes are 6 letters and digits, like BCD234.', 0);
  }
  return seat(await call(`/api/rooms/${code}/join`, 'POST'));
}

export async function fetchRoomInfo(rawCode: string): Promise<RoomInfoResponse | null> {
  const code = normalizeRoomCode(rawCode);
  if (!isRoomCode(code)) return null;
  try {
    return (await call(`/api/rooms/${code}`, 'GET')) as RoomInfoResponse;
  } catch {
    return null;
  }
}
