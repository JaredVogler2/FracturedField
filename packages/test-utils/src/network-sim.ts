/**
 * Deterministic network impairment model for integration tests: latency, jitter and loss over a
 * virtual clock. Used to drive the authority with realistic delivery patterns without wall-clock
 * sleeps.
 *
 * WebSockets run over TCP, so a "lost packet" never disappears from a live connection: the segment
 * is retransmitted after a timeout and everything sent after it waits (head-of-line blocking). The
 * reliable mode models exactly that; the unreliable mode (drop + reorder) exists for datagram-style
 * experiments only.
 */
export interface LinkProfile {
  /** One-way base latency (ms). */
  readonly latencyMs: number;
  /** Uniform ± variation of the one-way latency (ms). */
  readonly jitterMs: number;
  /** Per-segment loss probability in [0, 1]. */
  readonly loss: number;
  /** Retransmission timeout for reliable links (default max(200, 3 × latency)). */
  readonly rtoMs?: number;
}

export const PERFECT_LINK: LinkProfile = { latencyMs: 0, jitterMs: 0, loss: 0 };

interface InFlight<T> {
  readonly deliverAt: number;
  readonly order: number;
  readonly payload: T;
}

/** Small seeded generator so impairment patterns are reproducible. */
export function mulberry32(seed: number): () => number {
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
  /** Delivery time of the newest queued segment (reliable links never deliver out of order). */
  private tail = -Infinity;
  sent = 0;
  dropped = 0;
  retransmits = 0;

  /**
   * @param reliable When true (WebSocket/TCP semantics) delivery is ordered and loss becomes
   *                 retransmission delay; when false segments may be dropped or reordered.
   */
  constructor(
    private profile: LinkProfile,
    seed = 1,
    private readonly reliable = true,
  ) {
    this.rand = mulberry32(seed);
  }

  setProfile(profile: LinkProfile): void {
    this.profile = profile;
  }

  /** Queues a payload and returns the virtual time it will be delivered (or null if dropped). */
  send(nowMs: number, payload: T): number | null {
    this.sent++;
    const p = this.profile;
    const jitter = (this.rand() * 2 - 1) * p.jitterMs;
    let deliverAt = nowMs + Math.max(0, p.latencyMs + jitter);
    if (this.reliable) {
      const rto = p.rtoMs ?? Math.max(200, p.latencyMs * 3);
      for (let attempt = 0; attempt < 6 && this.rand() < p.loss; attempt++) {
        deliverAt += rto * 2 ** attempt; // exponential RTO backoff
        this.retransmits++;
      }
      deliverAt = Math.max(deliverAt, this.tail);
      this.tail = deliverAt;
      this.queue.push({ deliverAt, order: this.counter++, payload });
      return deliverAt;
    }
    if (this.rand() < p.loss) {
      this.dropped++;
      return null;
    }
    this.queue.push({ deliverAt, order: this.counter++, payload });
    this.queue.sort((a, b) => a.deliverAt - b.deliverAt || a.order - b.order);
    return deliverAt;
  }

  /** Returns every payload due at or before `nowMs`, in delivery order. */
  receive(nowMs: number): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.deliverAt <= nowMs) {
      out.push(this.queue.shift()!.payload);
    }
    return out;
  }

  /** Discards everything in flight (the connection was torn down). */
  clear(): void {
    this.queue = [];
    this.tail = -Infinity;
  }

  get pending(): number {
    return this.queue.length;
  }
}

interface VirtualTimer {
  readonly id: number;
  at: number;
  readonly fn: () => void;
  readonly every: number | null;
}

/**
 * Virtual wall clock with timers, compatible with the room loop/client clock interfaces. Time only
 * moves when the test advances it, and due timers fire in chronological order.
 */
export class VirtualClock {
  private timers: VirtualTimer[] = [];
  private nextId = 1;
  private lastFireAt = Number.NaN;
  private firesAtSameTime = 0;

  constructor(public t = 1_700_000_000_000) {}

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, at: this.t + Math.max(0, ms), fn, every: null });
    return id;
  }

  setInterval(fn: () => void, ms: number): number {
    const id = this.nextId++;
    const every = Math.max(1, ms);
    this.timers.push({ id, at: this.t + every, fn, every });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== handle);
  }

  clearInterval(handle: unknown): void {
    this.clearTimeout(handle);
  }

  /** Time of the earliest pending timer, or null. */
  nextAt(): number | null {
    let best: number | null = null;
    for (const x of this.timers) if (best === null || x.at < best) best = x.at;
    return best;
  }

  /**
   * Fires the earliest timer due at or before `limit` (advancing time to it) and returns true, or
   * advances to `limit` and returns false when nothing is due.
   */
  step(limit: number): boolean {
    let next: VirtualTimer | null = null;
    for (const x of this.timers) if (x.at <= limit && (!next || x.at < next.at)) next = x;
    if (!next) {
      this.t = Math.max(this.t, limit);
      return false;
    }
    this.t = Math.max(this.t, next.at);
    // A timer that keeps re-arming at the same instant would hang the test: fail loudly instead.
    if (next.at === this.lastFireAt) {
      if (++this.firesAtSameTime > 20_000) throw new Error('timer storm: no virtual time progress');
    } else {
      this.lastFireAt = next.at;
      this.firesAtSameTime = 0;
    }
    if (next.every !== null) next.at += next.every;
    else this.timers = this.timers.filter((x) => x !== next);
    next.fn();
    return true;
  }

  get pendingTimers(): number {
    return this.timers.length;
  }
}
