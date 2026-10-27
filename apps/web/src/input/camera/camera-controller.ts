import { DEFAULT_ABILITIES } from '@ff/game-data';
import {
  Calibrator,
  ContinuousMapper,
  GestureEngine,
  OPEN_HAND,
  type Calibration,
  type GestureConfig,
  type GestureEvent,
  type GestureOutput,
  type Handedness,
  type HandShape,
  type LandmarksFrame,
} from '@ff/gestures';
import type { ActionEdge } from '@ff/controls';
import type { SeatInput } from '../manager';
import { view } from '../../render/view';
import { useCamera } from './camera-store';
import { screenAimToArena } from '../screen-aim';

export type CameraControlMode = 'calibrate' | 'practice' | 'play';

export { screenAimToArena } from '../screen-aim';

/** Signs that name an element or a pick: while one is shown, the hand never grips. */
const SIGN_SHAPES: ReadonlySet<HandShape> = new Set(['vee', 'thumb', 'point', 'three', 'ok']);
/** Discrete moves the hand's own motion replaces in hands-on play (ADR-0009). */
const CONTINUOUS_REPLACES: ReadonlySet<string> = new Set(['pulse', 'lift', 'sweep']);

/**
 * Camera input adapter for one local seat. Landmark frames (from the on-device vision worker, or
 * synthetic ones in tests) go through the gesture engine; the result drives the seat exactly like
 * keyboard or touch: the same reticle, the same ActionIntents, the same validation by the
 * authority. During calibration and practice nothing is sent to the game.
 *
 * Hands-on (the seat's `handsOn`, ADR-0009): the tracked hand's closure, approach and wrist turn
 * become the seat's continuous hand (grip, push, twist) every frame; fist holds, palm pushes and
 * strokes no longer fire LIFT / PULSE / SWEEP — gripping, pushing and sweeping are the hand's own
 * motion now. Element and pick signs stay, and never grip while they are shown.
 */
export class CameraController {
  readonly engine: GestureEngine;
  private readonly continuous = new ContinuousMapper();
  private seat: SeatInput | null = null;
  private calibrator: Calibrator | null = null;
  private mode: CameraControlMode = 'play';
  private paused = false;
  private aspect = 16 / 9;
  /** Swap every hand label (learned at calibration: this camera's labels are inverted). */
  private flip = false;
  private dominant: Handedness | 'any';

  constructor(
    cfg: Partial<GestureConfig>,
    calibration: Calibration | null,
    private readonly onCalibrated: (c: Calibration, dominant: Handedness) => void,
  ) {
    this.dominant = cfg.dominant ?? 'right';
    this.engine = new GestureEngine(cfg, calibration);
    if (calibration) this.adopt(calibration);
  }

  /**
   * Hand labels from the model depend on mirroring conventions; instead of trusting them, the
   * calibration measures them: the player shows an open palm, so its normal must face the camera.
   * If it reads as facing away, every label is flipped. The calibrated hand becomes the playing
   * hand, whatever it was called.
   */
  private adopt(c: Calibration): Handedness | null {
    this.flip = c.palmFacing !== undefined && c.palmFacing > 0.1;
    if (!c.hand) return null;
    const other: Handedness = c.hand === 'right' ? 'left' : 'right';
    const dominant = this.flip ? other : c.hand;
    this.dominant = dominant;
    this.engine.configure({ dominant });
    return dominant;
  }

  attach(seat: SeatInput | null): void {
    if (this.seat && this.seat !== seat) this.releaseHolds();
    this.seat = seat;
  }

  setMode(mode: CameraControlMode): void {
    if (mode === this.mode) return;
    // Leaving play (or entering it) never carries a hold across.
    this.releaseHolds();
    this.mode = mode;
    this.calibrator = mode === 'calibrate' ? new Calibrator(this.aspect) : null;
    if (mode === 'calibrate') {
      // Measure raw labels: any single hand, no flip.
      this.flip = false;
      this.engine.configure({ dominant: 'any' });
    } else this.engine.configure({ dominant: this.dominant });
  }

  configure(cfg: Partial<GestureConfig>): void {
    if (cfg.dominant) this.dominant = cfg.dominant;
    this.engine.configure(this.mode === 'calibrate' ? { ...cfg, dominant: 'any' } : cfg);
  }

  /** Menu open, lobby or match over: end holds and send nothing until resumed. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.releaseHolds();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    // Whatever the hand did while paused does not carry over into play.
    this.engine.cancel(performance.now());
  }

  private releaseHolds(): void {
    const now = performance.now();
    this.apply(this.engine.cancel(now), now);
    this.continuous.reset();
    this.seat?.setHand(OPEN_HAND, 'camera');
  }

  feed(input: LandmarksFrame): GestureOutput | null {
    if (input.width > 0 && input.height > 0) this.aspect = input.width / input.height;
    const frame: LandmarksFrame = this.flip
      ? {
          ...input,
          hands: input.hands.map((h) => ({
            ...h,
            handedness: h.handedness === 'right' ? 'left' : 'right',
          })),
        }
      : input;
    const out = this.engine.process(frame);
    const now = performance.now();
    useCamera.setState({ track: out.status });
    if (this.mode === 'calibrate') {
      const progress = this.calibrator!.update(
        frame.t,
        out.hand,
        out.status.shape === 'open',
        out.hand?.speed ?? 0,
      );
      useCamera.setState({ calibration: progress });
      if (progress.phase === 'done' && progress.result) {
        this.engine.setCalibration(progress.result);
        const dominant =
          this.adopt(progress.result) ?? (this.dominant === 'any' ? 'right' : this.dominant);
        this.onCalibrated(progress.result, dominant);
        this.calibrator = null;
        this.mode = 'practice';
        this.engine.configure({ dominant });
      }
      return out;
    }
    if (out.events.length > 0) {
      const last = out.events[out.events.length - 1]!;
      const practiced = { ...useCamera.getState().practiced };
      for (const e of out.events) if (e.phase !== 'end') practiced[e.action] = now;
      useCamera.setState({ lastGesture: { action: last.action, at: now }, practiced });
    }
    // Paused (menu open, lobby, match over): tracking status keeps updating, nothing is sent.
    if (this.mode !== 'play' || !this.seat || this.paused) return out;
    if (out.aim) {
      const p = screenAimToArena(this.seat.slot, out.aim[0], out.aim[1]);
      this.seat.setReticle(p.x, p.z);
      this.seat.claim('camera', now);
    }
    if (this.seat.handsOn) {
      const h = out.hand;
      const channel = this.continuous.update(h?.features ?? null, h?.roll ?? null, frame.t);
      const signing = SIGN_SHAPES.has(out.status.shape);
      this.seat.setHand(signing ? { ...channel, grip: 0 } : channel, 'camera');
    }
    this.apply(out.events, now);
    return out;
  }

  private apply(events: readonly GestureEvent[], now: number): void {
    const seat = this.seat;
    if (!seat || this.mode !== 'play') return;
    for (const e of events) {
      if (seat.handsOn && CONTINUOUS_REPLACES.has(e.action)) continue;
      const edge = this.toEdge(e, seat);
      if (edge) seat.edge(edge, now, 'camera');
    }
  }

  private toEdge(e: GestureEvent, seat: SeatInput): ActionEdge | null {
    switch (e.action) {
      case 'pulse':
        return { action: 'pulse', phase: 'tap' };
      case 'guard':
        return { action: 'guard', phase: 'tap' };
      case 'lift':
        return e.phase === 'tap' ? null : { action: 'lift', phase: e.phase };
      case 'wet':
        return { action: 'infuse', phase: 'tap', modifier: 0 };
      case 'heat':
        return { action: 'infuse', phase: 'tap', modifier: 1 };
      case 'sweep': {
        const [sx, sy] = e.dir ?? [0, 1];
        const { right, up } = view.groundAxes();
        const dx = right.x * sx + up.x * sy;
        const dz = right.z * sx + up.z * sy;
        const modifier = sy !== 0 ? (sy > 0 ? 1 : -1) : sx < 0 ? 1 : -1;
        return { action: 'sweep', phase: 'tap', modifier, dir: [dx, dz] };
      }
      case 'pick1':
      case 'pick2': {
        const ability = seat.loadout[e.action === 'pick1' ? 0 : 1];
        if (DEFAULT_ABILITIES[ability].kind === 'hold')
          return e.phase === 'tap' ? null : { action: ability, phase: e.phase };
        // Tap moves fire on the sign's start; its release means nothing.
        return e.phase === 'end' ? null : { action: ability, phase: 'tap' };
      }
    }
  }

  dispose(): void {
    this.releaseHolds();
    this.seat = null;
  }
}
