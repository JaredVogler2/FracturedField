import { describe, expect, it } from 'vitest';
import { awakeDeadline, type DeadlineClock } from './awake-deadline';

/** Intervals fire only when the test says so, at the time it sets (a page that can freeze). */
class PageClock implements DeadlineClock {
  t = 0;
  private timers = new Map<number, { fn: () => void; every: number; at: number }>();
  private next = 1;
  now() {
    return this.t;
  }
  setInterval(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.set(id, { fn, every: ms, at: this.t + ms });
    return id;
  }
  clearInterval(h: unknown) {
    this.timers.delete(h as number);
  }
  /** The page is awake: time passes and every timer fires on schedule. */
  run(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let due: { fn: () => void; every: number; at: number } | null = null;
      for (const x of this.timers.values()) if (x.at <= end && (!due || x.at < due.at)) due = x;
      if (!due) break;
      this.t = due.at;
      due.at += due.every;
      due.fn();
    }
    this.t = end;
  }
  /** The page is frozen for `ms` (a long task): no timer runs; then each overdue timer fires once. */
  freeze(ms: number) {
    this.t += ms;
    for (const x of [...this.timers.values()]) {
      if (x.at > this.t) continue;
      x.at = this.t + x.every;
      x.fn();
    }
  }
}

describe('awakeDeadline', () => {
  it('expires after its time while the page is awake', () => {
    const clock = new PageClock();
    let expired = 0;
    awakeDeadline(8000, () => expired++, clock);
    clock.run(7900);
    expect(expired).toBe(0);
    clock.run(400);
    expect(expired).toBe(1);
    clock.run(5000);
    expect(expired).toBe(1);
  });

  it('a frozen page does not use up the time: a 20 s long task counts as one tick', () => {
    const clock = new PageClock();
    let expired = 0;
    awakeDeadline(8000, () => expired++, clock);
    clock.run(2000);
    clock.freeze(20_000);
    expect(expired).toBe(0);
    // The reply queued behind the freeze is handled now; had it not come, the deadline still ends.
    clock.run(5000);
    expect(expired).toBe(0);
    clock.run(1000);
    expect(expired).toBe(1);
  });

  it('cancelled, it never fires', () => {
    const clock = new PageClock();
    let expired = 0;
    const stop = awakeDeadline(8000, () => expired++, clock);
    clock.run(3000);
    stop();
    clock.run(20_000);
    expect(expired).toBe(0);
  });
});
