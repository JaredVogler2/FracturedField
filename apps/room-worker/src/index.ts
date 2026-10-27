import {
  PROTOCOL_VERSION,
  SIM_VERSION,
  isRoomCode,
  normalizeRoomCode,
  type ApiErrorResponse,
} from '@ff/protocol';
import { newRoomCode, type SeatGrant } from '@ff/room-core';
import { physicsVersion, runPhysicsHarness } from '@ff/sim';
import { allowedOrigins, spikeRoutesEnabled, type Env } from './env.js';
import type { BenchConfig } from './bench-do.js';

export { RoomDurableObject } from './room-do.js';
export { BenchDurableObject } from './bench-do.js';

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !allowedOrigins(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
    },
  });
}

function apiError(
  status: number,
  error: string,
  message: string,
  cors: Record<string, string>,
): Response {
  return json({ error, message } satisfies ApiErrorResponse, status, cors);
}

function grantResponse(grant: SeatGrant, cors: Record<string, string>): Response {
  return grant.ok
    ? json(grant.response, 200, cors)
    : apiError(grant.status, grant.error, grant.message, cors);
}

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(`room:${code}`));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    // Origin is a browser CSRF guard only — seat tickets are the real credential. Non-browser
    // clients (no Origin header) are allowed and must still present a valid ticket.
    if (origin && !allowedOrigins(env).has(origin)) {
      return apiError(403, 'origin', 'origin not allowed', {});
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      return json(
        { ok: true, protocol: PROTOCOL_VERSION, sim: SIM_VERSION, rapier: physicsVersion() },
        200,
        cors,
      );
    }

    if (path === '/api/rooms' && request.method === 'POST') {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = newRoomCode();
        const grant = await roomStub(env, code).createRoom(code);
        if (grant.ok || grant.status !== 409) return grantResponse(grant, cors);
      }
      return apiError(503, 'server_error', 'could not allocate a room code', cors);
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)(\/join)?$/.exec(path);
    if (roomMatch) {
      const code = normalizeRoomCode(decodeURIComponent(roomMatch[1] ?? ''));
      if (!isRoomCode(code)) return apiError(400, 'room_not_found', 'malformed room code', cors);
      const stub = roomStub(env, code);
      if (roomMatch[2] && request.method === 'POST')
        return grantResponse(await stub.joinRoom(), cors);
      if (!roomMatch[2] && request.method === 'GET') {
        const info = await stub.roomInfo();
        return info ? json(info, 200, cors) : apiError(404, 'room_not_found', 'no such room', cors);
      }
      return apiError(405, 'bad_message', 'method not allowed', cors);
    }

    const wsMatch = /^\/ws\/([^/]+)$/.exec(path);
    if (wsMatch) {
      if (request.headers.get('Upgrade') !== 'websocket')
        return apiError(426, 'bad_message', 'expected websocket', cors);
      const code = normalizeRoomCode(decodeURIComponent(wsMatch[1] ?? ''));
      if (!isRoomCode(code)) return apiError(400, 'room_not_found', 'malformed room code', cors);
      return roomStub(env, code).fetch(request);
    }

    if (spikeRoutesEnabled(env)) {
      if (path === '/spike/physics') {
        // Phase 01 proof: the shared harness executed inside the Worker isolate.
        return json(await runPhysicsHarness(), 200, cors);
      }
      const bench = env.BENCH.get(env.BENCH.idFromName('bench'));
      if (path === '/spike/bench/start' && request.method === 'POST') {
        const config: BenchConfig = {
          seconds: clampInt(url.searchParams.get('seconds'), 5, 600, 60),
          bodies: clampInt(url.searchParams.get('bodies'), 1, 40, 20),
          regions: clampInt(url.searchParams.get('regions'), 0, 64, 20),
        };
        return json(await bench.start(config), 200, cors);
      }
      if (path === '/spike/bench/report') return json(await bench.report(), 200, cors);
      if (path === '/spike/bench/ws') return bench.fetch(request);
    }

    return apiError(404, 'room_not_found', 'not found', cors);
  },
} satisfies ExportedHandler<Env>;

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = raw === null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
