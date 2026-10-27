/**
 * Camera input adapter: synthetic landmark frames in, ActionIntents out — the same intents any
 * other input produces (source 'camera'), with holds always ended and nothing sent while paused,
 * practising or calibrating.
 */
import { describe, expect, it } from 'vitest';
import type { AdvancedAbilityId } from '@ff/game-data';
import type { ActionIntent } from '@ff/protocol';
import { timeline, type Key, type TimelineSpec } from '@ff/gestures/synthetic';
import type { Calibration, LandmarksFrame } from '@ff/gestures';
import { SeatInput } from '../manager';
import { CameraController, screenAimToArena } from './camera-controller';

const HOME = { cx: 0.5, cy: 0.55, size: 0.15 } as const;

function rig(
  calibration: Calibration | null = null,
  loadout: readonly [AdvancedAbilityId, AdvancedAbilityId] = ['freeze', 'magnetize'],
) {
  const sent: ActionIntent[] = [];
  const seat = new SeatInput(0, 'keyboard', (_slot, intent) => sent.push(intent), loadout);
  const ctl = new CameraController({ dominant: 'right', facingUser: true }, calibration, () => {});
  ctl.attach(seat);
  const feed = (frames: readonly LandmarksFrame[]) => {
    for (const f of frames) ctl.feed(f);
  };
  const edges = () => sent.map((i) => `${i.action}:${i.phase}`);
  return { sent, seat, ctl, feed, edges };
}

const clip = (keys: readonly Key[], extra: Partial<TimelineSpec> = {}) =>
  timeline({ seconds: 3, keys, ...extra });

const push: readonly Key[] = [
  { t: 0, hand: { ...HOME, shape: 'open' } },
  { t: 1.0, hand: { size: 0.15 } },
  { t: 1.2, hand: { size: 0.19 } },
  { t: 1.8, hand: { size: 0.19 } },
  { t: 2.3, hand: { size: 0.15 } },
];

describe('CameraController', () => {
  it('a palm push becomes one PULSE tap intent from the camera source', () => {
    const { sent, feed, seat } = rig();
    feed(clip(push));
    expect(sent.map((i) => [i.action, i.phase, i.source])).toEqual([['pulse', 'tap', 'camera']]);
    // The open hand also aimed: the reticle sits on the seat's own legal half.
    expect(seat.reticle.initialised).toBe(true);
    expect(seat.reticle.x).toBeLessThanOrEqual(2);
  });

  it('LIFT starts on a held fist and always ends: on opening the hand, and on a dropout', () => {
    const opened = rig();
    opened.feed(
      clip([
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { shape: 'fist' } },
        { t: 2.0, hand: { shape: 'open' } },
      ]),
    );
    expect(opened.edges()).toEqual(['lift:start', 'lift:end']);

    const dropped = rig();
    dropped.feed(
      clip(
        [
          { t: 0, hand: { ...HOME, shape: 'open' } },
          { t: 0.8, hand: { shape: 'fist' } },
        ],
        { dropouts: [[1.8, 3]] },
      ),
    );
    expect(dropped.edges()).toEqual(['lift:start', 'lift:end']);
    const end = dropped.sent[1]!;
    const start = dropped.sent[0]!;
    // Released well after the hand vanished (coast + 500 ms), before the server's 4 s limit.
    expect(end.clientTime - start.clientTime).toBeLessThan(4000);
  });

  it('picks follow the loadout: a hold move starts and ends, a tap move fires once', () => {
    const tapFirst = rig(null, ['freeze', 'magnetize']);
    tapFirst.feed(
      clip([
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { shape: 'point' } },
        { t: 2.0, hand: { shape: 'open' } },
      ]),
    );
    expect(tapFirst.edges()).toEqual(['freeze:tap']);

    const holdFirst = rig(null, ['magnetize', 'freeze']);
    holdFirst.feed(
      clip([
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.8, hand: { shape: 'point' } },
        { t: 2.0, hand: { shape: 'open' } },
      ]),
    );
    expect(holdFirst.edges()).toEqual(['magnetize:start', 'magnetize:end']);
  });

  it('WET and HEAT signs are INFUSE taps with the element modifier', () => {
    const { sent, feed } = rig();
    feed(
      timeline({
        seconds: 4.5,
        keys: [
          { t: 0, hand: { ...HOME, shape: 'open' } },
          { t: 0.8, hand: { shape: 'vee' } },
          { t: 1.8, hand: { shape: 'open' } },
          { t: 2.6, hand: { shape: 'thumb', roll: -1.45 } },
          { t: 3.6, hand: { shape: 'open', roll: 0 } },
        ],
      }),
    );
    expect(sent.map((i) => [i.action, i.modifier])).toEqual([
      ['infuse', 0],
      ['infuse', 1],
    ]);
  });

  it('a stroke to the player’s right blows the wind toward screen right', () => {
    const { sent, feed } = rig();
    // Mirrored selfie view: the player's right is image left.
    feed(
      clip([
        { t: 0, hand: { cx: 0.62, cy: 0.55, size: 0.15, shape: 'open' } },
        { t: 1.0, hand: { cx: 0.62 } },
        { t: 1.3, hand: { cx: 0.32 } },
      ]),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.action).toBe('sweep');
    // Default view axes (no render camera): screen right = +x.
    expect(sent[0]!.dir![0]).toBeGreaterThan(0.9);
    expect(Math.abs(sent[0]!.dir![1])).toBeLessThan(0.1);
  });

  it('calibration that saw an away-facing palm flips the labels and adopts the true hand', () => {
    // A camera whose labels are inverted: a LEFT hand reported as "right".
    const inverted = (frames: readonly LandmarksFrame[]) =>
      frames.map((f) => ({
        ...f,
        hands: f.hands.map((h) => ({ ...h, handedness: 'right' as const })),
      }));
    const leftHandPush = inverted(
      clip(push.map((k) => ({ ...k, hand: { ...k.hand, handedness: 'left' as const } }))),
    );
    const calibrated: Calibration = {
      palmScale: null,
      center: { x: 0.89, y: 0.55 },
      range: { x0: 0.39, x1: 1.39, y0: 0.22, y1: 0.85 },
      hand: 'right',
      palmFacing: 0.6, // the shown palm "faced away" under these labels → they are swapped
    };
    const flipped = rig(calibrated);
    flipped.feed(leftHandPush);
    expect(flipped.edges()).toEqual(['pulse:tap']);

    // Without that calibration the same frames are a back-of-hand "right" hand: no push.
    const naive = rig();
    naive.feed(leftHandPush);
    expect(naive.edges()).toEqual([]);
  });

  it('nothing is sent while paused, practising or calibrating; pausing ends a held LIFT', () => {
    const r = rig();
    r.feed(
      timeline({
        seconds: 1.6,
        keys: [
          { t: 0, hand: { ...HOME, shape: 'open' } },
          { t: 0.8, hand: { shape: 'fist' } },
        ],
      }),
    );
    expect(r.edges()).toEqual(['lift:start']);
    r.ctl.pause();
    expect(r.edges()).toEqual(['lift:start', 'lift:end']);
    r.feed(clip(push, { t0: 5000 }));
    expect(r.edges()).toEqual(['lift:start', 'lift:end']);

    for (const mode of ['practice', 'calibrate'] as const) {
      const q = rig();
      q.ctl.setMode(mode);
      q.feed(clip(push));
      expect(q.sent, mode).toEqual([]);
    }
  });
});

describe('screenAimToArena', () => {
  it('spans each seat’s legal half (own half plus midline reach) and mirrors for seat 1', () => {
    // Default axes: screen right = +x, screen up = −z.
    expect(screenAimToArena(0, 0, 0).x).toBeCloseTo(-9.1, 1);
    expect(screenAimToArena(0, 1, 0).x).toBeCloseTo(2, 5);
    expect(screenAimToArena(0, -1, 0).x).toBeCloseTo(-20.2, 5);
    expect(screenAimToArena(1, -1, 0).x).toBeCloseTo(-2, 5);
    expect(screenAimToArena(1, 1, 0).x).toBeCloseTo(20.2, 5);
    expect(screenAimToArena(0, 0, 1).z).toBeCloseTo(-11.7, 5);
    expect(screenAimToArena(0, 0, -1).z).toBeCloseTo(11.7, 5);
  });
});

describe('CameraController — hands-on (ADR-0009)', () => {
  it('the camera mapper is tuned against the authority’s own hand thresholds', async () => {
    const { AUTHORITY_THRESHOLDS } = await import('@ff/gestures');
    const { DEFAULT_RULES } = await import('@ff/game-data');
    const h = DEFAULT_RULES.hand;
    expect(AUTHORITY_THRESHOLDS).toEqual({
      engageGrip: h.engageGrip,
      releaseGrip: h.releaseGrip,
      pushDeadZone: h.pushDeadZone,
      twistDeadZone: h.twistDeadZone,
    });
  });

  it('closing, pushing and turning the hand become the seat’s hand; no LIFT or PULSE fires', () => {
    const { sent, ctl, seat } = rig();
    seat.handsOn = true;
    const seen: { grip: number; push: number; twist: number }[] = [];
    const frames = clip(
      [
        { t: 0, hand: { ...HOME, shape: 'open' } },
        { t: 0.6, hand: { shape: 'fist' } },
        { t: 1.0, hand: { size: 0.15 } },
        { t: 1.3, hand: { size: 0.19 } },
        { t: 1.6, hand: { roll: 0 } },
        { t: 2.1, hand: { roll: -0.6 } },
        { t: 2.6, hand: { shape: 'open' } },
      ],
      { seconds: 3.2 },
    );
    for (const f of frames) {
      ctl.feed(f);
      const h = seat.hand;
      if (h) seen.push(h);
    }
    expect(Math.max(...seen.map((h) => h.grip))).toBeGreaterThan(0.9);
    expect(Math.max(...seen.map((h) => h.push))).toBeGreaterThan(0.4);
    expect(Math.max(...seen.map((h) => h.twist))).toBeGreaterThan(0.4);
    expect(seen.at(-1)!.grip).toBeLessThan(0.35);
    expect(sent.filter((i) => i.action !== 'aim').map((i) => i.action)).toEqual([]);
  });

  it('an element sign never grips (thumbs-up is HEAT, not a fist) and still casts', () => {
    const { sent, ctl, seat } = rig();
    seat.handsOn = true;
    let maxGrip = 0;
    for (const f of clip([
      { t: 0, hand: { ...HOME, shape: 'open' } },
      { t: 0.6, hand: { shape: 'thumb', roll: -1.45 } },
    ])) {
      ctl.feed(f);
      maxGrip = Math.max(maxGrip, seat.hand?.grip ?? 0);
    }
    expect(maxGrip).toBeLessThan(0.35);
    expect(sent.map((i) => `${i.action}:${i.phase}`)).toContain('infuse:tap');
  });

  it('pausing or losing the hand opens it at once', () => {
    const { ctl, seat } = rig();
    seat.handsOn = true;
    for (const f of clip([
      { t: 0, hand: { ...HOME, shape: 'open' } },
      { t: 0.5, hand: { shape: 'fist' } },
    ]))
      ctl.feed(f);
    expect(seat.hand?.grip).toBeGreaterThan(0.9);
    ctl.pause();
    expect(seat.hand).toEqual({ grip: 0, push: 0, twist: 0 });
  });
});
