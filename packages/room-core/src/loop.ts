/**
 * Fixed-rate scheduler for the authoritative tick. Wall-clock time only decides WHEN ticks run;
 * every tick advances the simulation by exactly one fixed dt. Late wake-ups catch up (bounded) so
 * game time stays aligned with real time without a death spiral.
 */
export interface LoopClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LoopStats {
  ticks: number;
  /** Ticks dropped because catch-up exceeded the bound (sustained overload). */
  dropped: number;
  /** Worst observed lateness of a tick versus its schedule (ms). */
  maxLateMs: number;
  /** Count of wake-ups that ran more than one tick (catch-up). */
  catchUps: number;
}

export class FixedRateLoop {
  private handle: unknown = null;
  private start = 0;
  private done = 0;
  private running = false;
  readonly stats: LoopStats = { ticks: 0, dropped: 0, maxLateMs: 0, catchUps: 0 };

  constructor(
    private readonly clock: LoopClock,
    private readonly hz: number,
    private readonly onTick: () => void,
    private readonly maxCatchUp = 4,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    this.start = this.clock.now();
    this.done = 0;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.handle !== null) this.clock.clearTimeout(this.handle);
    this.handle = null;
  }

  private schedule(): void {
    if (!this.running) return;
    const period = 1000 / this.hz;
    const nextAt = this.start + (this.done + 1) * period;
    const delay = Math.max(0, nextAt - this.clock.now());
    this.handle = this.clock.setTimeout(() => this.wake(), delay);
  }

  private wake(): void {
    this.handle = null;
    if (!this.running) return;
    const period = 1000 / this.hz;
    const now = this.clock.now();
    // The epsilon absorbs float rounding at large epoch values: waking exactly on schedule must
    // count as due, or the loop would re-arm with a zero delay without advancing.
    let due = Math.floor((now - this.start) / period + 1e-3) - this.done;
    if (due > this.maxCatchUp) {
      // Sustained overload: skip ahead instead of spiralling; record the loss honestly.
      this.stats.dropped += due - this.maxCatchUp;
      this.done += due - this.maxCatchUp;
      due = this.maxCatchUp;
    }
    if (due > 1) this.stats.catchUps++;
    for (let i = 0; i < due && this.running; i++) {
      const scheduled = this.start + (this.done + 1) * period;
      this.stats.maxLateMs = Math.max(this.stats.maxLateMs, now - scheduled);
      this.done++;
      this.stats.ticks++;
      this.onTick();
    }
    this.schedule();
  }
}
