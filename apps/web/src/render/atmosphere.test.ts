/**
 * Aerial perspective and quality tiers (Phase 07B): the fog never touches the playing field or
 * the platform, grows with distance beyond it so far formations dissolve into the sky, and hazes
 * what hangs below the platform; the fog shader chunks are installed once; the quality tiers only
 * ever add rendering cost from low to high.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MERIDIAN_ARENA } from '@ff/game-data';
import { ARENA_ART, FOG, QUALITY } from './art-tokens';
import { fogAmount, installAtmosphericFog, SKY_GLSL } from './atmosphere';

describe('aerial-perspective fog', () => {
  it('leaves the field, the walls, the gates and the whole platform top unfogged', () => {
    const L = MERIDIAN_ARENA.halfLength + MERIDIAN_ARENA.goal.depth;
    for (const x of [-L, -10, 0, 10, L])
      for (const z of [-MERIDIAN_ARENA.halfWidth, 0, MERIDIAN_ARENA.halfWidth])
        for (const y of [0, 4, 12])
          expect(fogAmount(new THREE.Vector3(x, y, z)), `(${x}, ${y}, ${z})`).toBe(0);
    // The platform's rim (up to ~7 % beyond its mean radius) is still inside the fog start.
    const rim = ARENA_ART.platform.outerRadius * 1.07;
    expect(rim).toBeLessThanOrEqual(FOG.start);
    expect(fogAmount(new THREE.Vector3(rim, 0, 0))).toBe(0);
  });

  it('dissolves distant formations progressively into the sky', () => {
    const at = (r: number) => fogAmount(new THREE.Vector3(r, 10, 0));
    const near = at(ARENA_ART.formations.near);
    const mid = at(160);
    const far = at(ARENA_ART.formations.far);
    expect(near).toBeGreaterThan(0.05);
    expect(near).toBeLessThan(0.4);
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(0.95);
  });

  it('hazes the lower underside lightly and the depths below heavily', () => {
    expect(fogAmount(new THREE.Vector3(0, -4, 0))).toBe(0);
    const underside = fogAmount(new THREE.Vector3(0, -12, 0));
    expect(underside).toBeGreaterThan(0);
    expect(underside).toBeLessThan(0.15);
    expect(fogAmount(new THREE.Vector3(0, -40, 0))).toBeGreaterThan(0.75);
  });

  it('replaces three fog chunks once, with the shared sky gradient', () => {
    installAtmosphericFog();
    installAtmosphericFog();
    expect(THREE.ShaderChunk.fog_fragment).toContain('ffSky');
    expect(THREE.ShaderChunk.fog_pars_fragment).toContain('vec3 ffSky');
    expect(THREE.ShaderChunk.fog_vertex).toContain('vFogWorld');
    expect(THREE.ShaderChunk.fog_pars_fragment.split('vec3 ffSky').length).toBe(2);
    expect(SKY_GLSL).toMatch(/const vec3 FF_SUN = vec3\(-?0\.\d+, 0\.\d+, -?0\.\d+\)/);
  });
});

describe('quality tiers', () => {
  it('only add rendering cost from low to high (the simulation is the same on every tier)', () => {
    const [low, medium, high] = [QUALITY.low, QUALITY.medium, QUALITY.high];
    expect(low.dpr).toBeLessThanOrEqual(0.85);
    expect(low.dpr).toBeGreaterThanOrEqual(0.7);
    for (const [a, b] of [
      [low, medium],
      [medium, high],
    ] as const) {
      expect(b.dpr).toBeGreaterThanOrEqual(a.dpr);
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
      expect(b.dust).toBeGreaterThanOrEqual(a.dust);
      expect(b.cloudLayers).toBeGreaterThanOrEqual(a.cloudLayers);
      expect(b.particles).toBeGreaterThanOrEqual(a.particles);
      expect(b.pointLights).toBeGreaterThanOrEqual(a.pointLights);
      expect(Number(b.shadows)).toBeGreaterThanOrEqual(Number(a.shadows));
      expect(Number(b.bloom)).toBeGreaterThanOrEqual(Number(a.bloom));
      expect(Number(b.shafts)).toBeGreaterThanOrEqual(Number(a.shafts));
    }
    const skyCost = { baked: 0, low: 1, high: 2 } as const;
    expect(skyCost[low.sky]).toBeLessThanOrEqual(skyCost[medium.sky]);
    expect(skyCost[medium.sky]).toBeLessThanOrEqual(skyCost[high.sky]);
    // Low: no shadow maps, bloom, shafts, dust or cloud sheets; a baked sky; one point light
    // (the core's). Weak GPUs and software rasterisers pay for every full-screen layer.
    expect(low.shadows || low.bloom || low.shafts || low.dust > 0 || low.cloudLayers > 0).toBe(
      false,
    );
    expect(low.sky).toBe('baked');
    expect(low.pointLights).toBe(1);
  });
});
