/**
 * Device capability matrix and the control modes it allows (Phase 06 / D06). Detection is
 * best-effort and never trusted alone: a motion sensor counts only after it has actually
 * delivered readings (see motion-controller), and every mode offers a one-tap way out.
 */

import type { InputSource } from '@ff/protocol';

/** How the local player controls their seat. Every mode produces the same ActionIntents. */
export type ControlMode = 'desktop' | 'touch' | 'motion' | 'camera' | 'accessible';

/** The intent source a seat reports from the moment it switches to a mode. */
export const MODE_SOURCE: Record<ControlMode, InputSource> = {
  desktop: 'keyboard',
  touch: 'touch',
  motion: 'gyro',
  camera: 'camera',
  accessible: 'touch',
};

/**
 * available — the API exists and needs no prompt; prompt — the browser asks the player first
 * (iOS motion permission); insecure — blocked outside HTTPS / localhost; none — no API.
 */
export type SensorSupport = 'available' | 'prompt' | 'insecure' | 'none';

export interface Capabilities {
  readonly secure: boolean;
  /** A touch screen is the primary pointer (phones, most tablets). */
  readonly touch: boolean;
  /** A mouse or trackpad is present (desktops, laptops, tablets with a pointer). */
  readonly finePointer: boolean;
  readonly orientation: SensorSupport;
  readonly camera: 'available' | 'insecure' | 'none';
  readonly gamepad: boolean;
  readonly vibration: boolean;
}

/** The subset of `window` the detector reads (injectable for tests). */
export interface CapabilityEnv {
  readonly isSecureContext?: boolean;
  readonly matchMedia?: (q: string) => { matches: boolean };
  readonly navigator?: {
    readonly maxTouchPoints?: number;
    readonly mediaDevices?: { getUserMedia?: unknown };
    readonly getGamepads?: unknown;
    readonly vibrate?: unknown;
  };
  readonly DeviceOrientationEvent?: { requestPermission?: unknown };
}

export function detectCapabilities(
  env: CapabilityEnv = globalThis as unknown as CapabilityEnv,
): Capabilities {
  const secure = env.isSecureContext === true;
  const media = (q: string) => env.matchMedia?.(q).matches === true;
  const nav = env.navigator;
  const coarse = media('(pointer: coarse)');
  const fine = media('(any-pointer: fine)') || media('(pointer: fine)');
  const touch = coarse || (!fine && (nav?.maxTouchPoints ?? 0) > 0);
  let orientation: SensorSupport = 'none';
  if (env.DeviceOrientationEvent) {
    if (!secure) orientation = 'insecure';
    else
      orientation =
        typeof env.DeviceOrientationEvent.requestPermission === 'function' ? 'prompt' : 'available';
  }
  const hasCamera = typeof nav?.mediaDevices?.getUserMedia === 'function';
  return {
    secure,
    touch,
    finePointer: fine,
    orientation,
    camera: hasCamera ? 'available' : secure ? 'none' : 'insecure',
    gamepad: typeof nav?.getGamepads === 'function',
    vibration: typeof nav?.vibrate === 'function',
  };
}

export interface ModeOption {
  readonly mode: ControlMode;
  readonly label: string;
  /** One line on what it is and what it needs. */
  readonly detail: string;
  readonly available: boolean;
  /** Why it is unavailable (shown instead of hiding the option). */
  readonly unavailable?: string;
  readonly recommended: boolean;
}

/**
 * The control modes for this device, in display order. Touch, desktop and accessible play never
 * depend on a permission, so a player who denies camera and motion can always play.
 */
export function controlModes(c: Capabilities): ModeOption[] {
  const motionOk = c.touch && (c.orientation === 'available' || c.orientation === 'prompt');
  // A phone can still take a Bluetooth keyboard or game controller.
  const desktopOk = c.finePointer || !c.touch || c.gamepad;
  return [
    {
      mode: 'touch',
      label: 'Touch',
      detail: 'Drag on the arena to aim; thumb buttons cast',
      available: c.touch,
      ...(c.touch ? {} : { unavailable: 'No touch screen detected' }),
      recommended: c.touch,
    },
    {
      mode: 'motion',
      label: 'Motion',
      detail: 'Tilt the phone to aim; thumb buttons cast',
      available: motionOk,
      ...(motionOk
        ? {}
        : {
            unavailable: !c.touch
              ? 'Needs a phone or tablet'
              : c.orientation === 'insecure'
                ? 'Needs a secure (HTTPS) page'
                : 'No motion sensor API in this browser',
          }),
      recommended: false,
    },
    {
      mode: 'desktop',
      label: c.touch ? 'Keyboard / controller' : 'Keyboard & mouse',
      detail: c.gamepad ? 'Mouse or WASD aim; a game controller works too' : 'Mouse or WASD aim',
      available: desktopOk,
      ...(desktopOk ? {} : { unavailable: 'No keyboard, mouse or controller support' }),
      recommended: !c.touch,
    },
    {
      mode: 'camera',
      label: 'Camera',
      detail: 'Hand gestures; the video stays on this device',
      available: c.camera === 'available',
      ...(c.camera === 'available'
        ? {}
        : {
            unavailable:
              c.camera === 'insecure' ? 'Needs a secure (HTTPS) page' : 'No camera API available',
          }),
      recommended: false,
    },
    {
      mode: 'accessible',
      label: 'Simplified',
      detail: 'Tap where to aim, big buttons, tap-to-toggle holds — no fast moves',
      available: true,
      recommended: false,
    },
  ];
}

/** The mode a new player starts in: the first recommended, available one. */
export function defaultMode(c: Capabilities): ControlMode {
  return controlModes(c).find((o) => o.recommended && o.available)?.mode ?? 'accessible';
}
