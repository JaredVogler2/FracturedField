/**
 * Incremental FNV-1a (32-bit) over quantised numbers. Used to compare authoritative states across
 * runs (determinism tests), between clients (MATCH_END digest) and in replay verification.
 */
export class StateHasher {
  private h = 0x811c9dc5;

  /** Feeds a number quantised to `scale` (default millimetres / thousandths). */
  num(n: number, scale = 1000): this {
    const q = Number.isFinite(n) ? Math.round(n * scale) | 0 : 0x7fffffff;
    this.byte(q & 0xff);
    this.byte((q >>> 8) & 0xff);
    this.byte((q >>> 16) & 0xff);
    this.byte((q >>> 24) & 0xff);
    return this;
  }

  int(n: number): this {
    return this.num(n, 1);
  }

  str(s: string): this {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i) & 0xff);
    return this;
  }

  private byte(b: number): void {
    this.h ^= b;
    this.h = Math.imul(this.h, 0x01000193);
  }

  digest(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
