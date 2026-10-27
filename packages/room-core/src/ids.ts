import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@ff/protocol';

export type RandomSource = (bytes: number) => Uint8Array;

export const cryptoRandom: RandomSource = (bytes) => crypto.getRandomValues(new Uint8Array(bytes));

/** 128-bit random room id, hex. Not enumerable, never shown to players. */
export function newRoomId(random: RandomSource = cryptoRandom): string {
  return toHex(random(16));
}

export function newSessionId(random: RandomSource = cryptoRandom): string {
  return toHex(random(8));
}

/** Short human invite code via rejection sampling (no modulo bias). */
export function newRoomCode(random: RandomSource = cryptoRandom): string {
  const n = ROOM_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < ROOM_CODE_LENGTH) {
    const bytes = random(ROOM_CODE_LENGTH * 2);
    for (let i = 0; i < bytes.length && out.length < ROOM_CODE_LENGTH; i++) {
      const b = bytes[i]!;
      if (b < limit) out += ROOM_CODE_ALPHABET[b % n];
    }
  }
  return out;
}

/** Random 31-bit match seed. */
export function newSeed(random: RandomSource = cryptoRandom): number {
  const b = random(4);
  return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 1;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
