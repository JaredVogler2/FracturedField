/** The timers an awake deadline needs (the browser's by default; a fake in tests). */
export interface DeadlineClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const browserClock: DeadlineClock = {
  now: () => performance.now(),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
};

const TICK_MS = 250;

/**
 * Calls `onExpire` once `ms` have passed while this page was awake to see a reply. A long task (a
 * shader compile, a long frame, a background tab) delays every timer and every reply alike, and a
 * reply that arrived meanwhile is queued, not lost: each tick counts at most twice its interval, so
 * a frozen page never gives up on a request that already succeeded. Returns a function that
 * cancels the deadline.
 */
export function awakeDeadline(
  ms: number,
  onExpire: () => void,
  clock: DeadlineClock = browserClock,
): () => void {
  let waited = 0;
  let last = clock.now();
  let done = false;
  const handle = clock.setInterval(() => {
    const now = clock.now();
    waited += Math.min(Math.max(0, now - last), 2 * TICK_MS);
    last = now;
    if (!done && waited > ms) {
      done = true;
      clock.clearInterval(handle);
      onExpire();
    }
  }, TICK_MS);
  return () => {
    done = true;
    clock.clearInterval(handle);
  };
}
