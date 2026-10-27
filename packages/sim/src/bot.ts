import { DEFAULT_ABILITIES, MERIDIAN_ARENA, type ArenaLayout } from '@ff/game-data';
import type { ActionIntent, PlayerSlot, Vec2, WorldSnapshot } from '@ff/protocol';
import { Rng } from './rng.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

interface BotProfile {
  /** Ticks of reaction delay (the bot reasons on an older snapshot). */
  readonly reactionTicks: number;
  /** Aim jitter in metres. */
  readonly aimNoise: number;
  /** Seconds of core-motion lookahead. */
  readonly lookahead: number;
  readonly usesGuard: boolean;
  readonly usesSweep: boolean;
  readonly usesLift: boolean;
  /** Minimum ticks between pulses beyond the ability cooldown (spam control / humanity). */
  readonly pulseGap: number;
}

const PROFILES: Record<BotDifficulty, BotProfile> = {
  easy: {
    reactionTicks: 9,
    aimNoise: 1.1,
    lookahead: 0.15,
    usesGuard: false,
    usesSweep: false,
    usesLift: false,
    pulseGap: 24,
  },
  normal: {
    reactionTicks: 5,
    aimNoise: 0.55,
    lookahead: 0.3,
    usesGuard: true,
    usesSweep: false,
    usesLift: false,
    pulseGap: 14,
  },
  hard: {
    reactionTicks: 2,
    aimNoise: 0.25,
    lookahead: 0.4,
    usesGuard: true,
    usesSweep: true,
    usesLift: true,
    pulseGap: 10,
  },
};

/**
 * Snapshot-only opponent: reads the same WorldSnapshot a remote client receives and emits legal
 * ActionIntents through the normal validation path (no privileged world access). Deterministic for
 * a given seed and snapshot stream.
 */
export class SnapshotBot {
  private seq = 0;
  private readonly rng: Rng;
  private readonly history: WorldSnapshot[] = [];
  private lastPulseTick = -1000;
  private lastGuardTick = -1000;
  private lastSweepTick = -1000;
  private liftUntil = -1;
  private readonly profile: BotProfile;

  constructor(
    readonly slot: PlayerSlot,
    readonly difficulty: BotDifficulty = 'normal',
    seed = 99,
    private readonly arena: ArenaLayout = MERIDIAN_ARENA,
  ) {
    this.rng = new Rng(seed ^ (slot * 0x5bd1e995));
    this.profile = PROFILES[difficulty];
  }

  /** Feed every snapshot; returns the intents to send this tick (possibly none). */
  think(snapshot: WorldSnapshot): ActionIntent[] {
    this.history.push(snapshot);
    if (this.history.length > 40) this.history.shift();
    const view = this.history[Math.max(0, this.history.length - 1 - this.profile.reactionTicks)]!;
    const tick = snapshot.tick;
    const out: ActionIntent[] = [];
    const phase = view.match.phase;
    if (phase !== 'playing' && phase !== 'countdown') return out;

    const me = view.players[this.slot];
    const core = view.entities.find((e) => e.kind === 'core');
    if (!core) return out;
    const L = this.arena.halfLength;
    const ownX = this.slot === 0 ? -L : L;
    const enemyX = -ownX;
    const t = this.profile.lookahead;
    const cx = core.p[0] + core.v[0] * t;
    const cz = core.p[2] + core.v[2] * t;

    // Is the core within our reachable half?
    const reachX = this.slot === 0 ? cx < 2 : cx > -2;
    let tx: number;
    let tz: number;
    if (reachX) {
      // Get behind the core on the line toward the enemy goal (aim slightly off-centre).
      const gz = (this.rng.next() - 0.5) * this.arena.goal.mouthHalfWidth * 0.8;
      const dx = enemyX - cx;
      const dz = gz - cz;
      const d = Math.hypot(dx, dz) || 1;
      tx = cx - (dx / d) * 1.8;
      tz = cz - (dz / d) * 1.8;
    } else {
      // Defend: shadow the core's z between it and our goal.
      tx = ownX + (this.slot === 0 ? 7 : -7);
      tz = Math.max(-6, Math.min(6, cz * 0.6));
    }
    tx += (this.rng.next() - 0.5) * this.profile.aimNoise;
    tz += (this.rng.next() - 0.5) * this.profile.aimNoise;
    const aim = this.toAim(tx, tz);

    if (tick % 3 === this.slot) out.push(this.intent('aim', 'hold', aim, tick));
    if (phase !== 'playing') return out;

    const mx = me.m[0];
    const mz = me.m[1];
    const dist = Math.hypot(core.p[0] - mx, core.p[2] - mz);
    const pushX = core.p[0] - mx;
    const pushZ = core.p[2] - mz;
    const toGoalX = enemyX - core.p[0];
    const toGoalZ = -core.p[2];
    const align =
      (pushX * toGoalX + pushZ * toGoalZ) /
      ((Math.hypot(pushX, pushZ) || 1) * (Math.hypot(toGoalX, toGoalZ) || 1));
    const pulseReady = (me.cd.pulse ?? 0) === 0 && me.energy >= DEFAULT_ABILITIES.pulse.cost;

    // Emergency clear: core is close and heading for our goal — push it away from goal regardless.
    const towardOwn = (ownX - core.p[0]) * core.v[0] > 0 ? Math.abs(core.v[0]) : 0;
    const danger = Math.abs(core.p[0] - ownX) < 9 && towardOwn > 6;

    if (
      pulseReady &&
      dist < DEFAULT_ABILITIES.pulse.fullStrengthRadius + 0.9 &&
      (align > 0.55 || danger) &&
      tick - this.lastPulseTick >= this.profile.pulseGap
    ) {
      this.lastPulseTick = tick;
      out.push(this.intent('pulse', 'tap', aim, tick));
    }

    if (
      this.profile.usesGuard &&
      danger &&
      dist > 3 &&
      (me.cd.guard ?? 0) === 0 &&
      me.energy >= DEFAULT_ABILITIES.guard.cost + 10 &&
      tick - this.lastGuardTick > 45
    ) {
      this.lastGuardTick = tick;
      out.push(this.intent('guard', 'tap', aim, tick));
    }

    if (
      this.profile.usesSweep &&
      !reachX &&
      (me.cd.sweep ?? 0) === 0 &&
      me.energy >= DEFAULT_ABILITIES.sweep.cost + 30 &&
      tick - this.lastSweepTick > 120 &&
      Math.abs(core.p[0]) < 6
    ) {
      this.lastSweepTick = tick;
      out.push(this.intent('sweep', 'tap', aim, tick, this.rng.next() < 0.5 ? -1 : 1));
    }

    if (this.profile.usesLift) {
      if (me.hold === 'lift') {
        if (tick >= this.liftUntil) out.push(this.intent('lift', 'end', aim, tick));
      } else if (dist < 3 && reachX && align > 0.7 && me.energy > 50 && this.rng.next() < 0.02) {
        this.liftUntil = tick + 25;
        out.push(this.intent('lift', 'start', aim, tick));
      }
    }
    return out;
  }

  private toAim(x: number, z: number): Vec2 {
    const ax = Math.max(-1, Math.min(1, x / this.arena.halfLength));
    const az = Math.max(-1, Math.min(1, z / this.arena.halfWidth));
    return [ax, az];
  }

  private intent(
    action: ActionIntent['action'],
    phase: ActionIntent['phase'],
    aim: Vec2,
    tick: number,
    modifier?: number,
  ): ActionIntent {
    return {
      seq: this.seq++,
      clientTime: tick * 33,
      action,
      phase,
      aim,
      intensity: 1,
      ...(modifier !== undefined ? { modifier } : {}),
      source: 'bot',
    };
  }
}
