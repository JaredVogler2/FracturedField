/**
 * The live synthetic hand used by closed-loop browser tests: it renders the current pose at the
 * camera rate with real timestamps, and a pose change between frames is seen by the engine like a
 * person moving their hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GestureEngine, type GestureEvent, type LandmarksFrame } from '../src/index.js';
import { SyntheticCamera } from '../src/synthetic.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('SyntheticCamera', () => {
  it('streams the current pose at its frame rate until stopped; null means out of frame', () => {
    vi.useFakeTimers();
    let clock = 0;
    const frames: LandmarksFrame[] = [];
    const cam = new SyntheticCamera(
      (f) => frames.push(f),
      { fps: 10 },
      () => clock,
    );
    cam.set({ cx: 0.4, shape: 'open' });
    for (let i = 0; i < 10; i++) {
      clock += 100;
      vi.advanceTimersByTime(100);
    }
    expect(frames).toHaveLength(10);
    expect(frames.every((f) => f.hands.length === 1)).toBe(true);
    expect(frames.map((f) => f.t)).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    cam.set(null);
    clock += 100;
    vi.advanceTimersByTime(100);
    expect(frames.at(-1)?.hands).toEqual([]);
    cam.stop();
    vi.advanceTimersByTime(1000);
    expect(frames).toHaveLength(11);
  });

  it('a pose change mid-stream reads as a gesture: an open palm pushed forward casts PULSE once', () => {
    vi.useFakeTimers();
    let clock = 0;
    const engine = new GestureEngine();
    const events: GestureEvent[] = [];
    const cam = new SyntheticCamera(
      (f) => events.push(...engine.process(f).events),
      { fps: 15, seed: 3 },
      () => clock,
    );
    const step = (ms: number) => {
      for (let t = 0; t < ms; t += 1000 / 15) {
        clock += 1000 / 15;
        vi.advanceTimersByTime(1000 / 15);
      }
    };
    cam.set({ cx: 0.5, cy: 0.55, size: 0.15, shape: 'open' });
    step(1200);
    cam.set({ size: 0.19 });
    step(700);
    cam.set({ size: 0.15 });
    step(1200);
    cam.stop();
    expect(events.filter((e) => e.phase !== 'end').map((e) => e.action)).toEqual(['pulse']);
  });
});
