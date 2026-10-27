import type { BenchDurableObject } from './bench-do.js';
import type { RoomDurableObject } from './room-do.js';

export interface Env {
  readonly ROOMS: DurableObjectNamespace<RoomDurableObject>;
  readonly BENCH: DurableObjectNamespace<BenchDurableObject>;
  /** HMAC key for seat tickets (wrangler secret). Required outside development. */
  readonly TICKET_SECRET?: string;
  readonly ENVIRONMENT: string;
  readonly ALLOWED_ORIGINS: string;
  readonly ENABLE_SPIKE_ROUTES?: string;
}

const DEV_FALLBACK_SECRET = 'development-only-insecure-ticket-secret';

/** Resolves the ticket secret; refuses to run production rooms without a configured secret. */
export function ticketSecret(env: Env): string | null {
  if (env.TICKET_SECRET && env.TICKET_SECRET.length >= 16) return env.TICKET_SECRET;
  return env.ENVIRONMENT === 'development' ? DEV_FALLBACK_SECRET : null;
}

export function allowedOrigins(env: Env): ReadonlySet<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function spikeRoutesEnabled(env: Env): boolean {
  return env.ENABLE_SPIKE_ROUTES === 'true' && env.ENVIRONMENT === 'development';
}
