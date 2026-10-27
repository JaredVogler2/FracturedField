import { PROTOCOL_VERSION, SIM_VERSION } from '@ff/protocol';

/**
 * Base URL of the authoritative room service (Cloudflare Worker). Production builds must set
 * VITE_ROOM_SERVICE_URL; a page served from localhost falls back to a local `wrangler dev`.
 */
export function roomServiceUrl(): string | null {
  const url = import.meta.env.VITE_ROOM_SERVICE_URL;
  if (url && url.length > 0) return url.replace(/\/+$/, '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (host === 'localhost' || host === '127.0.0.1') return `http://${host}:8787`;
  return null;
}

/** WebSocket URL for a room (http → ws, https → wss). */
export function roomSocketUrl(base: string, code: string): string {
  return `${base.replace(/^http/, 'ws')}/ws/${encodeURIComponent(code)}`;
}

export type RoomServiceHealth =
  { readonly ok: true; readonly detail: string } | { readonly ok: false; readonly detail: string };

/** Probes /health and checks protocol/sim compatibility before offering online play. */
export async function checkRoomService(): Promise<RoomServiceHealth> {
  const base = roomServiceUrl();
  if (!base) return { ok: false, detail: 'Online play is not configured for this build.' };
  try {
    const r = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!r.ok) return { ok: false, detail: `Room service unavailable (${r.status}).` };
    const h = (await r.json()) as { protocol?: number; sim?: number; rapier?: string };
    if (h.protocol !== PROTOCOL_VERSION || h.sim !== SIM_VERSION) {
      return {
        ok: false,
        detail: `Room service runs a different game version (p${String(h.protocol)}/s${String(h.sim)}, this page p${PROTOCOL_VERSION}/s${SIM_VERSION}). Reload the page.`,
      };
    }
    return { ok: true, detail: `Room service online · protocol ${h.protocol}` };
  } catch {
    return { ok: false, detail: 'Room service unreachable. Check your connection.' };
  }
}
