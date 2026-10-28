import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { EffectSnapshot } from '@ff/protocol';
import { heatSources, MAX_HEAT_SOURCES } from './heat-haze';

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(42, 16 / 9, 1, 900);
  c.position.set(0, 8.5, 12.5);
  c.lookAt(0, 0.8, 0);
  c.updateMatrixWorld();
  return c;
}

function flame(x: number, z: number, m = 1, kind: EffectSnapshot['kind'] = 'flame') {
  return {
    id: 1,
    kind,
    owner: 0,
    p: [x, 0, z],
    r: 1.7,
    ttl: 30,
    maxTtl: 60,
    s: 1,
    d: [1, 0],
    m,
  } as EffectSnapshot;
}

const slots = () => Array.from({ length: MAX_HEAT_SOURCES }, () => new THREE.Vector4(9, 9, 9, 9));

describe('heat haze sources (7C, D09): plumes over authoritative flames', () => {
  it('puts a plume over a flame in view, sized by its distance, as strong as the flame', () => {
    const out = slots();
    expect(heatSources([flame(0, 0, 0.8)], camera(), out)).toBe(1);
    const [h] = out;
    expect(h!.x).toBeCloseTo(0.5, 2);
    expect(h!.y).toBeGreaterThan(0.3);
    expect(h!.y).toBeLessThan(0.7);
    expect(h!.w).toBe(0.8);
    const near = h!.z;
    heatSources([flame(0, -10)], camera(), out);
    expect(out[0]!.z).toBeLessThan(near); // farther away, smaller on screen
    for (const v of out.slice(1)) expect(v.w).toBe(0);
  });

  it('ignores other effects, spent flames and flames behind the camera', () => {
    const out = slots();
    const n = heatSources([flame(0, 0, 1, 'pool'), flame(0, 0, 0), flame(0, 30)], camera(), out);
    expect(n).toBe(0);
    for (const v of out) expect(v.w).toBe(0);
  });

  it('keeps the strongest flames when there are more than it can draw', () => {
    const out = slots();
    const ms = [0.2, 0.9, 0.5, 0.7, 0.1, 1];
    const n = heatSources(
      ms.map((m, i) => flame(i - 2.5, 0, m)),
      camera(),
      out,
    );
    expect(n).toBe(MAX_HEAT_SOURCES);
    expect(out.map((v) => v.w)).toEqual([1, 0.9, 0.7, 0.5]);
  });
});
