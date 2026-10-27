import type { ActionIntent, InputSource, PlayerSlot, Vec2 } from '@ff/protocol';
import type { ActionEdge, AimSpace, IntentSink } from './types.js';

const clampUnit = (v: number): number => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

/** World metres -> normalized aim, clamped and NaN-safe. */
export function worldToAim(x: number, z: number, space: AimSpace): Vec2 {
  return [clampUnit(x / space.halfLength), clampUnit(z / space.halfWidth)];
}

/**
 * Turns adapter state into sequenced, bounded ActionIntents. Aim updates are throttled to
 * `aimHz`; ability edges are sent immediately (with the latest aim attached).
 */
export class IntentEmitter {
  private seq = 0;
  private lastAimSent = -Infinity;
  private lastAim: Vec2 = [0, 0];
  private held = new Set<string>();

  private source: InputSource;

  constructor(
    readonly slot: PlayerSlot,
    source: InputSource,
    private readonly sink: IntentSink,
    private readonly aimHz = 15,
  ) {
    this.source = source;
  }

  /** Resets the sequence space (call when the transport connection is replaced). */
  resetSequence(): void {
    this.seq = 0;
  }

  /** Switches the reported input modality (hot-swap between adapters). */
  setSource(source: InputSource): this {
    this.source = source;
    return this;
  }

  /** Sends an aim update if the throttle interval elapsed or the aim moved substantially. */
  aim(aim: Vec2, nowMs: number, force = false): void {
    const a: Vec2 = [clampUnit(aim[0]), clampUnit(aim[1])];
    const moved = Math.abs(a[0] - this.lastAim[0]) + Math.abs(a[1] - this.lastAim[1]);
    if (!force && nowMs - this.lastAimSent < 1000 / this.aimHz) return;
    if (!force && moved < 0.0005 && nowMs - this.lastAimSent < 500) return;
    this.lastAim = a;
    this.lastAimSent = nowMs;
    this.send({ action: 'aim', phase: 'hold', aim: a, intensity: 1 }, nowMs);
  }

  /** Emits an ability edge immediately. Start/end pairs are tracked so they can be cancelled. */
  edge(edge: ActionEdge, aim: Vec2, nowMs: number): void {
    const a: Vec2 = [clampUnit(aim[0]), clampUnit(aim[1])];
    this.lastAim = a;
    if (edge.phase === 'start') this.held.add(edge.action);
    if (edge.phase === 'end') {
      if (!this.held.has(edge.action)) return;
      this.held.delete(edge.action);
    }
    const intent: Omit<ActionIntent, 'seq' | 'clientTime' | 'source'> = {
      action: edge.action,
      phase: edge.phase,
      aim: a,
      intensity: Number.isFinite(edge.intensity)
        ? Math.max(0, Math.min(1, edge.intensity ?? 1))
        : 1,
      ...(edge.modifier !== undefined
        ? { modifier: Math.max(-8, Math.min(8, Math.round(edge.modifier))) }
        : {}),
      ...(edge.dir ? { dir: [clampUnit(edge.dir[0]), clampUnit(edge.dir[1])] as Vec2 } : {}),
    };
    this.send(intent, nowMs);
  }

  /** Releases every held ability (input lost, tab hidden, controller swap). */
  releaseAll(nowMs: number): void {
    for (const action of [...this.held]) {
      this.held.delete(action);
      this.send(
        { action: action as ActionIntent['action'], phase: 'end', aim: this.lastAim, intensity: 1 },
        nowMs,
      );
    }
  }

  isHeld(action: string): boolean {
    return this.held.has(action);
  }

  private send(partial: Omit<ActionIntent, 'seq' | 'clientTime' | 'source'>, nowMs: number): void {
    this.sink(this.slot, {
      ...partial,
      seq: this.seq++,
      clientTime: Math.round(nowMs),
      source: this.source,
    });
  }
}
