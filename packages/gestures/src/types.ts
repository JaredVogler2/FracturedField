import type { HandFeatures } from './features.js';
/**
 * Canonical, transport-free landmark and gesture types. Everything in this package runs on the
 * player's own device; landmark frames are ephemeral and never serialised to the network — only
 * the resulting game actions are (as ordinary ActionIntents).
 */

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Anatomical hand (already corrected for camera facing / mirroring by the adapter). */
export type Handedness = 'left' | 'right';

/** MediaPipe hand landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const;

/** MediaPipe pose landmark indices used here (33-point model). */
export const POSE = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
} as const;

export interface HandObservation {
  /**
   * 21 landmarks in normalised coordinates of the raw (unmirrored) camera frame: x right, y down,
   * both in [0, 1]; z is depth relative to the wrist on roughly the x scale (smaller = closer).
   */
  readonly landmarks: readonly Point3[];
  readonly handedness: Handedness;
  /** Detection / handedness confidence in [0, 1]. */
  readonly score: number;
}

export interface PoseObservation {
  /** 33 landmarks, same coordinate convention as hands. */
  readonly landmarks: readonly Point3[];
  readonly score: number;
}

export interface LandmarksFrame {
  /** Capture time of the camera frame (ms, monotonic clock of the device). */
  readonly t: number;
  readonly hands: readonly HandObservation[];
  readonly pose?: PoseObservation | null;
  /** Source frame size; only the aspect ratio matters (distances are aspect-corrected). */
  readonly width: number;
  readonly height: number;
}

/** Discrete hand shapes recognised from finger extension (with hysteresis). */
export type HandShape = 'open' | 'fist' | 'point' | 'vee' | 'three' | 'thumb' | 'ok' | 'unknown';

/** Game-level gesture actions. Pick 1 / pick 2 map to the seat's two advanced loadout moves. */
export type GestureAction =
  'pulse' | 'lift' | 'sweep' | 'guard' | 'wet' | 'heat' | 'pick1' | 'pick2';

export interface GestureEvent {
  readonly action: GestureAction;
  /** `tap` for one-shot casts; `start`/`end` for holds (LIFT, held picks). */
  readonly phase: 'tap' | 'start' | 'end';
  /** Screen-space direction (x right, y up, unit length) for SWEEP. */
  readonly dir?: readonly [number, number];
  /** Frame time that triggered the event (latency telemetry). */
  readonly t: number;
}

export type TrackState = 'searching' | 'tracking' | 'coasting' | 'lost';

export interface TrackStatus {
  readonly state: TrackState;
  /** Hands visible in the latest frame (any person). */
  readonly handsVisible: number;
  /** True when the locked hand is held steadily enough for precise aiming. */
  readonly stable: boolean;
  /** Current recognised shape of the tracked hand. */
  readonly shape: HandShape;
  /** Milliseconds since the tracked hand was last seen (0 while tracked). */
  readonly lostMs: number;
  /** A second hand was rejected (bystander or off-hand outside the play range). */
  readonly rejected: number;
}

export interface GestureOutput {
  /** Screen-space aim in [-1, 1]² (x right, y up), or null while not tracking. */
  readonly aim: readonly [number, number] | null;
  readonly events: readonly GestureEvent[];
  readonly status: TrackStatus;
  /** The locked hand this frame (aspect-corrected units) — for calibration and UI guides. */
  readonly hand: {
    readonly center: { readonly x: number; readonly y: number };
    readonly scale: number;
    /** Palm speed in palm widths per second. */
    readonly speed: number;
    /** Palm normal z (negative = palm facing the camera, given the hand's label). */
    readonly normalZ: number;
    readonly handedness: Handedness;
    /** The locked hand's features this frame (the continuous channel reads its closure, size). */
    readonly features: HandFeatures;
    /** Its knuckle-line angle in the image (radians, clockwise), for the twist. */
    readonly roll: number;
  } | null;
}
