import { describe, expect, it } from 'vitest';
import { RoomAuthority, CLOSE, signTicket, verifyTicket } from '../src/index.js';
import { FakeConnection, hello, makeRoom, seatBoth, startLive, tickN } from './helpers.js';

const intent = (seq: number, action: string, phase: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    t: 'intent',
    i: {
      seq,
      clientTime: 0,
      action,
      phase,
      aim: [-0.2, 0],
      intensity: 1,
      source: 'keyboard',
      ...extra,
    },
  });

describe('tickets', () => {
  it('round-trips, rejects tampering, wrong secret and expiry', async () => {
    const payload = { r: 'a'.repeat(32), s: 1 as const, n: 3, e: 2_000 };
    const t = await signTicket('s1', payload);
    expect(await verifyTicket('s1', t, 1_000)).toEqual(payload);
    expect(await verifyTicket('s2', t, 1_000)).toBeNull();
    expect(await verifyTicket('s1', t, 2_000)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = `${body!.slice(0, -2)}AA.${sig}`;
    expect(await verifyTicket('s1', forged, 1_000)).toBeNull();
    expect(await verifyTicket('s1', 'garbage', 1_000)).toBeNull();
  });
});

describe('seat issuance', () => {
  it('issues exactly two seats; a third caller is refused (S16)', async () => {
    const t = makeRoom();
    const host = await t.room.claimHostSeat();
    const guest = await t.room.claimGuestSeat();
    const third = await t.room.claimGuestSeat();
    expect(host.ok && host.response.slot).toBe(0);
    expect(guest.ok && guest.response.slot).toBe(1);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toBe('room_full');
    expect(t.persisted.length).toBeGreaterThan(0);
  });
});

describe('HELLO handshake', () => {
  it('assigns unique seats to two real connections and moves the room to lobby', async () => {
    const t = makeRoom();
    const { a, b } = await seatBoth(t);
    expect(a.last('welcome')?.slot).toBe(0);
    expect(b.last('welcome')?.slot).toBe(1);
    expect(a.last('resync')?.s.match.phase).toBe('lobby');
    expect(t.room.roomPhase).toBe('lobby');
    const lobby = b.last('lobby');
    expect(lobby?.seats.map((s) => s.connected)).toEqual([true, true]);
  });

  it('rejects a forged ticket and closes the socket', async () => {
    const t = makeRoom();
    await t.room.claimHostSeat();
    const c = new FakeConnection('x');
    t.room.onOpen(c);
    const forged = await signTicket('attacker-secret', {
      r: t.room.roomId,
      s: 0,
      n: 1,
      e: t.room.expiresAt,
    });
    await t.room.onMessage(c.id, hello(t.room.roomId, forged));
    expect(c.last('error')?.code).toBe('bad_ticket');
    expect(c.closed?.code).toBe(CLOSE.BAD_TICKET);
  });

  it('rejects a valid ticket presented to a different room', async () => {
    const t1 = makeRoom();
    const t2 = makeRoom();
    const host = await t1.room.claimHostSeat();
    await t2.room.claimHostSeat();
    if (!host.ok) throw new Error();
    const c = new FakeConnection('y');
    t2.room.onOpen(c);
    await t2.room.onMessage(c.id, hello(t2.room.roomId, host.response.ticket));
    expect(c.last('error')?.code).toBe('bad_ticket');
  });

  it('refuses incompatible protocol and simulation versions', async () => {
    const t = makeRoom();
    const host = await t.room.claimHostSeat();
    if (!host.ok) throw new Error();
    const c1 = new FakeConnection('p');
    t.room.onOpen(c1);
    await t.room.onMessage(c1.id, hello(t.room.roomId, host.response.ticket, { protocol: 999 }));
    expect(c1.last('error')?.code).toBe('protocol_mismatch');
    const c2 = new FakeConnection('q');
    t.room.onOpen(c2);
    await t.room.onMessage(c2.id, hello(t.room.roomId, host.response.ticket, { sim: 999 }));
    expect(c2.last('error')?.code).toBe('sim_mismatch');
  });

  it('rekeys on resume: a superseded ticket cannot be replayed', async () => {
    const t = makeRoom();
    const { a, tickets } = await seatBoth(t);
    const resume = a.last('welcome')!.resumeTicket;
    t.room.onClose(a.id);
    const a2 = new FakeConnection('a2');
    t.room.onOpen(a2);
    await t.room.onMessage(a2.id, hello(t.room.roomId, resume));
    expect(a2.last('welcome')?.slot).toBe(0);
    expect(a2.last('welcome')?.resumed).toBe(true);
    // The original ticket is now two generations old.
    const thief = new FakeConnection('thief');
    t.room.onOpen(thief);
    await t.room.onMessage(thief.id, hello(t.room.roomId, tickets[0]));
    expect(thief.last('error')?.code).toBe('bad_ticket');
  });

  it('a refresh replaces the previous socket instead of creating a ghost seat', async () => {
    const t = makeRoom();
    const { a } = await seatBoth(t);
    const resume = a.last('welcome')!.resumeTicket;
    const a2 = new FakeConnection('a2');
    t.room.onOpen(a2);
    await t.room.onMessage(a2.id, hello(t.room.roomId, resume));
    expect(a.closed?.code).toBe(CLOSE.REPLACED);
    expect(a2.last('welcome')?.slot).toBe(0);
    expect(t.room.connectionCount).toBe(2);
  });

  it('requires HELLO before any seated message', async () => {
    const t = makeRoom();
    const c = new FakeConnection('z');
    t.room.onOpen(c);
    await t.room.onMessage(c.id, intent(1, 'pulse', 'tap'));
    expect(c.last('error')?.code).toBe('not_seated');
  });
});

describe('authoritative match flow', () => {
  it('starts only when both seats are ready and then streams snapshots at ~20 Hz', async () => {
    const t = makeRoom();
    const { a, b } = await startLive(t);
    expect(t.room.roomPhase).toBe('live');
    expect(t.ticking).toContain(true);
    tickN(t, 30);
    const snaps = a.of('snap');
    expect(snaps.length).toBeGreaterThanOrEqual(19);
    expect(snaps.length).toBeLessThanOrEqual(21);
    expect(b.of('snap').at(-1)?.s.tick).toBe(snaps.at(-1)?.s.tick);
  });

  it('routes ACKs only to the sending seat even when sequence numbers collide', async () => {
    const t = makeRoom();
    const { a, b } = await startLive(t);
    tickN(t, 95); // countdown + kickoff shield
    await t.room.onMessage(a.id, intent(7, 'pulse', 'tap'));
    await t.room.onMessage(b.id, intent(7, 'sweep', 'tap', { aim: [0.5, 0] }));
    tickN(t, 1);
    const ackA = a.of('ack').filter((m) => m.r.seq === 7);
    const ackB = b.of('ack').filter((m) => m.r.seq === 7);
    expect(ackA).toHaveLength(1);
    expect(ackB).toHaveLength(1);
    expect(ackA[0]!.r.accepted).toBe(true);
    expect(ackB[0]!.r.accepted).toBe(true);
  });

  it('rejects forged server messages, NaN and out-of-range values (G05 / S04)', async () => {
    const t = makeRoom();
    const { a } = await startLive(t);
    await t.room.onMessage(
      a.id,
      JSON.stringify({ t: 'events', list: [{ type: 'goal', scorer: 0 }] }),
    );
    await t.room.onMessage(
      a.id,
      '{"t":"intent","i":{"seq":1,"clientTime":0,"action":"pulse","phase":"tap","aim":[NaN,0],"intensity":1,"source":"keyboard"}}',
    );
    await t.room.onMessage(a.id, intent(2, 'pulse', 'tap', { intensity: 50 }));
    await t.room.onMessage(a.id, intent(3, 'pulse', 'tap', { aim: [4, 0] }));
    await t.room.onMessage(a.id, intent(4, 'teleport', 'tap'));
    await t.room.onMessage(a.id, JSON.stringify({ t: 'intent', i: { seq: 5 }, energy: 100 }));
    await t.room.onMessage(a.id, 'x'.repeat(5000));
    const errors = a.of('error');
    expect(errors.length).toBe(7);
    expect(errors.every((e) => !e.fatal)).toBe(true);
    expect(a.closed).toBeNull();
    // Score unchanged by the forged goal claim.
    tickN(t, 3);
    expect(a.last('snap')?.s.match.score).toEqual([0, 0]);
  });

  it('rate limits intent floods (S04: 10x allowed rate) without crashing', async () => {
    const t = makeRoom();
    const { a, b } = await startLive(t);
    tickN(t, 95);
    for (let i = 0; i < 400; i++) await t.room.onMessage(a.id, intent(100 + i, 'pulse', 'tap'));
    tickN(t, 2);
    // Burst admitted, then intent-bucket rejections, then silent frame drops.
    const limitedAcks = a.of('ack').filter((m) => m.r.reason === 'rate_limited').length;
    expect(limitedAcks).toBeGreaterThan(0);
    expect(a.of('error').filter((e) => e.code === 'rate_limited').length).toBeLessThanOrEqual(5);
    // Pulse cooldown still applies to whatever got through.
    expect(a.of('ack').filter((m) => m.r.accepted).length).toBeLessThanOrEqual(1);
    // Sustained abuse disconnects the flooder; the opponent keeps receiving the match.
    expect(a.closed?.code).toBe(CLOSE.RATE);
    const before = b.of('snap').length;
    tickN(t, 3);
    expect(b.of('snap').length).toBeGreaterThan(before);
  });

  it('pauses on disconnect, resumes with the resume ticket, and keeps the score (S13)', async () => {
    const t = makeRoom();
    const { a, b } = await startLive(t);
    tickN(t, 100);
    const resume = b.last('welcome')!.resumeTicket;
    t.room.onClose(b.id);
    const pause = a.last('pause');
    expect(pause?.paused).toBe(true);
    expect(pause?.slot).toBe(1);
    const tickBefore = a.last('snap')!.s.tick;
    tickN(t, 60);
    const frozen = a.last('snap')!.s;
    expect(frozen.match.paused).toBe(true);
    expect(frozen.tick).toBeGreaterThan(tickBefore);
    const b2 = new FakeConnection('b2');
    t.room.onOpen(b2);
    await t.room.onMessage(b2.id, hello(t.room.roomId, resume));
    expect(b2.last('welcome')?.slot).toBe(1);
    expect(b2.last('resync')?.reason).toBe('resume');
    expect(a.last('pause')?.paused).toBe(false);
    tickN(t, 5);
    expect(a.last('snap')?.s.match.paused).toBe(false);
  });

  it('forfeits the absent player after the grace period (S14) — no free goal before that', async () => {
    const t = makeRoom();
    const { a, b } = await startLive(t);
    tickN(t, 100);
    t.room.onClose(b.id);
    tickN(t, 30 * 29);
    expect(a.last('matchEnd')).toBeUndefined();
    expect(a.last('snap')?.s.match.score).toEqual([0, 0]);
    tickN(t, 40);
    const end = a.last('matchEnd');
    expect(end?.winner).toBe(0);
    expect(end?.reason).toBe('forfeit');
    expect(t.room.roomPhase).toBe('ended');
  });

  it('rebuilds seats from persisted state after a host restart', async () => {
    const t = makeRoom();
    const { a } = await seatBoth(t);
    const record = t.persisted.at(-1)!;
    const resume = a.last('welcome')!.resumeTicket;
    const env = { now: () => t.clock.t, secret: 'unit-test-secret-please-rotate' };
    const reborn = new RoomAuthority(env, record);
    const c = new FakeConnection('after-restart');
    reborn.onOpen(c);
    await reborn.onMessage(c.id, hello(reborn.roomId, resume));
    expect(c.last('welcome')?.slot).toBe(0);
  });
});
