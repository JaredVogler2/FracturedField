import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@ff/game-data';
import {
  COLLAPSE_S,
  FORM_S,
  GONE_MAX_S,
  newCoreLook,
  stepCoreLook,
  type CoreLook,
  type CoreLookInput,
} from './core-look';

const REST: CoreLookInput = {
  dt: 1 / 60,
  speed: 0,
  spin: 0,
  temp: 20,
  charge: 0,
  wet: 0,
  impact: 0,
  goal: false,
  kickoff: false,
  reducedMotion: false,
};

/** Steps `look` for `seconds` at 60 fps; the first frame carries `first` (an event). */
function run(look: CoreLook, seconds: number, input: Partial<CoreLookInput> = {}, first = {}) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i++)
    stepCoreLook(look, { ...REST, ...input, ...(i === 0 ? first : {}) });
  return look;
}

describe('the Rift Core look (7C, D09): narrates authoritative state only', () => {
  it('at rest: whole, calm seams, plates nearly closed', () => {
    const look = run(newCoreLook(), 1);
    expect(look.phase).toBe('whole');
    expect(look.scale).toBe(1);
    expect(look.energy).toBeCloseTo(0, 5);
    expect(look.crack).toBeCloseTo(0.6, 5);
    expect(look.explode).toBeCloseTo(0.02, 5);
    expect(look.flash).toBe(0);
  });

  it('speed energises it, smoothed (no jump in one frame), full at 18 m/s', () => {
    const look = newCoreLook();
    stepCoreLook(look, { ...REST, speed: 30 });
    expect(look.energy).toBeGreaterThan(0);
    expect(look.energy).toBeLessThan(0.2);
    run(look, 1, { speed: 30 });
    expect(look.energy).toBeCloseTo(1, 2);
    run(look, 1, { speed: 9 });
    expect(look.energy).toBeCloseTo(0.5, 2);
  });

  it('the deliberate spin parts the plates and lights the seams; its sign does not matter', () => {
    const max = DEFAULT_RULES.hand.maxSpin;
    const a = run(newCoreLook(), 0.5, { spin: max });
    const b = run(newCoreLook(), 0.5, { spin: -max });
    expect(a.spinRate).toBe(1);
    expect(b.spinRate).toBe(1);
    expect(a.explode).toBeCloseTo(0.07, 5);
    expect(a.crack).toBeCloseTo(1.2, 5);
    expect(a.explode).toBe(b.explode);
    const half = run(newCoreLook(), 0.5, { spin: max / 2 });
    expect(half.spinRate).toBeCloseTo(0.5, 5);
  });

  it('an impact jolts it at once and fades within a second', () => {
    const look = newCoreLook();
    stepCoreLook(look, { ...REST, impact: 1 });
    expect(look.shock).toBe(1);
    expect(look.explode).toBeCloseTo(0.14, 5);
    expect(look.crack).toBeCloseTo(1.8, 5);
    run(look, 1);
    expect(look.shock).toBeLessThan(0.03);
    // A weaker impact during a stronger one's decay does not cut it short.
    const l2 = newCoreLook();
    stepCoreLook(l2, { ...REST, impact: 1 });
    stepCoreLook(l2, { ...REST, impact: 0.2 });
    expect(l2.shock).toBeGreaterThan(0.9);
  });

  it('heat warms it from 40 °C (full at 160 °C), charge and wetness pass through, clamped', () => {
    expect(run(newCoreLook(), 0.1, { temp: 40 }).heat).toBe(0);
    expect(run(newCoreLook(), 0.1, { temp: 100 }).heat).toBeCloseTo(0.5, 5);
    expect(run(newCoreLook(), 0.1, { temp: 500 }).heat).toBe(1);
    expect(run(newCoreLook(), 0.1, { charge: 2 }).charge).toBe(1);
    const wet = run(newCoreLook(), 0.1, { wet: 1 });
    expect(wet.wet).toBe(1);
    // Water dulls the seams.
    expect(wet.crack).toBeCloseTo(0.6 * 0.7, 5);
  });

  it('a goal collapses it into the gate in under 1.5 s; the next kickoff forms it again', () => {
    const look = newCoreLook();
    stepCoreLook(look, { ...REST, goal: true });
    expect(look.phase).toBe('collapsing');
    let t = 0;
    while (look.phase === 'collapsing') {
      const prev = look.scale;
      stepCoreLook(look, REST);
      t += REST.dt;
      expect(look.scale).toBeLessThanOrEqual(prev);
    }
    expect(look.phase).toBe('gone');
    expect(t).toBeLessThan(1.5);
    expect(t).toBeCloseTo(COLLAPSE_S, 1);
    expect(look.scale).toBe(0);
    // A second goal event while gone changes nothing.
    stepCoreLook(look, { ...REST, goal: true });
    expect(look.phase).toBe('gone');
    run(look, 1);
    expect(look.phase).toBe('gone');
    stepCoreLook(look, { ...REST, kickoff: true });
    expect(look.phase).toBe('forming');
    let peak = 0;
    for (let i = 0; i < Math.ceil((FORM_S + 0.1) * 60); i++) {
      stepCoreLook(look, REST);
      peak = Math.max(peak, look.scale);
    }
    expect(look.phase).toBe('whole');
    expect(look.scale).toBe(1);
    // It forms with a slight overshoot, not a pop.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
  });

  it('a kickoff during the collapse forms it at once; a lost kickoff still forms it after a while', () => {
    const look = newCoreLook();
    stepCoreLook(look, { ...REST, goal: true });
    run(look, COLLAPSE_S / 2);
    stepCoreLook(look, { ...REST, kickoff: true });
    expect(look.phase).toBe('forming');

    const lost = newCoreLook();
    stepCoreLook(lost, { ...REST, goal: true });
    run(lost, COLLAPSE_S + 0.05);
    expect(lost.phase).toBe('gone');
    run(lost, GONE_MAX_S + 0.05);
    expect(lost.phase).toBe('forming');
    run(lost, FORM_S + 0.05);
    expect(lost.phase).toBe('whole');
  });

  it('a kickoff while whole changes nothing', () => {
    const look = newCoreLook();
    stepCoreLook(look, { ...REST, kickoff: true });
    expect(look.phase).toBe('whole');
    expect(look.scale).toBe(1);
  });

  it('reduced motion: the plates barely part and the flashes are halved', () => {
    const calm = run(newCoreLook(), 0.5, { spin: DEFAULT_RULES.hand.maxSpin, reducedMotion: true });
    expect(calm.explode).toBeCloseTo(0.02 + 0.05 * 0.3, 5);
    const look = newCoreLook();
    stepCoreLook(look, { ...REST, goal: true, reducedMotion: true });
    run(look, COLLAPSE_S - 0.05, { reducedMotion: true });
    expect(look.flash).toBeLessThan(0.5);
  });

  it('bad input (NaN, Infinity, a huge frame time) never produces a NaN', () => {
    const look = newCoreLook();
    const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const v of bad) {
      stepCoreLook(look, {
        ...REST,
        dt: v,
        speed: v,
        spin: v,
        temp: v,
        charge: v,
        wet: v,
        impact: v,
      });
      stepCoreLook(look, { ...REST, dt: 1e6, goal: true });
    }
    for (const [k, v] of Object.entries(look)) {
      if (typeof v === 'number') expect(Number.isFinite(v), k).toBe(true);
    }
    expect(look.scale).toBeGreaterThanOrEqual(0);
  });
});
