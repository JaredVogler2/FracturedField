import { isRoomCode, type PlayerSlot } from '@ff/protocol';
import type { SeatGrant } from './room-api';

/**
 * A seat this tab holds. Kept in sessionStorage (per tab, never sent anywhere but the room
 * service) so a page refresh resumes the same seat instead of creating a ghost player.
 */
export interface StoredSeat {
  readonly code: string;
  readonly roomId: string;
  readonly slot: PlayerSlot;
  readonly ticket: string;
  readonly expiresAt: number;
}

const key = (code: string) => `ff.seat.${code}`;

export function seatFromGrant(g: SeatGrant): StoredSeat {
  return { code: g.code, roomId: g.roomId, slot: g.slot, ticket: g.ticket, expiresAt: g.expiresAt };
}

export function saveSeat(seat: StoredSeat): void {
  try {
    sessionStorage.setItem(key(seat.code), JSON.stringify(seat));
  } catch {
    // storage disabled: refresh-resume is unavailable, play still works
  }
}

export function loadSeat(code: string): StoredSeat | null {
  if (!isRoomCode(code)) return null;
  try {
    const raw = sessionStorage.getItem(key(code));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSeat>;
    if (
      s.code !== code ||
      typeof s.roomId !== 'string' ||
      (s.slot !== 0 && s.slot !== 1) ||
      typeof s.ticket !== 'string' ||
      typeof s.expiresAt !== 'number' ||
      s.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(key(code));
      return null;
    }
    return s as StoredSeat;
  } catch {
    return null;
  }
}

/** The room rotates the seat ticket on every WELCOME; keep the newest one for refreshes. */
export function updateSeatTicket(seat: StoredSeat, ticket: string): StoredSeat {
  const next = { ...seat, ticket };
  saveSeat(next);
  return next;
}

export function forgetSeat(code: string): void {
  try {
    sessionStorage.removeItem(key(code));
  } catch {
    // ignore
  }
}
