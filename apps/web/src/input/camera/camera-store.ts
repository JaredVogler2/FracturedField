import { create } from 'zustand';
import type { CalibrationProgress, GestureAction, TrackStatus } from '@ff/gestures';
import type { CameraError, CameraState, CameraStats } from './camera-session';

/** What the camera UI shows: pipeline state, tracking quality and the last recognised gesture. */
export interface CameraUi {
  /** Where the player is in the camera flow. */
  readonly phase: 'off' | 'setup' | 'calibrating' | 'practice' | 'active';
  readonly state: CameraState;
  readonly error: CameraError | null;
  readonly track: TrackStatus | null;
  readonly stats: CameraStats | null;
  readonly calibration: CalibrationProgress | null;
  readonly lastGesture: { readonly action: GestureAction; readonly at: number } | null;
  /** Practice goals reached (onboarding requires a successful PULSE and GUARD). */
  readonly practiced: Readonly<Partial<Record<GestureAction, number>>>;
  /**
   * Hands-on practice (ADR-0009): when the hand last closed past the grip that holds and opened
   * past the grip that lets go.
   */
  readonly handsPracticed: { readonly hold?: number; readonly release?: number };
}

export const useCamera = create<CameraUi>(() => ({
  phase: 'off',
  state: 'idle',
  error: null,
  track: null,
  stats: null,
  calibration: null,
  lastGesture: null,
  practiced: {},
  handsPracticed: {},
}));

export function resetCameraUi(): void {
  useCamera.setState({
    phase: 'off',
    state: 'idle',
    error: null,
    track: null,
    stats: null,
    calibration: null,
    lastGesture: null,
    practiced: {},
    handsPracticed: {},
  });
}
