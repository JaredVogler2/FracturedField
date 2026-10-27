import type { ActionIntent, HandState, InputSource, PlayerSlot, Vec2 } from '@ff/protocol';
import type { ActionEdge, AimSpace, IntentSink } from './types.js';

const clampUnit = (v: number): number => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** A described hand, clamped and NaN-safe (the authority clamps again). */
function cleanHand(h: HandState): HandState {
  return { grip: clamp01(h.grip), push: clampUnit(h.push), twist: clampUnit(h.twist) };
}

/** Anything but an open, still hand (it then needs keep-alives to stay valid). */
const handActive = (h: HandState | null): boolean =>
  !!h && (h.grip > 0.05 || Math.abs(h.push) > 0.02 || Math.abs(h.twist) > 0.02);

/**
 * An active hand is re-sent at least this often: the authority treats a hand older than 300 ms
 * as open and still (a lost connection or a lost hand must never leave a body gripped).
 */
export const HAND_KEEPALIVE_MS = 100;

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
  private lastHand: HandState | null = null;
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

  /** Sequence number the next intent will carry. */
  get nextSeq(): number {
    return this.seq;
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

  /**
   * Sends an aim update — with the hand's continuous state when the input has one (ADR-0009) —
   * if the throttle interval elapsed and the aim moved or the hand changed, or an active hand
   * needs its keep-alive. A hand that goes open and still is sent once more, then rests.
   */
  aim(aim: Vec2, nowMs: number, force = false, hand?: HandState | null): void {
    const a: Vec2 = [clampUnit(aim[0]), clampUnit(aim[1])];
    const h = hand ? cleanHand(hand) : null;
    const moved = Math.abs(a[0] - this.lastAim[0]) + Math.abs(a[1] - this.lastAim[1]);
    const prev = this.lastHand;
    const handChanged =
      h && prev
        ? Math.abs(h.grip - prev.grip) > 0.03 ||
          Math.abs(h.push - prev.push) > 0.05 ||
          Math.abs(h.twist - prev.twist) > 0.03
        : handActive(h) !== handActive(prev);
    const keepAlive = handActive(h) && nowMs - this.lastAimSent >= HAND_KEEPALIVE_MS;
    if (!force && nowMs - this.lastAimSent < 1000 / this.aimHz) return;
    if (!force && moved < 0.0005 && !handChanged && !keepAlive && nowMs - this.lastAimSent < 500)
      return;
    this.lastAim = a;
    this.lastAimSent = nowMs;
    this.lastHand = h;
    this.send(
      { action: 'aim', phase: 'hold', aim: a, intensity: 1, ...(h ? { hand: h } : {}) },
      nowMs,
    );
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

  /**
   * Forgets held abilities without sending anything: after a reconnect the authority has already
   * cancelled them, and a stale END would only be refused.
   */
  forgetHeld(): void {
    this.held.clear();
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
