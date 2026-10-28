/**
 * How the Rift Core looks this frame (7C / D09), from authoritative state only: its speed, the
 * deliberate spin that curves it, heat, charge and wetness from the snapshot, and the impact, goal
 * and kickoff events that touch it. Nothing here decides an outcome; it narrates what the
 * authority did. Pure and allocation-free: the component keeps one `CoreLook` and steps it.
 */
import { DEFAULT_RULES } from '@ff/game-data';

export interface CoreLookInput {
  /** Seconds since the last frame (clamped by the caller). */
  readonly dt: number;
  /** Speed of the displayed core (m/s). */
  readonly speed: number;
  /** The core's deliberate spin (rad/s about +y; its sign is the curve's side). */
  readonly spin: number;
  /** Temperature proxy (°C). */
  readonly temp: number;
  readonly charge: number;
  readonly wet: number;
  /** Strongest impact on the core since the last frame, 0..1 (0: none). */
  readonly impact: number;
  /** A goal was scored since the last frame: the core collapses into the gate. */
  readonly goal: boolean;
  /** The next kickoff began: the core forms again at the centre. */
  readonly kickoff: boolean;
  readonly reducedMotion: boolean;
}

export type CorePhase = 'whole' | 'collapsing' | 'gone' | 'forming';

export interface CoreLook {
  /** 0..1 from speed (smoothed). */
  energy: number;
  /** 0..1 from |spin|. */
  spinRate: number;
  /** Seam glow (the light leaking between the shell's plates). */
  crack: number;
  /** Plate separation, as a fraction of the core's radius. */
  explode: number;
  /** 0..1 warmth from heat. */
  heat: number;
  charge: number;
  wet: number;
  /** Impact flare, 0..1, decaying. */
  shock: number;
  /** Whole-core scale: 1 whole, 0 collapsed. */
  scale: number;
  /** Collapse / re-form flash, 0..1. */
  flash: number;
  phase: CorePhase;
  /** Seconds in the current phase. */
  t: number;
}

/** Collapse into the gate after a goal (D09: under 1.5 s), and forming again at kickoff. */
export const COLLAPSE_S = 0.6;
export const FORM_S = 0.5;
/** A collapsed core forms again on its own if no kickoff arrives (a missed event, a rejoin). */
export const GONE_MAX_S = 6;
/** Speed at which the core reads fully energised. */
const FULL_SPEED = 18;
const ENERGY_TAU = 0.15;
const SHOCK_TAU = 0.25;
const MAX_SPIN = DEFAULT_RULES.hand.maxSpin;

export function newCoreLook(): CoreLook {
  return {
    energy: 0,
    spinRate: 0,
    crack: 0.6,
    explode: 0.02,
    heat: 0,
    charge: 0,
    wet: 0,
    shock: 0,
    scale: 1,
    flash: 0,
    phase: 'whole',
    t: 0,
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);
const finite = (v: number, d = 0) => (Number.isFinite(v) ? v : d);

/** Steps `look` in place for one frame and returns it. */
export function stepCoreLook(look: CoreLook, input: CoreLookInput): CoreLook {
  const dt = Math.max(0, Math.min(0.1, finite(input.dt)));
  look.energy +=
    (clamp01(finite(input.speed) / FULL_SPEED) - look.energy) * (1 - Math.exp(-dt / ENERGY_TAU));
  look.spinRate = clamp01(Math.abs(finite(input.spin)) / MAX_SPIN);
  look.heat = clamp01((finite(input.temp, 20) - 40) / 120);
  look.charge = clamp01(finite(input.charge));
  look.wet = clamp01(finite(input.wet));
  look.shock = Math.max(clamp01(input.impact), look.shock * Math.exp(-dt / SHOCK_TAU));

  // Goal → collapse → gone → (kickoff) → forming → whole.
  if (input.goal && look.phase !== 'collapsing' && look.phase !== 'gone') {
    look.phase = 'collapsing';
    look.t = 0;
  } else if (input.kickoff && (look.phase === 'gone' || look.phase === 'collapsing')) {
    look.phase = 'forming';
    look.t = 0;
  } else {
    look.t += dt;
  }
  if (look.phase === 'collapsing' && look.t >= COLLAPSE_S) {
    look.phase = 'gone';
    look.t = 0;
  } else if (look.phase === 'gone' && look.t >= GONE_MAX_S) {
    look.phase = 'forming';
    look.t = 0;
  } else if (look.phase === 'forming' && look.t >= FORM_S) {
    look.phase = 'whole';
    look.t = 0;
  }
  const motion = input.reducedMotion ? 0.3 : 1;
  switch (look.phase) {
    case 'whole':
      look.scale = 1;
      look.flash = Math.max(0, look.flash - dt * 4);
      break;
    case 'collapsing': {
      // Drawn in, accelerating, with a bright pinch at the end.
      const k = look.t / COLLAPSE_S;
      look.scale = 1 - k * k;
      look.flash = k * k;
      break;
    }
    case 'gone':
      look.scale = 0;
      look.flash = Math.max(0, look.flash - dt * 3);
      break;
    case 'forming': {
      // Out from a point with a slight overshoot, the plates settling into place.
      const k = look.t / FORM_S;
      const back = 1.6;
      const u = k - 1;
      look.scale = Math.max(0, 1 + (back + 1) * u * u * u + back * u * u);
      look.flash = (1 - k) * 0.8;
      break;
    }
  }
  if (input.reducedMotion) look.flash *= 0.5;

  // The seams glow with energy, with spin (the curve is being wound in) and on impact; charge
  // crackles; water dulls them.
  look.crack =
    (0.6 + 0.6 * look.energy + 0.6 * look.spinRate + 1.2 * look.shock + 0.4 * look.charge) *
    (1 - 0.3 * look.wet);
  // The plates part as the core spins and jolt outward on an impact.
  look.explode = 0.02 + (0.05 * look.spinRate + 0.03 * look.energy + 0.12 * look.shock) * motion;
  return look;
}
