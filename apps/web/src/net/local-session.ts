import { DEFAULT_RULES } from '@ff/game-data';
import type { ActionIntent, InputSource, PlayerSlot } from '@ff/protocol';
import type { GameWorld } from '@ff/sim';
import type { SessionCallbacks, SessionDriver } from './session';

export interface LocalSessionOptions {
  readonly seed?: number;
  /** Seats driven by this device (both for a same-device duel, [0] vs a bot). */
  readonly localSlots: readonly PlayerSlot[];
  /** Start the match immediately (no lobby). */
  readonly autoStart?: boolean;
  /** Optional per-tick hook (e.g. bot input) run before the world steps. */
  readonly beforeTick?: (world: GameWorld) => void;
}

/**
 * Runs the authoritative GameWorld locally at a fixed 30 Hz using a wall-clock accumulator.
 * Produces exactly the same snapshot/event/ack stream a remote room produces, so everything above
 * this layer is identical for local and online play.
 */
export class LocalSession implements SessionDriver {
  readonly kind = 'local' as const;
  readonly tickRate = DEFAULT_RULES.match.tickRate;
  readonly localSlots: readonly PlayerSlot[];
  private world: GameWorld | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private acc = 0;
  private readonly seed: number;
  private disposed = false;
  private ready: [boolean, boolean] = [false, false];
  private rematch: [boolean, boolean] = [false, false];
  private endAnnounced = false;
  /** Number of ticks executed (diagnostics). */
  ticks = 0;
  /** Mean milliseconds spent per step (diagnostics). */
  stepMs = 0;

  constructor(
    private readonly cb: SessionCallbacks,
    private readonly opts: LocalSessionOptions,
  ) {
    this.localSlots = opts.localSlots;
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  }

  get gameWorld(): GameWorld | null {
    return this.world;
  }

  async start(): Promise<void> {
    this.cb.onStatus({ state: 'connecting', kind: 'local', detail: 'loading physics' });
    const { GameWorld } = await import('@ff/sim');
    if (this.disposed) return;
    this.world = await GameWorld.create({
      seed: this.seed,
      autoStart: this.opts.autoStart ?? false,
    });
    if (this.disposed) {
      this.world.dispose();
      return;
    }
    this.cb.onSnapshot(this.world.snapshot(), performance.now());
    this.cb.onStatus({ state: 'connected', kind: 'local', detail: `seed ${this.seed}` });
    this.cb.onWelcome?.({
      slot: this.localSlots[0] ?? 0,
      roomCode: 'LOCAL',
      tickRate: this.tickRate,
      snapshotRate: this.tickRate,
    });
    this.last = performance.now();
    // 4 ms polling keeps tick cadence even when rAF is throttled; work happens only when due.
    this.timer = setInterval(() => this.pump(), 4);
  }

  private pump(): void {
    const world = this.world;
    if (!world) return;
    const now = performance.now();
    const dtMs = 1000 / this.tickRate;
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    let steps = 0;
    while (this.acc >= dtMs && steps < 5) {
      this.acc -= dtMs;
      steps++;
      this.opts.beforeTick?.(world);
      const t0 = performance.now();
      const r = world.stepFixed();
      this.stepMs = this.stepMs * 0.95 + (performance.now() - t0) * 0.05;
      this.ticks++;
      for (const { slot, result } of r.results) this.cb.onAck(slot, result);
      if (r.events.length > 0) this.cb.onEvents(r.events);
      this.cb.onSnapshot(world.snapshot(), performance.now());
      if (world.phase === 'matchEnd' && !this.endAnnounced) {
        this.endAnnounced = true;
        const s = world.matchSummary;
        this.cb.onMatchEnd?.({
          t: 'matchEnd',
          winner: s.winner ?? -1,
          score: s.score,
          roundWins: s.roundWins,
          seed: this.seed,
          digest: world.outcomeDigest(),
          reason: 'complete',
        });
      }
    }
    if (steps === 5) this.acc = 0; // tab was throttled: drop the backlog instead of fast-forwarding
  }

  sendIntent(slot: PlayerSlot, intent: ActionIntent): void {
    if (!this.localSlots.includes(slot)) return;
    this.world?.applyCommand(slot, intent);
  }

  setReady(ready: boolean, _inputMode: InputSource): void {
    for (const s of this.localSlots) this.ready[s] = ready;
    if (this.ready[0] && this.ready[1]) this.world?.startMatch();
  }

  /** Marks a non-local seat (bot) ready. */
  setSeatReady(slot: PlayerSlot): void {
    this.ready[slot] = true;
    if (this.ready[0] && this.ready[1]) this.world?.startMatch();
  }

  requestRematch(): void {
    for (const s of this.localSlots) this.rematch[s] = true;
    this.tryRematch();
  }

  setSeatRematch(slot: PlayerSlot): void {
    this.rematch[slot] = true;
    this.tryRematch();
  }

  private tryRematch(): void {
    if (!this.world || this.world.phase !== 'matchEnd') return;
    if (!(this.rematch[0] && this.rematch[1])) return;
    this.rematch = [false, false];
    this.endAnnounced = false;
    this.world.rematch();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.world?.dispose();
    this.world = null;
    this.cb.onStatus({ state: 'closed', kind: 'local' });
  }
}
