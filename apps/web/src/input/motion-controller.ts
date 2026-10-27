/**
 * Handheld motion adapter (DOM side): device orientation events → MotionAim → the seat's reticle.
 * Abilities stay on the thumb buttons. Permission is requested only from a player's tap (iOS
 * requires it inside the click), and a sensor counts only once it has delivered real readings.
 */
import { create } from 'zustand';
import { MotionAim, type MotionConfig, type MotionState } from './motion';
import type { SeatInput } from './manager';
import { screenAimToArena } from './screen-aim';

export type MotionPermission = 'granted' | 'denied' | 'unsupported' | 'insecure';

/** What the motion UI shows (gauge, recenter prompt, failure notice). */
export interface MotionUi {
  readonly state: MotionState | 'off';
  /** Current aim in [-1, 1]² (x right, y up) for the tilt gauge. */
  readonly aim: readonly [number, number];
  /** Last automatic or requested re-zero, for a short notice. */
  readonly recentered: { readonly why: 'player' | 'rotation'; readonly at: number } | null;
}

export const useMotion = create<MotionUi>(() => ({
  state: 'off',
  aim: [0, 0],
  recentered: null,
}));

interface OrientationEventCtor {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

/**
 * Asks for motion access. MUST be called synchronously from a click/tap handler: iOS only shows
 * its prompt inside a user gesture. Browsers without a prompt resolve 'granted' (readings still
 * have to arrive — see probeOrientation).
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (!window.isSecureContext) return 'insecure';
  const ctor = (window as unknown as { DeviceOrientationEvent?: OrientationEventCtor })
    .DeviceOrientationEvent;
  if (!ctor) return 'unsupported';
  if (typeof ctor.requestPermission !== 'function') return 'granted';
  try {
    return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    // Called outside a gesture, or the player dismissed it.
    return 'denied';
  }
}

/**
 * Resolves true once a reading with all three angles arrives — what aiming needs (desktops
 * expose the API but send nothing or nulls; a phone without a gyroscope may report no alpha).
 */
export function probeOrientation(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.removeEventListener('deviceorientation', onEvent);
      clearTimeout(timer);
      resolve(ok);
    };
    const onEvent = (e: DeviceOrientationEvent) => {
      if (e.alpha !== null && e.beta !== null && e.gamma !== null) done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    window.addEventListener('deviceorientation', onEvent);
  });
}

const screenAngle = (): number => {
  const a = window.screen?.orientation?.angle;
  if (typeof a === 'number') return a;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? (legacy + 360) % 360 : 0;
};

/** Gyro aiming for one seat. Created only in motion mode; one listener, removed on dispose. */
export class MotionController {
  readonly motion: MotionAim;
  private paused = false;

  constructor(
    private readonly seat: SeatInput,
    cfg: Partial<MotionConfig> = {},
  ) {
    this.motion = new MotionAim(cfg);
    window.addEventListener('deviceorientation', this.onOrientation);
    document.addEventListener('visibilitychange', this.onVisibility);
    useMotion.setState({ state: 'waiting', aim: [0, 0], recentered: null });
  }

  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (this.paused) return;
    const out = this.motion.push({
      t: performance.now(),
      alpha: e.alpha,
      beta: e.beta,
      gamma: e.gamma,
      screenAngle: screenAngle(),
    });
    if (out.recentered) useMotion.setState({ recentered: { why: out.recentered, at: Date.now() } });
    if (out.aim) {
      const p = screenAimToArena(this.seat.slot, out.aim[0], out.aim[1]);
      this.seat.setReticle(p.x, p.z);
      this.seat.claim('gyro', performance.now());
    }
  };

  private onVisibility = (): void => {
    // Back from the background (or the OS paused sensors): resuming needs a recenter.
    if (document.hidden) this.motion.pause();
  };

  configure(cfg: Partial<MotionConfig>): void {
    this.motion.configure(cfg);
  }

  recenter(): void {
    this.motion.recenter();
  }

  /** InputAdapter calibration: the next reading becomes the neutral pose. */
  calibrate(): void {
    this.recenter();
  }

  /** Per frame: stall detection and the UI status (frozen while the game is paused). */
  tick(now: number): void {
    if (this.paused) return;
    const state = this.motion.tick(now);
    const ui = useMotion.getState();
    const aim = this.motion.current.aim ?? ui.aim;
    if (ui.state !== state || ui.aim[0] !== aim[0] || ui.aim[1] !== aim[1])
      useMotion.setState({ state, aim });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.motion.pause();
  }

  dispose(): void {
    window.removeEventListener('deviceorientation', this.onOrientation);
    document.removeEventListener('visibilitychange', this.onVisibility);
    useMotion.setState({ state: 'off', aim: [0, 0], recentered: null });
  }
}
