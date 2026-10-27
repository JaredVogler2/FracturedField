import type { ServerMessage } from '@ff/protocol';
import { PROTOCOL_VERSION, SIM_VERSION, decodeServerMessage } from '@ff/protocol';
import {
  RoomAuthority,
  type RoomConnection,
  type RoomEnv,
  type PersistedRoom,
} from '../src/index.js';

export class FakeConnection implements RoomConnection {
  readonly messages: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  constructor(readonly id: string) {}
  send(data: string): void {
    if (this.closed) throw new Error('send after close');
    const d = decodeServerMessage(data);
    if (!d.ok) throw new Error(`server sent undecodable frame: ${d.detail}`);
    this.messages.push(d.msg);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
    return this.messages.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    const all = this.of(t);
    return all[all.length - 1];
  }
}

export interface TestRoom {
  room: RoomAuthority;
  clock: { t: number };
  persisted: PersistedRoom[];
  ticking: boolean[];
}

let seedCounter = 1;
export function deterministicRandom(): (n: number) => Uint8Array {
  let s = seedCounter++ * 7919;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      out[i] = (s >>> 16) & 0xff;
    }
    return out;
  };
}

export function makeRoom(): TestRoom {
  const clock = { t: 1_700_000_000_000 };
  const persisted: PersistedRoom[] = [];
  const ticking: boolean[] = [];
  const env: RoomEnv = {
    now: () => clock.t,
    secret: 'unit-test-secret-please-rotate',
    random: deterministicRandom(),
    persist: (s) => {
      persisted.push(s);
    },
    onTickingChange: (w) => {
      ticking.push(w);
    },
  };
  const room = new RoomAuthority(env, RoomAuthority.newRecord(env, 'BCDFGH'));
  return { room, clock, persisted, ticking };
}

export function hello(
  roomId: string,
  ticket: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    sim: SIM_VERSION,
    build: 'test',
    room: roomId,
    ticket,
    ...overrides,
  });
}

export async function seatBoth(
  t: TestRoom,
): Promise<{ a: FakeConnection; b: FakeConnection; tickets: [string, string] }> {
  const host = await t.room.claimHostSeat();
  const guest = await t.room.claimGuestSeat();
  if (!host.ok || !guest.ok) throw new Error('seat issuance failed');
  const a = new FakeConnection('conn-a');
  const b = new FakeConnection('conn-b');
  t.room.onOpen(a);
  t.room.onOpen(b);
  await t.room.onMessage(a.id, hello(t.room.roomId, host.response.ticket));
  await t.room.onMessage(b.id, hello(t.room.roomId, guest.response.ticket));
  return { a, b, tickets: [host.response.ticket, guest.response.ticket] };
}

export async function startLive(t: TestRoom): Promise<{ a: FakeConnection; b: FakeConnection }> {
  const { a, b } = await seatBoth(t);
  await t.room.onMessage(a.id, JSON.stringify({ t: 'ready', ready: true, inputMode: 'keyboard' }));
  await t.room.onMessage(b.id, JSON.stringify({ t: 'ready', ready: true, inputMode: 'touch' }));
  return { a, b };
}

/** Advances the fake clock and the room by n fixed ticks. */
export function tickN(t: TestRoom, n: number): void {
  for (let i = 0; i < n; i++) {
    t.clock.t += 1000 / 30;
    t.room.tick();
  }
}
