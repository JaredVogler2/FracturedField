/**
 * Phase 03 integration suite: two independent RoomClients play through the real RoomAuthority over
 * simulated TCP links. Nothing here injects scores or authoritative state into a client — the only
 * staging is server-side fixture placement of the core/force points before a shot (as in the D02
 * shot tests); every outcome comes from intents, the authoritative tick and the network path.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { FAST_RULES } from '@ff/game-data';
import type { GameEvent, PlayerSlot } from '@ff/protocol';
import type { LinkProfile } from '@ff/test-utils';
import { TestPlayer, VirtualNetwork, seatTickets } from './net-harness.js';

const H = FAST_RULES.core.hoverHeight;
const netTable: Record<string, string>[] = [];

afterAll(() => {
  if (netTable.length === 0) return;
  console.log('\nPhase 03 impaired-network runs (virtual time, 12 s of play + 3 s drain):');
  console.table(netTable);
});
const LAN: LinkProfile = { latencyMs: 15, jitterMs: 3, loss: 0 };

async function connectBoth(
  net: VirtualNetwork,
  pa: LinkProfile = LAN,
  pb: LinkProfile = LAN,
): Promise<{ a: TestPlayer; b: TestPlayer; tickets: [string, string] }> {
  const tickets = await seatTickets(net);
  const a = new TestPlayer(net, tickets[0], pa);
  const b = new TestPlayer(net, tickets[1], pb);
  a.client.connect();
  b.client.connect();
  const ok = await net.until(() => a.client.isConnected && b.client.isConnected, 10_000);
  expect(ok).toBe(true);
  return { a, b, tickets };
}

async function untilPhase(net: VirtualNetwork, players: TestPlayer[], phase: string, ms = 20_000) {
  const ok = await net.until(() => players.every((p) => p.latest?.match.phase === phase), ms);
  expect(ok, `both clients should observe phase ${phase}`).toBe(true);
}

/** Waits for the next kickoff after a given event (events are ordered; snapshots may lag them). */
async function untilPlayingAfter(net: VirtualNetwork, players: TestPlayer[], afterId: number) {
  const ok = await net.until(
    () =>
      players.every((p) =>
        p.events.some((e) => e.type === 'phase' && e.phase === 'playing' && e.id > afterId),
      ),
    20_000,
  );
  expect(ok, 'both clients should see the next kickoff').toBe(true);
}

async function readyBoth(net: VirtualNetwork, a: TestPlayer, b: TestPlayer): Promise<void> {
  expect(a.client.setReady(true, 'keyboard')).toBe(true);
  expect(b.client.setReady(true, 'touch')).toBe(true);
  await untilPhase(net, [a, b], 'playing');
}

/**
 * Stages a direct shot for `attacker` (core 3.5 m out, force point behind it) and fires a real
 * PULSE intent through the network. Resolves once both clients have seen the resulting goal.
 */
async function scoreFor(net: VirtualNetwork, attacker: TestPlayer, watchers: TestPlayer[]) {
  const w = net.room.gameWorld!;
  const dir = attacker.slot === 0 ? 1 : -1;
  const before = watchers.map((p) => p.goals().length);
  // Wait until this client's own snapshot shows PULSE ready (cooldown/energy from earlier casts).
  const ready = await net.until(() => {
    const me = attacker.latest?.players[attacker.slot];
    return !!me && !me.cd.pulse && me.energy >= 40;
  }, 5000);
  expect(ready, 'pulse should come off cooldown').toBe(true);
  w.debugClearKickoffShield();
  w.debugPlaceBody(w.coreEntityId, 3.5 * dir, H, 0);
  w.debugPlaceManipulator(attacker.slot, 1.5 * dir, 0);
  attacker.intent('aim', 'hold', [1.5 * dir, 0]);
  await net.run(120 + attacker.profile.latencyMs * 2);
  w.debugPlaceBody(w.coreEntityId, 3.5 * dir, H, 0);
  const seq = attacker.intent('pulse', 'tap', [1.5 * dir, 0]);
  expect(seq).toBeGreaterThanOrEqual(0);
  await net.until(() => attacker.acks.has(seq), 3000);
  expect(attacker.acks.get(seq), JSON.stringify(attacker.acks.get(seq))).toMatchObject({
    accepted: true,
  });
  const ok = await net.until(() => watchers.every((p, i) => p.goals().length > before[i]!), 8000);
  expect(ok, 'both clients should receive the goal event').toBe(true);
  const goal = watchers[0]!.goals().at(-1) as Extract<GameEvent, { type: 'goal' }>;
  expect(goal.scorer).toBe(attacker.slot);
  return goal;
}

/** Every tick both clients received must carry byte-identical authoritative state. */
function expectSameAuthority(a: TestPlayer, b: TestPlayer): number {
  let common = 0;
  for (const [tick, json] of a.snaps) {
    const other = b.snaps.get(tick);
    if (other === undefined) continue;
    common++;
    if (other !== json) expect.fail(`snapshot divergence at tick ${tick}`);
  }
  return common;
}

describe('two remote clients, one authoritative room', () => {
  it('create/join, ready, opposed pulses, goals, match end and rematch agree exactly (G04 in-process)', async () => {
    const net = new VirtualNetwork('fast');
    const { a, b } = await connectBoth(net);
    expect(a.slot).toBe(0);
    expect(b.slot).toBe(1);
    expect(a.lobby?.phase).toBe('lobby');
    await readyBoth(net, a, b);

    // Opposed pulses landing on the same tick: symmetric impulses cancel horizontally.
    const w = net.room.gameWorld!;
    w.debugClearKickoffShield();
    w.debugPlaceBody(w.coreEntityId, 0, H, 0);
    w.debugPlaceManipulator(0, -1.6, 0);
    w.debugPlaceManipulator(1, 1.6, 0);
    a.intent('aim', 'hold', [-1.6, 0]);
    b.intent('aim', 'hold', [1.6, 0]);
    await net.run(150);
    w.debugPlaceBody(w.coreEntityId, 0, H, 0);
    const sa = a.intent('pulse', 'tap', [-1.6, 0]);
    const sb = b.intent('pulse', 'tap', [1.6, 0]);
    await net.run(400);
    expect(a.acks.get(sa)?.accepted).toBe(true);
    expect(b.acks.get(sb)?.accepted).toBe(true);
    expect(a.acks.get(sa)?.tick).toBe(b.acks.get(sb)?.tick);
    const casts = a.events.filter((e) => e.type === 'cast' && e.ability === 'pulse');
    expect(casts.map((e) => (e as { slot: PlayerSlot }).slot).sort()).toEqual([0, 1]);
    const core = a.latest!.entities.find((e) => e.kind === 'core')!;
    expect(Math.hypot(core.v[0], core.v[2])).toBeLessThan(0.5);

    // Two goals for slot 0 win the (fast-rules) match; both clients see identical outcomes.
    const g1 = await scoreFor(net, a, [a, b]);
    expect(b.goals().at(-1)).toEqual(g1);
    await untilPlayingAfter(net, [a, b], g1.id);
    await scoreFor(net, a, [a, b]);
    const ended = await net.until(() => a.matchEnd !== null && b.matchEnd !== null, 10_000);
    expect(ended).toBe(true);
    expect(a.matchEnd).toEqual(b.matchEnd);
    expect(a.matchEnd!.winner).toBe(0);
    expect(a.matchEnd!.roundWins).toEqual([2, 0]);
    expect(a.matchEnd!.reason).toBe('complete');
    expect(a.events).toEqual(b.events);
    expect(expectSameAuthority(a, b)).toBeGreaterThan(100);

    // Rematch only when both ask.
    a.client.requestRematch();
    await net.run(300);
    expect(a.latest!.match.phase).toBe('matchEnd');
    b.client.requestRematch();
    await untilPhase(net, [a, b], 'playing');
    expect(a.latest!.match.roundWins).toEqual([0, 0]);
    expect(a.latest!.match.round).toBe(1);
  });

  for (const rtt of [50, 100, 200]) {
    it(`stays convergent and responsive at ${rtt} ms RTT with jitter and 2% TCP loss`, async () => {
      const latency = rtt / 2;
      const profile: LinkProfile = { latencyMs: latency, jitterMs: latency * 0.3, loss: 0.02 };
      const net = new VirtualNetwork('standard');
      const { a, b } = await connectBoth(net, profile, profile);
      await readyBoth(net, a, b);

      // 12 s of play: 20 Hz aim streams on moving targets, a pulse per second each, and a held
      // LIFT from A every 3 s.
      const targets: Record<PlayerSlot, [number, number]> = { 0: [-6, 0], 1: [6, 0] };
      let elapsed = 0;
      while (elapsed < 12_000) {
        const t = elapsed / 1000;
        targets[0] = [-6 + 3 * Math.cos(t * 1.3), 4 * Math.sin(t * 1.3)];
        targets[1] = [6 + 3 * Math.cos(t * 1.1 + 1), 4 * Math.sin(t * 1.1 + 1)];
        a.intent('aim', 'hold', targets[0]);
        b.intent('aim', 'hold', targets[1]);
        if (elapsed % 1000 === 500) {
          a.intent('pulse', 'tap', targets[0]);
          b.intent('pulse', 'tap', targets[1]);
        }
        if (elapsed % 3000 === 100) a.intent('lift', 'start', targets[0]);
        if (elapsed % 3000 === 700) a.intent('lift', 'end', targets[0]);
        await net.run(50);
        elapsed += 50;
      }
      await net.run(3000); // drain retransmissions

      // No frozen controls: every discrete action was answered, within bounded time.
      for (const p of [a, b]) {
        for (const seq of p.sentAt.keys()) expect(p.acks.has(seq), `ack for seq ${seq}`).toBe(true);
        const sorted = [...p.ackLatency].sort((x, y) => x - y);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        const worst = sorted[sorted.length - 1]!;
        expect(median).toBeLessThanOrEqual(rtt + 2 * profile.jitterMs + 40);
        expect(worst).toBeLessThan(rtt + 2000);
        expect(p.client.stats.reconnects).toBe(0);
        // RTT estimate tracks the configured path (EWMA of PING/PONG).
        expect(p.client.stats.rttMs).toBeGreaterThan(rtt * 0.7);
        expect(p.client.stats.rttMs).toBeLessThan(rtt * 1.6 + 60);
      }
      // No divergent authority: identical snapshots and identical event streams.
      const common = expectSameAuthority(a, b);
      expect(common).toBeGreaterThan(200);
      const lat = [...a.ackLatency, ...b.ackLatency].sort((x, y) => x - y);
      const link = net.linkStats();
      netTable.push({
        'RTT (ms)': String(rtt),
        'jitter ± (ms)': profile.jitterMs.toFixed(1),
        'segments / retransmitted': `${link.sent} / ${link.retransmits}`,
        acks: String(lat.length),
        'ack median (ms)': lat[Math.floor(lat.length / 2)]!.toFixed(0),
        'ack p95 (ms)': lat[Math.floor(lat.length * 0.95)]!.toFixed(0),
        'ack max (ms)': lat[lat.length - 1]!.toFixed(0),
        'RTT estimate A/B (ms)': `${a.client.stats.rttMs.toFixed(0)} / ${b.client.stats.rttMs.toFixed(0)}`,
        'identical snapshots': String(common),
      });
      expect(a.events).toEqual(b.events);
      // Force points converge to the last commanded aim; no hold is left stuck on.
      const last = a.latest!;
      expect(last.players[0].hold).toBeNull();
      expect(
        Math.hypot(last.players[0].m[0] - targets[0][0], last.players[0].m[1] - targets[0][1]),
      ).toBeLessThan(0.05);
      expect(
        Math.hypot(last.players[1].m[0] - targets[1][0], last.players[1].m[1] - targets[1][1]),
      ).toBeLessThan(0.05);
      // Accepted pulses really happened on the server (cast events seen by both).
      const casts = a.events.filter((e) => e.type === 'cast' && e.ability === 'pulse').length;
      const accepted = [a, b].reduce(
        (n, p) => n + p.ackLog.filter((r) => r.accepted && p.sentAt.has(r.seq)).length,
        0,
      );
      expect(casts).toBeGreaterThan(0);
      expect(accepted).toBeGreaterThanOrEqual(casts);
    });
  }

  it('reconnect: a dropped player resumes the same seat and score; the opponent gets a pause, not a win (G12)', async () => {
    const net = new VirtualNetwork('fast');
    const { a, b, tickets } = await connectBoth(net, LAN, { latencyMs: 25, jitterMs: 5, loss: 0 });
    await readyBoth(net, a, b);
    const g = await scoreFor(net, b, [a, b]);
    await untilPlayingAfter(net, [a, b], g.id);
    await net.run(100);
    expect(a.latest!.match.roundWins).toEqual([0, 1]);

    // B starts holding LIFT on the core.
    const w = net.room.gameWorld!;
    w.debugClearKickoffShield();
    w.debugPlaceBody(w.coreEntityId, 4, H, 0);
    w.debugPlaceManipulator(1, 5, 0);
    b.intent('aim', 'hold', [5, 0]);
    await net.run(100);
    const liftSeq = b.intent('lift', 'start', [5, 0]);
    await net.run(300);
    expect(b.acks.get(liftSeq), JSON.stringify(b.acks.get(liftSeq))).toMatchObject({
      accepted: true,
    });
    expect(a.latest!.players[1].hold).toBe('lift');

    // Network failure on B's link.
    const firstPipe = b.pipe;
    net.reset(firstPipe);
    const paused = await net.until(() => a.pauses.some((p) => p.paused && p.slot === 1), 2000);
    expect(paused).toBe(true);
    // The hold was cancelled by the disconnect: no invisible force while away.
    await net.run(200);
    expect(a.latest!.players[1].hold).toBeNull();
    expect(a.latest!.players[1].connected).toBe(false);
    expect(a.matchEnd).toBeNull();

    // B's client reconnects by itself with its rotated resume ticket.
    const resumed = await net.until(() => b.welcomes.length === 2, 10_000);
    expect(resumed).toBe(true);
    expect(b.pipe).not.toBe(firstPipe);
    expect(b.welcomes[1]!.slot).toBe(1);
    expect(b.welcomes[1]!.resumed).toBe(true);
    expect(b.client.stats.reconnects).toBe(1);
    const unpaused = await net.until(
      () => a.pauses.some((p) => !p.paused && p.reason === 'resumed'),
      2000,
    );
    expect(unpaused).toBe(true);
    await net.run(500);
    expect(b.latest!.match.roundWins).toEqual([0, 1]);
    expect(b.latest!.players[1].hold).toBeNull(); // not silently re-applied
    expect(b.latest!.players[1].connected).toBe(true);
    expect(b.latest!.match.paused).toBe(false);

    // Sequence space restarted for the new connection; play continues normally.
    const s = b.intent('aim', 'hold', [6, 1]);
    expect(s).toBe(0);
    await scoreFor(net, b, [a, b]);
    const ended = await net.until(() => a.matchEnd !== null && b.matchEnd !== null, 10_000);
    expect(ended).toBe(true);
    expect(a.matchEnd).toEqual(b.matchEnd);
    expect(a.matchEnd!.winner).toBe(1);

    // The original (superseded) ticket can no longer take the seat: no dual ownership.
    const ghost = new TestPlayer(net, tickets[1], LAN);
    ghost.client.connect();
    await net.run(2000);
    expect(ghost.client.connectionState).toBe('failed');
    expect(ghost.welcomes).toHaveLength(0);
    expect(b.client.isConnected).toBe(true);
  });

  it('a silently dead link is detected by the client watchdog and the seat resumes', async () => {
    const net = new VirtualNetwork('fast');
    const { a, b } = await connectBoth(net);
    await readyBoth(net, a, b);
    const before = b.client.stats.lastServerTick;
    net.blackhole(b.pipe);
    const back = await net.until(() => b.welcomes.length === 2, 9000);
    expect(back).toBe(true);
    expect(b.welcomes[1]!.resumed).toBe(true);
    expect(b.client.stats.reconnects).toBe(1);
    await net.run(1000);
    expect(b.client.stats.lastServerTick).toBeGreaterThan(before + 100);
    expect(a.matchEnd).toBeNull();
    expect(b.latest!.match.phase).not.toBe('matchEnd');
  });

  it('a seat that dies silently is reaped; the opponent is paused, then wins by forfeit after the grace period', async () => {
    const net = new VirtualNetwork('fast');
    const { a, b } = await connectBoth(net);
    await readyBoth(net, a, b);
    net.blackhole(b.pipe);
    b.client.close(); // the player is gone for good (tab closed while offline)
    const paused = await net.until(() => a.pauses.some((p) => p.paused && p.slot === 1), 9000);
    expect(paused).toBe(true);
    expect(a.matchEnd).toBeNull();
    const ended = await net.until(() => a.matchEnd !== null, 40_000);
    expect(ended).toBe(true);
    expect(a.matchEnd!.winner).toBe(0);
    expect(a.matchEnd!.reason).toBe('forfeit');
    expect(net.room.roomPhase).toBe('ended');
  });

  it('duplicate and out-of-order intents from a client are ignored by the authority', async () => {
    const net = new VirtualNetwork('fast');
    const { a, b } = await connectBoth(net);
    await readyBoth(net, a, b);
    const w = net.room.gameWorld!;
    w.debugClearKickoffShield();
    w.debugPlaceBody(w.coreEntityId, -3, H, 0);
    w.debugPlaceManipulator(0, -5, 0);
    for (let i = 0; i < 4; i++) a.intent('aim', 'hold', [-5, 0]);
    const seq = a.intent('pulse', 'tap', [-5, 0]);
    await net.run(300);
    expect(a.acks.get(seq)?.accepted).toBe(true);
    const castsBefore = a.events.filter((e) => e.type === 'cast').length;
    a.replay(seq, 'pulse', [-5, 0]);
    a.replay(seq - 1, 'pulse', [-5, 0]);
    await net.run(300);
    const tail = a.ackLog.slice(-2);
    expect(tail.map((r) => [r.seq, r.accepted, r.reason])).toEqual([
      [seq, false, 'stale'],
      [seq - 1, false, 'stale'],
    ]);
    expect(a.events.filter((e) => e.type === 'cast').length).toBe(castsBefore);
  });
});
