/**
 * Live two-client test against the real Worker + Durable Object running in local workerd.
 * Every message travels over a real WebSocket/TCP connection. Run: `pnpm test:worker`.
 */
import { PROTOCOL_VERSION, SIM_VERSION } from '@ff/protocol';
import { TestSocket, check, failureCount, startWorker } from './wrangler-harness.js';

interface Seat {
  roomId: string;
  code: string;
  slot: number;
  ticket: string;
}

const port = Number(process.env.WORKER_PORT ?? 8791);
const worker = await startWorker(port);
const { base, wsBase } = worker;

async function post(
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers });
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

function hello(seat: Seat, overrides: Record<string, unknown> = {}) {
  return {
    t: 'hello',
    protocol: PROTOCOL_VERSION,
    sim: SIM_VERSION,
    build: 'live-test',
    room: seat.roomId,
    ticket: seat.ticket,
    ...overrides,
  };
}

try {
  console.log(`room service: ${base}`);

  console.log('1. room creation and seat issuance');
  const created = await post('/api/rooms');
  check(created.status === 200 && created.body.slot === 0, 'host receives seat 0', created);
  const host = created.body as unknown as Seat;
  const joined = await post(`/api/rooms/${host.code}/join`);
  check(joined.status === 200 && joined.body.slot === 1, 'guest receives seat 1', joined);
  const guest = joined.body as unknown as Seat;
  check(guest.roomId === host.roomId, 'both seats belong to the same room');
  check(host.ticket !== guest.ticket, 'seat credentials differ');
  const third = await post(`/api/rooms/${host.code}/join`);
  check(
    third.status === 409 && third.body.error === 'room_full',
    'third join is refused (S16)',
    third,
  );
  const info = await fetch(`${base}/api/rooms/${host.code}`).then(
    (r) => r.json() as Promise<Record<string, unknown>>,
  );
  check(info.seatsTaken === 2, 'room info reports 2 seats', info);

  console.log('2. origin policy');
  const evil = await post('/api/rooms', { Origin: 'https://evil.example' });
  check(evil.status === 403, 'disallowed browser origin is rejected', evil.status);
  const good = await post('/api/rooms', { Origin: 'http://localhost:5173' });
  check(good.status === 200, 'allowed origin may create rooms', good.status);

  console.log('3. two real WebSocket clients, unique seats');
  const a = await TestSocket.open(`${wsBase}/ws/${host.code}`);
  const b = await TestSocket.open(`${wsBase}/ws/${host.code}`);
  a.send(hello(host));
  b.send(hello(guest));
  const wa = await a.waitType('welcome');
  const wb = await b.waitType('welcome');
  check(wa.slot === 0 && wb.slot === 1, 'WELCOME assigns slot 0 and slot 1', {
    a: wa.slot,
    b: wb.slot,
  });
  check(
    wa.roomId === host.roomId && wa.protocol === PROTOCOL_VERSION,
    'WELCOME carries room id and protocol',
  );
  const lobby = await b.waitFor((m) => m.t === 'lobby' && m.phase === 'lobby');
  check(Boolean(lobby), 'room advances to lobby when both seats are connected');

  console.log('4. impostors and isolation');
  const forged = await TestSocket.open(`${wsBase}/ws/${host.code}`);
  forged.send(
    hello(host, {
      ticket: `${host.ticket.split('.')[0]}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
    }),
  );
  const fErr = await forged.waitType('error');
  const fClose = await forged.waitClosed();
  check(
    fErr.code === 'bad_ticket' && fClose.code === 4003,
    'forged ticket rejected and socket closed',
    { fErr, fClose },
  );
  const other = await post('/api/rooms');
  const otherSeat = other.body as unknown as Seat;
  const cross = await TestSocket.open(`${wsBase}/ws/${otherSeat.code}`);
  cross.send(hello({ ...guest, roomId: otherSeat.roomId }));
  const cErr = await cross.waitType('error');
  check(cErr.code === 'bad_ticket', 'ticket from room A is useless in room B (isolation)', cErr);
  const old = await TestSocket.open(`${wsBase}/ws/${host.code}`);
  old.send(hello(host, { protocol: PROTOCOL_VERSION + 1 }));
  const oErr = await old.waitType('error');
  check(oErr.code === 'protocol_mismatch', 'incompatible protocol version refused', oErr);

  console.log('5. hostile frames are rejected without killing the seat');
  a.send(
    '{"t":"intent","i":{"seq":1,"clientTime":0,"action":"pulse","phase":"tap","aim":[NaN,0],"intensity":1,"source":"keyboard"}}',
  );
  a.send({ t: 'events', list: [{ type: 'goal', scorer: 0 }] });
  const hostileErrors = await a.waitFor((m) => m.t === 'error' && m.fatal === false);
  check(
    Boolean(hostileErrors) && a.closed === null,
    'NaN / forged frames produce non-fatal errors',
  );

  console.log('6. live authoritative match over the network');
  a.send({ t: 'ready', ready: true, inputMode: 'keyboard' });
  b.send({ t: 'ready', ready: true, inputMode: 'touch' });
  await a.waitFor(
    (m) =>
      m.t === 'events' &&
      Array.isArray(m.list) &&
      (m.list as { type: string; phase?: string }[]).some(
        (e) => e.type === 'phase' && e.phase === 'playing',
      ),
    8000,
  );
  check(true, 'countdown completed and the match is playing');
  // Opposed pulses from both seats at nearly the same time.
  const aim = (x: number) => [x, 0];
  await new Promise((r) => setTimeout(r, 600)); // let the kickoff shield expire
  a.send({
    t: 'intent',
    i: {
      seq: 10,
      clientTime: Date.now(),
      action: 'aim',
      phase: 'hold',
      aim: aim(-0.08),
      intensity: 1,
      source: 'keyboard',
    },
  });
  b.send({
    t: 'intent',
    i: {
      seq: 10,
      clientTime: Date.now(),
      action: 'aim',
      phase: 'hold',
      aim: aim(0.08),
      intensity: 1,
      source: 'touch',
    },
  });
  await new Promise((r) => setTimeout(r, 1500));
  a.send({
    t: 'intent',
    i: {
      seq: 11,
      clientTime: Date.now(),
      action: 'pulse',
      phase: 'tap',
      aim: aim(-0.08),
      intensity: 1,
      source: 'keyboard',
    },
  });
  b.send({
    t: 'intent',
    i: {
      seq: 11,
      clientTime: Date.now(),
      action: 'pulse',
      phase: 'tap',
      aim: aim(0.08),
      intensity: 1,
      source: 'touch',
    },
  });
  const ackA = await a.waitFor((m) => m.t === 'ack' && (m.r as { seq: number }).seq === 11);
  const ackB = await b.waitFor((m) => m.t === 'ack' && (m.r as { seq: number }).seq === 11);
  check(
    (ackA.r as { accepted: boolean }).accepted && (ackB.r as { accepted: boolean }).accepted,
    'both opposed pulses accepted by the authority',
    { ackA, ackB },
  );
  const castEvents = (s: TestSocket) =>
    s
      .of('events')
      .flatMap((m) => m.list as { type: string; slot?: number; ability?: string }[])
      .filter((e) => e.type === 'cast' && e.ability === 'pulse');
  await new Promise((r) => setTimeout(r, 400));
  check(
    castEvents(a).length === 2 && castEvents(b).length === 2,
    'both clients observed both casts as authoritative events',
    { a: castEvents(a).length, b: castEvents(b).length },
  );

  // Same authoritative snapshot content for the same tick on both clients.
  await new Promise((r) => setTimeout(r, 500));
  const snapsA = new Map(
    a.of('snap').map((m) => [(m.s as { tick: number }).tick, JSON.stringify(m.s)]),
  );
  const common = b.of('snap').filter((m) => snapsA.has((m.s as { tick: number }).tick));
  const identical = common.every(
    (m) => snapsA.get((m.s as { tick: number }).tick) === JSON.stringify(m.s),
  );
  check(
    common.length > 20 && identical,
    `identical world snapshots on both clients for ${common.length} common ticks`,
  );
  const lastSnap = a.of('snap').at(-1)?.s as {
    tick: number;
    entities: { kind: string; v: number[] }[];
  };
  const core = lastSnap.entities.find((e) => e.kind === 'core');
  check(Boolean(core), 'core entity present in snapshots');

  console.log('7. RTT over the local socket');
  const rtts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    a.send({ t: 'ping', seq: 100 + i, t0: Date.now() });
    await a.waitFor((m) => m.t === 'pong' && m.seq === 100 + i);
    rtts.push(performance.now() - t0);
  }
  rtts.sort((x, y) => x - y);
  console.log(`  RTT local loopback: p50 ${rtts[5]!.toFixed(2)} ms, max ${rtts[9]!.toFixed(2)} ms`);
  const snapCount = a.of('snap').length;
  console.log(
    `  snapshots received by A: ${snapCount}, mean bytes ${Math.round(a.bytesIn / Math.max(1, a.messages.length))} per frame`,
  );

  console.log('8. refresh replaces the socket (no ghost seat)');
  const resumeTicket = String(wa.resumeTicket);
  const a2 = await TestSocket.open(`${wsBase}/ws/${host.code}`);
  a2.send(hello({ ...host, ticket: resumeTicket }));
  const wa2 = await a2.waitType('welcome');
  const replaced = await a.waitClosed();
  check(
    wa2.slot === 0 && wa2.resumed === true && replaced.code === 4001,
    'resume ticket reclaims seat 0 and the old socket is replaced',
    { wa2: wa2.slot, replaced },
  );

  a2.close();
  b.close();
  cross.close();
  old.close();
} finally {
  await worker.stop();
}

const failed = failureCount();
console.log(
  failed === 0 ? '\nALL LIVE ROOM CHECKS PASSED' : `\n${failed} LIVE ROOM CHECK(S) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
