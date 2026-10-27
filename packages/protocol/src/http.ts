import * as v from 'valibot';
import type { PlayerSlot } from './types.js';
import type { RoomPhase } from './messages.js';

/** Human-friendly invite code alphabet: no 0/O, 1/I/L, or vowels that spell words. */
export const ROOM_CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
export const ROOM_CODE_LENGTH = 6;
export const RoomCodeSchema = v.pipe(
  v.string(),
  v.length(ROOM_CODE_LENGTH),
  v.regex(/^[23456789BCDFGHJKMNPQRSTVWXYZ]+$/),
);

export function normalizeRoomCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

export function isRoomCode(input: string): boolean {
  return v.is(RoomCodeSchema, input);
}

/** POST /api/rooms */
export interface CreateRoomResponse {
  readonly roomId: string;
  readonly code: string;
  readonly slot: PlayerSlot;
  readonly ticket: string;
  readonly expiresAt: number;
  readonly protocol: number;
}

/** POST /api/rooms/:code/join */
export interface JoinRoomResponse {
  readonly roomId: string;
  readonly code: string;
  readonly slot: PlayerSlot;
  readonly ticket: string;
  readonly expiresAt: number;
  readonly protocol: number;
}

/** GET /api/rooms/:code */
export interface RoomInfoResponse {
  readonly code: string;
  readonly phase: RoomPhase;
  readonly seatsTaken: number;
  readonly protocol: number;
}

export interface ApiErrorResponse {
  readonly error: string;
  readonly message: string;
}

const SeatResponseSchema = v.object({
  roomId: v.pipe(v.string(), v.regex(/^[a-f0-9]{32}$/)),
  code: RoomCodeSchema,
  slot: v.picklist([0, 1] as const),
  ticket: v.pipe(v.string(), v.maxLength(600)),
  expiresAt: v.pipe(v.number(), v.finite()),
  protocol: v.pipe(v.number(), v.integer()),
});

export function parseSeatResponse(data: unknown): CreateRoomResponse | null {
  const r = v.safeParse(SeatResponseSchema, data);
  return r.success ? r.output : null;
}
