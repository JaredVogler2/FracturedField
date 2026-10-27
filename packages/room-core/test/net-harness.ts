/**
 * In-process network for integration tests: real RoomClients talk to a real RoomAuthority through
 * TCP-like simulated links (latency, jitter, retransmission delay) on a virtual clock. The room is
 * driven by the production FixedRateLoop, exactly as the Durable Object adapter drives it.
 */
import type { RulesetId } from '@ff/game-data';
import type {
  ActionResult,
  GameEvent,
  IntentAction,
  IntentPhase,
  LobbyMessage,
  MatchEndMessage,
  PauseMessage,
  PlayerSlot,
  ServerMessage,
  WelcomeMessage,
  WorldSnapshot,
} from '@ff/protocol';
import {
  PERFECT_LINK,
  SimulatedLink,
  VirtualClock,
  makeIntent,
  type LinkProfile,
} from '@ff/test-utils';
import {
  FixedRateLoop,
  RoomAuthority,
  RoomClient,
  type ClientSocket,
  type MatchCheckpoint,
  type PersistedRoom,
  type RoomClientState,
  type RoomClientTimings,
  type RoomConnection,
  type RoomEnv,
} from '../src/index.js';
import { deterministicRandom } from './helpers.js';

class Pipe {
  serverOpen = false;
  clientOpen = false;
  /** A black-holed pipe silently swallows everything, including close frames. */
  blackholed = false;
  readonly up: SimulatedLink<string>;
  readonly down: SimulatedLink<string>;
  socket!: VirtualSocket;
  conn!: RoomConnection;

  constructor(
    readonly id: string,
    readonly profile: LinkProfile,
    seed: number,
  ) {
    this.up = new SimulatedLink<string>(profile, seed * 2 + 1);
    this.down = new SimulatedLink<string>(profile, seed * 2 + 2);
  }
}

class VirtualSocket implements ClientSocket {
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;

  constructor(
    private readonly net: VirtualNetwork,
    private readonly pipe: Pipe,
  ) {}

  send(data: string): void {
    const p = this.pipe;
    if (!p.clientOpen || p.blackholed) return; // browsers silently discard sends on closed sockets
    const at = p.up.send(this.net.clock.now(), data);
    if (at !== null) this.net.schedule(at, () => this.net.flushUp(p));
  }

  close(code = 1000, reason = ''): void {
    const p = this.pipe;
    if (!p.clientOpen) return;
    p.clientOpen = false;
    if (p.blackholed) return;
    this.net.schedule(this.net.clock.now() + p.profile.latencyMs, () => this.net.serverGone(p));
    // The browser reports its own close once the closing handshake finishes.
    this.net.schedule(this.net.clock.now() + 2 * p.profile.latencyMs, () =>
      this.onclose?.(code, reason),
    );
  }
}

export class VirtualNetwork {
  readonly clock = new VirtualClock();
  room!: RoomAuthority;
  readonly persisted: PersistedRoom[] = [];
  checkpoint: MatchCheckpoint | null = null;
  checkpointsSaved = 0;
  readonly logs: { event: string; data?: Record<string, unknown> }[] = [];
  private loop!: FixedRateLoop;
  private readonly pipes = new Map<string, Pipe>();
  private pending = new Set<Promise<unknown>>();
  private pipeCounter = 0;
  readonly env: RoomEnv;

  constructor(ruleset: RulesetId = 'fast') {
    this.env = {
      now: () => this.clock.now(),
      secret: 'integration-test-secret',
      random: deterministicRandom(),
      persist: (s) => {
        this.persisted.push(s);
      },
      persistCheckpoint: (cp) => {
        this.checkpoint = cp ? structuredClone(cp) : null;
        if (cp) this.checkpointsSaved++;
      },
      onTickingChange: (want) => (want ? this.loop.startLoop() : this.loop.stop()),
      log: (event, data) => {
        this.logs.push(data ? { event, data } : { event });
      },
    };
    this.installRoom(
      new RoomAuthority(this.env, RoomAuthority.newRecord(this.env, 'BCDFGH', ruleset)),
    );
    // Adapter alarm: periodic housekeeping, as the Durable Object schedules it.
    this.clock.setInterval(() => this.room.housekeeping(), 10_000);
  }

  private installRoom(room: RoomAuthority): void {
    this.room = room;
    this.loop = new FixedRateLoop(this.clock, room.rules.match.tickRate, () => room.tick());
  }

  schedule(at: number, fn: () => void): void {
    this.clock.setTimeout(fn, at - this.clock.now());
  }

  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Waits until all asynchronous room work (ticket crypto, world creation) has finished. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  /** Advances virtual time by `ms`, delivering messages and firing timers in order. */
  async run(ms: number): Promise<void> {
    const end = this.clock.now() + ms;
    for (;;) {
      await this.settle();
      if (!this.clock.step(end)) break;
    }
    await this.settle();
  }

  /** Advances until `pred` holds (checked after every event) or `maxMs` elapses. */
  async until(pred: () => boolean, maxMs: number): Promise<boolean> {
    const end = this.clock.now() + maxMs;
    for (;;) {
      await this.settle();
      if (pred()) return true;
      if (!this.clock.step(end)) return pred();
    }
  }

  /** Opens a fresh simulated TCP connection (one per RoomClient connection attempt). */
  openPipe(profile: LinkProfile): { id: string; socket: ClientSocket } {
    const id = `conn-${++this.pipeCounter}`;
    const pipe = new Pipe(id, profile, this.pipeCounter);
    this.pipes.set(id, pipe);
    pipe.socket = new VirtualSocket(this, pipe);
    pipe.conn = {
      id,
      send: (data) => {
        if (!pipe.serverOpen) throw new Error('send on closed server socket');
        if (pipe.blackholed) return;
        const at = pipe.down.send(this.clock.now(), data);
        if (at !== null) this.schedule(at, () => this.flushDown(pipe));
      },
      close: (code, reason) => {
        if (!pipe.serverOpen) return;
        pipe.serverOpen = false;
        if (pipe.blackholed) return;
        this.schedule(this.clock.now() + pipe.profile.latencyMs, () => {
          if (!pipe.clientOpen) return;
          pipe.clientOpen = false;
          pipe.socket.onclose?.(code, reason);
        });
      },
    };
    // Upgrade request reaches the server after one trip; the 101 reply after another.
    const l = pipe.profile.latencyMs;
    this.schedule(this.clock.now() + l, () => {
      if (pipe.blackholed) return;
      pipe.serverOpen = true;
      this.room.onOpen(pipe.conn);
    });
    this.schedule(this.clock.now() + 2 * l, () => {
      if (pipe.blackholed || !pipe.serverOpen) return;
      pipe.clientOpen = true;
      pipe.socket.onopen?.();
    });
    return { id, socket: pipe.socket };
  }

  /** Totals across every connection opened so far (segments sent / retransmitted). */
  linkStats(): { sent: number; retransmits: number } {
    let sent = 0;
    let retransmits = 0;
    for (const p of this.pipes.values()) {
      sent += p.up.sent + p.down.sent;
      retransmits += p.up.retransmits + p.down.retransmits;
    }
    return { sent, retransmits };
  }

  flushUp(pipe: Pipe): void {
    for (const data of pipe.up.receive(this.clock.now())) {
      if (!pipe.serverOpen) continue;
      this.track(this.room.onMessage(pipe.id, data));
    }
  }

  flushDown(pipe: Pipe): void {
    for (const data of pipe.down.receive(this.clock.now())) {
      if (pipe.clientOpen) pipe.socket.onmessage?.(data);
    }
  }

  serverGone(pipe: Pipe): void {
    if (!pipe.serverOpen) return;
    pipe.serverOpen = false;
    this.room.onClose(pipe.id);
  }

  /** Abrupt network failure: both ends learn about it (RST), nothing in flight is delivered. */
  reset(id: string): void {
    const pipe = this.pipes.get(id);
    if (!pipe) return;
    pipe.up.clear();
    pipe.down.clear();
    const wasClient = pipe.clientOpen;
    pipe.clientOpen = false;
    this.serverGone(pipe);
    if (wasClient) pipe.socket.onclose?.(1006, 'connection reset');
  }

  /** Silent failure: the link swallows everything and neither end gets a close event. */
  blackhole(id: string): void {
    const pipe = this.pipes.get(id);
    if (!pipe) return;
    pipe.blackholed = true;
    pipe.up.clear();
    pipe.down.clear();
  }

  /** Host restart: every socket drops and a new authority is rebuilt from persisted state only. */
  async restartHost(): Promise<void> {
    this.loop.stop();
    for (const pipe of this.pipes.values()) {
      pipe.up.clear();
      pipe.down.clear();
      const wasClient = pipe.clientOpen;
      pipe.serverOpen = false;
      pipe.clientOpen = false;
      if (wasClient) pipe.socket.onclose?.(1006, 'host restarted');
    }
    const record = this.persisted[this.persisted.length - 1];
    if (!record) throw new Error('nothing persisted');
    // Exactly what the Durable Object constructor does: storage only, no memory survives.
    const room = await RoomAuthority.rehydrate(
      this.env,
      structuredClone(record),
      this.checkpoint ? structuredClone(this.checkpoint) : null,
    );
    this.installRoom(room);
    if (room.wantsTicking) this.loop.startLoop();
    await this.settle();
  }
}

/** A scripted remote player: a real RoomClient plus a record of everything it was told. */
export class TestPlayer {
  readonly client: RoomClient;
  readonly snaps = new Map<number, string>();
  latest: WorldSnapshot | null = null;
  readonly events: GameEvent[] = [];
  readonly acks = new Map<number, ActionResult>();
  readonly sentAt = new Map<number, number>();
  readonly ackLatency: number[] = [];
  readonly pauses: PauseMessage[] = [];
  readonly welcomes: WelcomeMessage[] = [];
  readonly errors: ServerMessage[] = [];
  readonly states: RoomClientState[] = [];
  readonly ackLog: ActionResult[] = [];
  /** Every connection this player opened, oldest first. */
  readonly pipes: string[] = [];
  lobby: LobbyMessage | null = null;
  matchEnd: MatchEndMessage | null = null;
  private seq = 0;

  constructor(
    private readonly net: VirtualNetwork,
    ticket: string,
    public profile: LinkProfile = PERFECT_LINK,
    timings?: Partial<RoomClientTimings>,
  ) {
    this.client = new RoomClient({
      url: 'wss://rooms.test/ws/BCDFGH',
      roomId: net.room.roomId,
      ticket,
      build: 'test',
      clock: net.clock,
      socketFactory: () => {
        const { id, socket } = net.openPipe(this.profile);
        this.pipes.push(id);
        return socket;
      },
      ...(timings ? { timings } : {}),
      events: {
        onState: (s) => this.states.push(s),
        onNewConnection: (w) => {
          this.welcomes.push(w);
          this.seq = 0; // the server restarts this seat's sequence space on every HELLO
        },
        onMessage: (msg, at) => this.onMessage(msg, at),
      },
    });
  }

  private onMessage(msg: ServerMessage, at: number): void {
    switch (msg.t) {
      case 'snap':
      case 'resync':
        this.snaps.set(msg.s.tick, JSON.stringify(msg.s));
        this.latest = msg.s;
        break;
      case 'events':
        this.events.push(...msg.list);
        break;
      case 'ack': {
        this.acks.set(msg.r.seq, msg.r);
        this.ackLog.push(msg.r);
        const sent = this.sentAt.get(msg.r.seq);
        if (sent !== undefined) this.ackLatency.push(at - sent);
        break;
      }
      case 'pause':
        this.pauses.push(msg);
        break;
      case 'lobby':
        this.lobby = msg;
        break;
      case 'matchEnd':
        this.matchEnd = msg;
        break;
      case 'error':
        this.errors.push(msg);
        break;
      default:
        break;
    }
  }

  /** Id of the connection currently in use (the newest one). */
  get pipe(): string {
    const id = this.pipes[this.pipes.length - 1];
    if (!id) throw new Error('never connected');
    return id;
  }

  get slot(): PlayerSlot {
    const s = this.client.slot;
    if (s === null) throw new Error('not seated');
    return s;
  }

  /** Sends an intent at world target (x, z); returns its sequence number (or -1 if not sent). */
  intent(
    action: IntentAction,
    phase: IntentPhase,
    at: readonly [number, number],
    extra: { modifier?: number; dir?: readonly [number, number] } = {},
  ): number {
    const seq = this.seq;
    const ok = this.client.sendIntent(makeIntent(seq, action, phase, { at, ...extra }));
    if (!ok) return -1;
    this.seq++;
    if (action !== 'aim') {
      this.acks.delete(seq);
      this.sentAt.set(seq, this.net.clock.now());
    }
    return seq;
  }

  /** Re-sends an exact earlier sequence number (replay / duplicate attempts). */
  replay(seq: number, action: IntentAction, at: readonly [number, number]): void {
    this.client.sendIntent(makeIntent(seq, action, 'tap', { at }));
  }

  goals(): GameEvent[] {
    return this.events.filter((e) => e.type === 'goal');
  }
}

/** Creates both seats through the authority (the HTTP layer is covered by the live suite). */
export async function seatTickets(net: VirtualNetwork): Promise<[string, string]> {
  const host = await net.room.claimHostSeat();
  const guest = await net.room.claimGuestSeat();
  if (!host.ok || !guest.ok) throw new Error('seat issuance failed');
  return [host.response.ticket, guest.response.ticket];
}
