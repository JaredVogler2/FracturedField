/**
 * Capability matrix → control modes. Touch, desktop and simplified play never depend on a
 * permission, so a player who denies camera and motion always has a way to play.
 */
import { describe, expect, it } from 'vitest';
import {
  controlModes,
  defaultMode,
  detectCapabilities,
  type CapabilityEnv,
  type ControlMode,
} from './capabilities';

const env = (o: {
  secure?: boolean;
  coarse?: boolean;
  fine?: boolean;
  touchPoints?: number;
  orientation?: 'plain' | 'ios' | null;
  camera?: boolean;
  gamepad?: boolean;
}): CapabilityEnv => ({
  isSecureContext: o.secure ?? true,
  matchMedia: (q: string) => ({
    matches:
      (q === '(pointer: coarse)' && o.coarse === true) ||
      ((q === '(any-pointer: fine)' || q === '(pointer: fine)') && o.fine === true),
  }),
  navigator: {
    maxTouchPoints: o.touchPoints ?? 0,
    ...(o.camera === false ? {} : { mediaDevices: { getUserMedia: () => undefined } }),
    ...(o.gamepad === false ? {} : { getGamepads: () => [] }),
  },
  ...(o.orientation === null
    ? {}
    : {
        DeviceOrientationEvent:
          o.orientation === 'ios' ? { requestPermission: () => undefined } : {},
      }),
});

const available = (e: CapabilityEnv) =>
  controlModes(detectCapabilities(e))
    .filter((m) => m.available)
    .map((m) => m.mode);

describe('capability matrix', () => {
  it('iPhone Safari: touch first, motion behind a permission prompt, camera, simplified', () => {
    const c = detectCapabilities(env({ coarse: true, touchPoints: 5, orientation: 'ios' }));
    expect(c).toMatchObject({ touch: true, finePointer: false, orientation: 'prompt' });
    expect(available(env({ coarse: true, touchPoints: 5, orientation: 'ios' }))).toEqual<
      ControlMode[]
    >(['touch', 'motion', 'desktop', 'camera', 'accessible']);
    expect(defaultMode(c)).toBe('touch');
  });

  it('Android Chrome: motion is available without a prompt', () => {
    const c = detectCapabilities(env({ coarse: true, touchPoints: 5, orientation: 'plain' }));
    expect(c.orientation).toBe('available');
    expect(defaultMode(c)).toBe('touch');
  });

  it('desktop: keyboard & mouse recommended; no motion even though the event API exists', () => {
    const e = env({ fine: true, orientation: 'plain' });
    const modes = controlModes(detectCapabilities(e));
    expect(modes.find((m) => m.mode === 'motion')).toMatchObject({
      available: false,
      unavailable: 'Needs a phone or tablet',
    });
    expect(defaultMode(detectCapabilities(e))).toBe('desktop');
  });

  it('insecure origin: motion and camera are unavailable with the reason shown', () => {
    const modes = controlModes(
      detectCapabilities(
        env({ secure: false, coarse: true, touchPoints: 5, orientation: 'plain', camera: false }),
      ),
    );
    expect(modes.find((m) => m.mode === 'motion')?.unavailable).toBe('Needs a secure (HTTPS) page');
    expect(modes.find((m) => m.mode === 'camera')?.unavailable).toBe('Needs a secure (HTTPS) page');
    // …yet the player can still play.
    expect(modes.filter((m) => m.available).map((m) => m.mode)).toEqual([
      'touch',
      'desktop',
      'accessible',
    ]);
  });

  it('a touch laptop (touch points + fine pointer) defaults to keyboard & mouse', () => {
    const c = detectCapabilities(env({ fine: true, touchPoints: 10, orientation: null }));
    expect(c.touch).toBe(false);
    expect(defaultMode(c)).toBe('desktop');
  });

  it('nothing detectable still leaves the simplified mode', () => {
    const modes = controlModes(
      detectCapabilities({ isSecureContext: true, matchMedia: () => ({ matches: false }) }),
    );
    expect(modes.find((m) => m.mode === 'accessible')?.available).toBe(true);
    expect(modes.find((m) => m.mode === 'desktop')?.available).toBe(true);
  });
});
