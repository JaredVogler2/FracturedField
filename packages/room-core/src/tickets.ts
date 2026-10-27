import type { PlayerSlot } from '@ff/protocol';

/**
 * Seat credentials: `base64url(json payload) + "." + base64url(HMAC-SHA256(secret, payload))`.
 * Tickets are opaque to clients, unguessable without the server secret, bound to one room and
 * seat, expire, and are rotated (rekeyed) on every successful HELLO.
 */
export interface TicketPayload {
  /** Room id (128-bit hex). */
  readonly r: string;
  readonly s: PlayerSlot;
  /** Seat generation; only the current or immediately previous generation is accepted. */
  readonly n: number;
  /** Expiry, epoch ms. */
  readonly e: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keyCache.get(secret);
  if (!k) {
    k = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.set(secret, k);
  }
  return k;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function signTicket(secret: string, payload: TicketPayload): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Verifies signature (constant-time via WebCrypto), shape and expiry. Returns null if invalid. */
export async function verifyTicket(
  secret: string,
  token: string,
  nowMs: number,
): Promise<TicketPayload | null> {
  if (token.length > 600) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = base64UrlDecode(token.slice(dot + 1));
  if (!sig || sig.length !== 32) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, encoder.encode(body));
  if (!ok) return null;
  const raw = base64UrlDecode(body);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(raw));
  } catch {
    return null;
  }
  if (!isPayload(parsed)) return null;
  if (parsed.e <= nowMs) return null;
  return parsed;
}

function isPayload(v: unknown): v is TicketPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.r === 'string' &&
    /^[a-f0-9]{32}$/.test(o.r) &&
    (o.s === 0 || o.s === 1) &&
    typeof o.n === 'number' &&
    Number.isInteger(o.n) &&
    o.n >= 0 &&
    typeof o.e === 'number' &&
    Number.isFinite(o.e)
  );
}
