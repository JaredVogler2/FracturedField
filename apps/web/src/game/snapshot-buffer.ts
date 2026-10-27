import type { EntityKind, PlayerSlot, Quat, Vec3, WorldSnapshot } from '@ff/protocol';

export interface RenderEntity {
  id: number;
  kind: EntityKind;
  owner: PlayerSlot | -1;
  px: number;
  py: number;
  pz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  ttl: number;
}

export interface RenderManipulator {
  x: number;
  z: number;
}

export interface RenderFrame {
  /** Fractional authoritative tick being displayed. */
  tick: number;
  entities: Map<number, RenderEntity>;
  manipulators: [RenderManipulator, RenderManipulator];
  /** Newest snapshot (for HUD values that should not be interpolated). */
  latest: WorldSnapshot | null;
  /** True when the frame had to extrapolate past the newest snapshot. */
  extrapolating: boolean;
}

/**
 * Snapshot ring buffer with tick-timeline interpolation. Arrival jitter is absorbed by mapping
 * authoritative ticks onto a smoothed local clock (offset = arrival - tick·dt, tracked with a fast
 * downward / slow upward filter), then rendering `delayTicks` behind the newest estimate.
 */
export class SnapshotBuffer {
  private readonly snaps: WorldSnapshot[] = [];
  private offset: number | null = null;
  private readonly frame: RenderFrame = {
    tick: 0,
    entities: new Map(),
    manipulators: [
      { x: 0, z: 0 },
      { x: 0, z: 0 },
    ],
    latest: null,
    extrapolating: false,
  };
  /** Jitter statistics (ms) for the network panel. */
  jitterMs = 0;
  staleCount = 0;

  constructor(
    private readonly tickMs: number,
    public delayTicks: number,
    private readonly capacity = 64,
  ) {}

  push(snap: WorldSnapshot, receivedAt: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) {
      // Duplicate or out-of-order (or a reset): a resync with an older tick replaces the buffer.
      if (snap.tick < last.tick - 300) this.clear();
      else {
        this.staleCount++;
        return;
      }
    }
    this.snaps.push(snap);
    if (this.snaps.length > this.capacity) this.snaps.shift();
    const sample = receivedAt - snap.tick * this.tickMs;
    if (this.offset === null) this.offset = sample;
    else {
      const err = sample - this.offset;
      this.jitterMs = this.jitterMs * 0.9 + Math.abs(err) * 0.1;
      // Early packets snap the offset down quickly; late packets drift it up slowly.
      this.offset += err < 0 ? err * 0.5 : err * 0.02;
    }
    this.frame.latest = snap;
  }

  clear(): void {
    this.snaps.length = 0;
    this.offset = null;
    this.frame.entities.clear();
  }

  get latest(): WorldSnapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  get size(): number {
    return this.snaps.length;
  }

  /** Fills and returns the shared frame object (no per-frame allocation in steady state). */
  sample(now: number): RenderFrame {
    const f = this.frame;
    const n = this.snaps.length;
    if (n === 0 || this.offset === null) return f;
    const latest = this.snaps[n - 1]!;
    let target = (now - this.offset) / this.tickMs - this.delayTicks;
    // Never display further back than the oldest stored snapshot.
    const oldest = this.snaps[0]!;
    if (target < oldest.tick) target = oldest.tick;
    f.tick = target;
    f.latest = latest;

    if (target >= latest.tick) {
      const ahead = Math.min(target - latest.tick, 3); // cap extrapolation to ~100 ms
      f.extrapolating = ahead > 0;
      this.write(latest, latest, 0, (ahead * this.tickMs) / 1000);
      return f;
    }
    f.extrapolating = false;
    let i = n - 2;
    while (i > 0 && this.snaps[i]!.tick > target) i--;
    const a = this.snaps[i]!;
    const b = this.snaps[i + 1]!;
    const span = b.tick - a.tick;
    const t = span > 0 ? (target - a.tick) / span : 1;
    this.write(a, b, Math.max(0, Math.min(1, t)), 0);
    return f;
  }

  private write(a: WorldSnapshot, b: WorldSnapshot, t: number, extrapolateSeconds: number): void {
    const map = this.frame.entities;
    const seen = SEEN;
    seen.clear();
    for (const eb of b.entities) {
      seen.add(eb.id);
      const ea = a === b ? eb : (a.entities.find((e) => e.id === eb.id) ?? eb);
      let r = map.get(eb.id);
      if (!r) {
        r = {
          id: eb.id,
          kind: eb.kind,
          owner: eb.owner,
          px: 0,
          py: 0,
          pz: 0,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
          vx: 0,
          vy: 0,
          vz: 0,
          ttl: -1,
        };
        map.set(eb.id, r);
      }
      lerp3(r, ea.p, eb.p, t);
      nlerp(r, ea.q, eb.q, t);
      r.vx = ea.v[0] + (eb.v[0] - ea.v[0]) * t;
      r.vy = ea.v[1] + (eb.v[1] - ea.v[1]) * t;
      r.vz = ea.v[2] + (eb.v[2] - ea.v[2]) * t;
      if (extrapolateSeconds > 0) {
        r.px += r.vx * extrapolateSeconds;
        r.py += r.vy * extrapolateSeconds;
        r.pz += r.vz * extrapolateSeconds;
      }
      r.ttl = eb.ttl;
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
    for (const slot of [0, 1] as const) {
      const ma = a.players[slot].m;
      const mb = b.players[slot].m;
      const m = this.frame.manipulators[slot];
      m.x = ma[0] + (mb[0] - ma[0]) * t;
      m.z = ma[1] + (mb[1] - ma[1]) * t;
    }
  }
}

const SEEN = new Set<number>();

function lerp3(r: RenderEntity, a: Vec3, b: Vec3, t: number): void {
  r.px = a[0] + (b[0] - a[0]) * t;
  r.py = a[1] + (b[1] - a[1]) * t;
  r.pz = a[2] + (b[2] - a[2]) * t;
}

function nlerp(r: RenderEntity, a: Quat, b: Quat, t: number): void {
  // Shortest-path normalized lerp is visually equivalent to slerp at 30 Hz spacing.
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  let x = a[0] + (b[0] * s - a[0]) * t;
  let y = a[1] + (b[1] * s - a[1]) * t;
  let z = a[2] + (b[2] * s - a[2]) * t;
  let w = a[3] + (b[3] * s - a[3]) * t;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  r.qx = x;
  r.qy = y;
  r.qz = z;
  r.qw = w;
}
