import { DurableObject } from 'cloudflare:workers';
import { FixedRateLoop } from '@ff/room-core';
import {
  BenchInputs,
  GameWorld,
  RegionLoad,
  bodyPositions,
  makeBenchArena,
  physicsVersion,
} from '@ff/sim';
import { DEFAULT_RULES } from '@ff/game-data';
import { decodeClientMessage, encodeMessage, type PlayerSlot } from '@ff/protocol';
import type { Env } from './env.js';

export interface BenchConfig {
  readonly seconds: number;
  readonly bodies: number;
  readonly regions: number;
}

export interface BenchReport {
  readonly runtime: string;
  readonly rapier: string;
  readonly config: BenchConfig;
  readonly status: 'idle' | 'running' | 'done';
  readonly ticks: number;
  readonly wallSeconds: number;
  /** Mean per-tick compute (ms) from the aggregate; unbiased despite 1 ms timer resolution. */
  readonly meanTickMs: number;
  /** Percentiles of per-tick compute, quantised to the platform timer resolution (1 ms). */
  readonly p50TickMs: number;
  readonly p95TickMs: number;
  readonly p99TickMs: number;
  readonly maxTickMs: number;
  /** Mean of 30-tick batches (finer than the 1 ms per-tick resolution). */
  readonly batchMeanMs: readonly number[];
  readonly loop: {
    readonly dropped: number;
    readonly maxLateMs: number;
    readonly catchUps: number;
  };
  readonly snapshots: {
    readonly sent: number;
    readonly meanBytes: number;
    readonly maxBytes: number;
  };
  readonly clients: number;
  readonly clientIntents: number;
  readonly entities: number;
  readonly timerResolutionMs: number;
  readonly notes: readonly string[];
}

/**
 * Phase 01 / D01 benchmark: runs the real shared GameWorld (core + boulders = N dynamic bodies),
 * the 20-region stand-in load and synthetic two-seat input at a real-time 30 Hz inside the Durable
 * Object runtime, fanning snapshots out at 20 Hz to connected WebSocket clients.
 */
export class BenchDurableObject extends DurableObject<Env> {
  private world: GameWorld | null = null;
  private loop: FixedRateLoop | null = null;
  private regions: RegionLoad | null = null;
  private inputs = new BenchInputs(11);
  private samples: number[] = [];
  private batch: number[] = [];
  private batchAcc = 0;
  private batchCount = 0;
  private snapBytes: number[] = [];
  private startedAt = 0;
  private endedAt = 0;
  private config: BenchConfig = { seconds: 0, bodies: 0, regions: 0 };
  private status: BenchReport['status'] = 'idle';
  private snapDebt = 0;
  private clientIntents = 0;
  private sink = 0;
  private readonly sockets = new Set<WebSocket>();

  async start(config: BenchConfig): Promise<{ started: boolean }> {
    if (this.status === 'running') return { started: false };
    this.world?.dispose();
    this.config = config;
    this.world = await GameWorld.create({
      seed: 1234,
      arena: makeBenchArena(config.bodies),
      autoStart: true,
    });
    this.regions = new RegionLoad(config.regions, 5);
    this.inputs = new BenchInputs(11);
    this.samples = [];
    this.batch = [];
    this.batchAcc = 0;
    this.batchCount = 0;
    this.snapBytes = [];
    this.snapDebt = 0;
    this.clientIntents = 0;
    this.status = 'running';
    const world = this.world;
    const totalTicks = Math.round(config.seconds * DEFAULT_RULES.match.tickRate);
    this.loop = new FixedRateLoop(
      {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => {
          clearTimeout(h as ReturnType<typeof setTimeout>);
        },
      },
      DEFAULT_RULES.match.tickRate,
      () => {
        const t0 = Date.now();
        for (const { slot, intent } of this.inputs.next(world.tick))
          world.applyCommand(slot, intent);
        world.stepFixed();
        this.snapDebt += DEFAULT_RULES.match.snapshotRate / DEFAULT_RULES.match.tickRate;
        if (this.snapDebt >= 1) {
          this.snapDebt -= 1;
          const snap = world.snapshot();
          const text = encodeMessage({ t: 'snap', s: snap, st: t0 });
          this.snapBytes.push(text.length);
          for (const ws of this.sockets) {
            try {
              ws.send(text);
            } catch {
              this.sockets.delete(ws);
            }
          }
          this.sink +=
            this.regions?.step(snap.entities.map((e) => ({ x: e.p[0], z: e.p[2] }))) ?? 0;
        } else {
          this.sink += this.regions?.step(bodyPositions(world)) ?? 0;
        }
        const dt = Date.now() - t0;
        this.samples.push(dt);
        this.batchAcc += dt;
        if (++this.batchCount === 30) {
          this.batch.push(this.batchAcc / 30);
          this.batchAcc = 0;
          this.batchCount = 0;
        }
        if (this.samples.length >= totalTicks) this.finish();
      },
      4,
    );
    this.startedAt = Date.now();
    this.loop.startLoop();
    return { started: true };
  }

  private finish(): void {
    this.loop?.stop();
    this.endedAt = Date.now();
    this.status = 'done';
  }

  report(): BenchReport {
    const sorted = [...this.samples].sort((a, b) => a - b);
    const pick = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
    const total = this.samples.reduce((a, b) => a + b, 0);
    const end = this.status === 'done' ? this.endedAt : Date.now();
    const snaps = this.snapBytes;
    return {
      runtime: 'workerd (local wrangler dev) — NOT Cloudflare production',
      rapier: physicsVersion(),
      config: this.config,
      status: this.status,
      ticks: this.samples.length,
      wallSeconds: this.startedAt ? (end - this.startedAt) / 1000 : 0,
      meanTickMs: this.samples.length ? total / this.samples.length : 0,
      p50TickMs: pick(0.5),
      p95TickMs: pick(0.95),
      p99TickMs: pick(0.99),
      maxTickMs: sorted[sorted.length - 1] ?? 0,
      batchMeanMs: this.batch.map((b) => Math.round(b * 1000) / 1000),
      loop: {
        dropped: this.loop?.stats.dropped ?? 0,
        maxLateMs: this.loop?.stats.maxLateMs ?? 0,
        catchUps: this.loop?.stats.catchUps ?? 0,
      },
      snapshots: {
        sent: snaps.length,
        meanBytes: snaps.length ? Math.round(snaps.reduce((a, b) => a + b, 0) / snaps.length) : 0,
        maxBytes: snaps.length ? Math.max(...snaps) : 0,
      },
      clients: this.sockets.size,
      clientIntents: this.clientIntents,
      entities: this.world?.counters.entities ?? 0,
      timerResolutionMs: 1,
      notes: [
        'Date.now() inside workerd advances in 1 ms steps; per-tick percentiles are quantised to 1 ms.',
        'Production Workers freeze timers during execution; use Cloudflare CPU-time metrics there.',
        'JS heap usage is not observable from inside workerd; DO isolate memory limit is 128 MB.',
        `checksum ${Math.round(this.sink) % 1000}`,
      ],
    };
  }

  override fetch(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.sockets.add(server);
    const slot: PlayerSlot = this.sockets.size % 2 === 1 ? 0 : 1;
    server.addEventListener('message', (ev) => {
      const d = decodeClientMessage(ev.data, DEFAULT_RULES.network.maxMessageBytes);
      if (d.ok && d.msg.t === 'intent' && this.world && this.status === 'running') {
        this.clientIntents++;
        this.world.applyCommand(slot, d.msg.i);
      }
    });
    server.addEventListener('close', () => this.sockets.delete(server));
    return new Response(null, { status: 101, webSocket: client });
  }
}
