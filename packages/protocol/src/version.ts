import { SIM_VERSION } from '@ff/game-data';

/**
 * Wire protocol version. Bump on any breaking message/shape change. A client and server only
 * play together when both PROTOCOL_VERSION and SIM_VERSION match exactly.
 */
export const PROTOCOL_VERSION = 3;

export { SIM_VERSION };

export type CompatibilityResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'protocol_mismatch' | 'sim_mismatch';
      readonly detail: string;
    };

export function checkCompatibility(
  client: { readonly protocol: number; readonly sim: number },
  server: { readonly protocol: number; readonly sim: number } = {
    protocol: PROTOCOL_VERSION,
    sim: SIM_VERSION,
  },
): CompatibilityResult {
  if (client.protocol !== server.protocol) {
    return {
      ok: false,
      reason: 'protocol_mismatch',
      detail: `client protocol v${client.protocol} != server protocol v${server.protocol}`,
    };
  }
  if (client.sim !== server.sim) {
    return {
      ok: false,
      reason: 'sim_mismatch',
      detail: `client sim v${client.sim} != server sim v${server.sim}`,
    };
  }
  return { ok: true };
}
