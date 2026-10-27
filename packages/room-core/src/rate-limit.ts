/** Token bucket used per seat for intents and per connection for all frames. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
    nowMs: number,
  ) {
    this.tokens = burst;
    this.last = nowMs;
  }

  take(nowMs: number, cost = 1): boolean {
    const elapsed = Math.max(0, nowMs - this.last) / 1000;
    this.last = nowMs;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
