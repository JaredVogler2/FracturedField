import { PROTOCOL_VERSION, SIM_VERSION } from '@ff/protocol';

/** Base URL of the authoritative room service (Cloudflare Worker). */
export function roomServiceUrl(): string | null {
  const url = import.meta.env.VITE_ROOM_SERVICE_URL;
  return url && url.length > 0 ? url.replace(/\/+$/, '') : null;
}

/** Probes /health and checks protocol/sim compatibility for the transport status readout. */
export async function checkRoomService(): Promise<string> {
  const base = roomServiceUrl();
  if (!base) return 'not configured (VITE_ROOM_SERVICE_URL)';
  try {
    const r = await fetch(`${base}/health`, { cache: 'no-store' });
    if (!r.ok) return `unreachable (${r.status})`;
    const h = (await r.json()) as { protocol?: number; sim?: number; rapier?: string };
    if (h.protocol !== PROTOCOL_VERSION || h.sim !== SIM_VERSION) {
      return `INCOMPATIBLE server p${String(h.protocol)}/s${String(h.sim)} vs client p${PROTOCOL_VERSION}/s${SIM_VERSION}`;
    }
    return `reachable · protocol ${h.protocol} · rapier ${h.rapier ?? '?'}`;
  } catch {
    return 'unreachable (network)';
  }
}
