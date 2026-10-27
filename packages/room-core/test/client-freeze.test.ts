/**
 * A page that freezes (a long frame, a shader compile, a background tab) is not a dead link. While
 * a browser runs one long task nothing else runs: the heartbeat comes late, and the server's
 * messages that arrived meanwhile wait in the queue behind it. The client's connect and stall
 * deadlines count only time the page was awake, so a freeze never drops a healthy connection, and
 * a link that stays silent while the page is awake is still found dead. (PR #3 CI: a guest page
 * compiling its match scene on a two-core software renderer froze for 22 s right after WELCOME
 * and dropped its own seat as "connection stalled".)
 */
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, SIM_VERSION } from '@ff/protocol';
import { VirtualClock } from '@ff/test-utils';
import { CLOSE } from '../src/close-codes.js';
import { RoomClient, type ClientSocket } from '../src/client.js';

class FakeSocket implements ClientSocket {
  closed: { code: number | undefined; reason: string | undefined } | null = null;
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
}

const WELCOME = JSON.stringify({
  t: 'welcome',
  protocol: PROTOCOL_VERSION,
  sim: SIM_VERSION,
  slot: 1,
  sessionId: 'session',
  roomId: 'BCDFGH',
  roomCode: 'BCDFGH',
  serverTick: 0,
  seed: 1,
  resumeTicket: 'ticket-2',
  tickRate: 60,
  snapshotRate: 20,
  arenaId: 'meridian',
  resumed: false,
});

function setup() {
  const clock = new VirtualClock(1_000_000);
  const sockets: FakeSocket[] = [];
  const states: string[] = [];
  const client = new RoomClient({
    url: 'wss://rooms.test/ws/BCDFGH',
    roomId: 'BCDFGH',
    ticket: 'ticket-1',
    build: 'test',
    clock,
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    events: {
      onMessage: () => {},
      onState: (s, detail) => states.push(detail ? `${s}: ${detail}` : s),
    },
  });
  /** The page is awake: time passes and timers fire on schedule. */
  const run = (ms: number) => {
    const end = clock.t + ms;
    while (clock.step(end));
  };
  /** One long task: nothing runs for `ms`; then the overdue heartbeat runs, first. */
  const freeze = (ms: number) => {
    clock.t += ms;
    clock.step(clock.t);
  };
  return { client, sockets, states, run, freeze };
}

describe('a frozen page is not a dead link', () => {
  it('frozen while connecting: the WELCOME queued behind the freeze is taken, no reconnect', () => {
    const { client, sockets, states, run, freeze } = setup();
    client.connect();
    const s = sockets[0]!;
    s.onopen!();
    expect(s.sent[0]).toContain('"t":"hello"');
    run(300);
    freeze(20_000);
    s.onmessage!(WELCOME);
    run(3000);
    expect(s.closed).toBeNull();
    expect(sockets).toHaveLength(1);
    expect(client.isConnected).toBe(true);
    expect(client.slot).toBe(1);
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('frozen after WELCOME (the match scene compiling): still connected, no reconnect', () => {
    const { client, sockets, run, freeze } = setup();
    client.connect();
    const s = sockets[0]!;
    s.onopen!();
    s.onmessage!(WELCOME);
    run(1000);
    freeze(22_000);
    run(3000);
    expect(s.closed).toBeNull();
    expect(sockets).toHaveLength(1);
    expect(client.isConnected).toBe(true);
    expect(client.stats.reconnects).toBe(0);
  });

  it('a link silent while the page is awake is still found dead, freeze or not', () => {
    const { client, sockets, states, run, freeze } = setup();
    client.connect();
    const s = sockets[0]!;
    s.onopen!();
    s.onmessage!(WELCOME);
    run(2000);
    freeze(30_000);
    // 15 s of awake silence (the idle stale time) from here, give or take a heartbeat.
    run(12_000);
    expect(s.closed).toBeNull();
    run(3000);
    expect(s.closed?.code).toBe(CLOSE.TIMEOUT);
    expect(s.closed?.reason).toBe('connection stalled');
    expect(states).toContain('reconnecting: connection stalled');
  });

  it('awake, a silent server still times the connect out', () => {
    const { client, sockets, states, run } = setup();
    client.connect();
    const s = sockets[0]!;
    s.onopen!();
    run(7900);
    expect(s.closed).toBeNull();
    run(700);
    expect(s.closed?.reason).toBe('connect timeout');
    expect(states).toContain('reconnecting: connect timeout');
  });
});
