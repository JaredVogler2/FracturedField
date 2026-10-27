/**
 * Deterministic network impairment model for integration tests: latency, jitter, loss and
 * reordering over a virtual clock. Used to drive the authority with realistic delivery patterns
 * without wall-clock sleeps.
 */
export interface LinkProfile {
  readonly latencyMs: number;
  readonly jitterMs: number;
  /** Probability in [0, 1] that a packet is dropped. */
  readonly loss: number;
}

export const PERFECT_LINK: LinkProfile = { latencyMs: 0, jitterMs: 0, loss: 0 };

interface InFlight<T> {
  readonly deliverAt: number;
  readonly order: number;
  readonly payload: T;
}

/** Small seeded generator so impairment patterns are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SimulatedLink<T> {
  private queue: InFlight<T>[] = [];
  private counter = 0;
  private readonly rand: () => number;
  sent = 0;
  dropped = 0;

  /**
   * @param ordered When true (WebSocket semantics), delivery preserves send order even under
   *                jitter; loss then models a dropped connection segment rather than reordering.
   */
  constructor(
    private profile: LinkProfile,
    seed = 1,
    private readonly ordered = true,
  ) {
    this.rand = mulberry32(seed);
  }

  setProfile(profile: LinkProfile): void {
    this.profile = profile;
  }

  send(nowMs: number, payload: T): void {
    this.sent++;
    if (this.rand() < this.profile.loss) {
      this.dropped++;
      return;
    }
    const jitter = (this.rand() * 2 - 1) * this.profile.jitterMs;
    let deliverAt = nowMs + Math.max(0, this.profile.latencyMs + jitter);
    if (this.ordered && this.queue.length > 0) {
      const last = this.queue[this.queue.length - 1]!;
      deliverAt = Math.max(deliverAt, last.deliverAt);
    }
    this.queue.push({ deliverAt, order: this.counter++, payload });
    if (!this.ordered) this.queue.sort((a, b) => a.deliverAt - b.deliverAt || a.order - b.order);
  }

  /** Returns every payload due at or before `nowMs`, in delivery order. */
  receive(nowMs: number): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.deliverAt <= nowMs) {
      out.push(this.queue.shift()!.payload);
    }
    return out;
  }

  get pending(): number {
    return this.queue.length;
  }
}
