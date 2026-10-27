/**
 * Surface materials: one shader program for every recipe, and world material state switches a
 * surface's recipe at runtime through uniforms alone (no recompile).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SURFACES } from '../art-tokens';
import { surfaceMaterial } from './materials';

describe('SurfaceMaterial', () => {
  it('shares one program across recipes', () => {
    const a = surfaceMaterial('basaltPolished', 32);
    const b = surfaceMaterial('brassAged', 32);
    expect(a.customProgramCacheKey()).toBe(b.customProgramCacheKey());
    expect(a.metalness).toBe(SURFACES.basaltPolished.metalness);
    expect(b.metalness).toBe(SURFACES.brassAged.metalness);
  });

  it('switches to another recipe through its uniforms (chilled stone) without a recompile', () => {
    const m = surfaceMaterial('basaltPolished', 32);
    const version = m.version;
    const key = m.customProgramCacheKey();
    const chilled = SURFACES.basaltChilled;
    m.applyRecipe(chilled, 32);
    expect(m.tri.uColorHi.value.equals(new THREE.Color(chilled.colorHi))).toBe(true);
    expect(m.tri.uScale.value).toBeCloseTo(1 / chilled.tileMetres, 9);
    expect(m.tri.uRough.value.toArray()).toEqual([...chilled.roughness]);
    expect(m.tri.uGlow.value).toBe(0);
    expect(m.version).toBe(version);
    expect(m.customProgramCacheKey()).toBe(key);
    // Rift charge lights the cracks: glow colour and strength follow the recipe.
    m.applyRecipe(SURFACES.riftCracked, 32);
    expect(m.tri.uGlow.value).toBe(SURFACES.riftCracked.glow);
    expect(m.tri.uGlowColor.value.equals(new THREE.Color(SURFACES.riftCracked.glowColor))).toBe(
      true,
    );
  });
});
