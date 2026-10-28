import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { cloudShadowTexture, keyLightUniforms, patchKeyLight, setKeyMask } from './key-light';

function standardShader(): THREE.WebGLProgramParametersWithUniforms {
  const src = THREE.ShaderLib.standard;
  return {
    uniforms: THREE.UniformsUtils.clone(src.uniforms),
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe('key light modulation', () => {
  it('scales only the first directional light, after its own shadow is applied', () => {
    const shader = standardShader();
    patchKeyLight(shader);
    const lights = THREE.ShaderChunk.lights_fragment_begin;
    // The light chunk is inlined (patched) instead of included.
    expect(shader.fragmentShader).not.toContain('#include <lights_fragment_begin>');
    expect(shader.fragmentShader).toContain(
      'directLight.color *= ( UNROLLED_LOOP_INDEX == 0 ) ? ffKeyFactor( geometryNormal ) : 1.0;',
    );
    // Once, inside the directional loop (not the point, spot or sun loops).
    const at = shader.fragmentShader.indexOf('ffKeyFactor( geometryNormal )');
    const loop = shader.fragmentShader.lastIndexOf('NUM_DIR_LIGHTS', at);
    expect(loop).toBeGreaterThan(-1);
    expect(shader.fragmentShader.split('ffKeyFactor( geometryNormal )')).toHaveLength(2);
    expect(lights).toContain('getDirectionalLightInfo( directionalLight, directLight );');
    // A world position for the lookups.
    expect(shader.vertexShader).toContain('vFfWorld = ( modelMatrix * ffW ).xyz;');
    // The uniforms are the shared objects: updating one updates every patched material.
    expect(shader.uniforms.ffCloud).toBe(keyLightUniforms.ffCloud);
    expect(shader.uniforms.ffKeyMaskOn).toBe(keyLightUniforms.ffKeyMaskOn);
  });

  it('maps the mask so the bake image (min z at the top) lands where it was rendered', () => {
    const target = new THREE.WebGLRenderTarget(4, 4);
    setKeyMask(target, { minX: -38, minZ: -36, sizeX: 76, sizeZ: 72 });
    const m = keyLightUniforms.ffKeyMaskXform.value;
    const uv = (x: number, z: number) => [(x - m.x) * m.z, (z - m.y) * m.w];
    // Render targets read bottom-up: the far edge (min z) is v = 1, the near edge v = 0.
    expect(uv(-38, -36)).toEqual([0, 1]);
    expect(uv(38, 36)[0]).toBeCloseTo(1);
    expect(uv(38, 36)[1]).toBeCloseTo(0);
    expect(keyLightUniforms.ffKeyMaskOn.value).toBe(1);
    setKeyMask(null);
    expect(keyLightUniforms.ffKeyMaskOn.value).toBe(0);
    expect(keyLightUniforms.ffKeyMask.value).toBeNull();
    target.dispose();
  });

  it('cloud shadows tile without a seam and have broad shapes, not speckle', () => {
    const size = 128;
    const tex = cloudShadowTexture(size);
    const d = tex.image.data as Uint8Array;
    const at = (x: number, y: number) => d[((y + size) % size) * size + ((x + size) % size)]!;
    let inner = 0;
    let seam = 0;
    for (let y = 0; y < size; y++) {
      inner += Math.abs(at(size / 2, y) - at(size / 2 - 1, y));
      seam += Math.abs(at(0, y) - at(size - 1, y));
    }
    // Across the wrap the field changes no more than between any two neighbouring columns.
    expect(seam).toBeLessThan(inner * 2 + size);
    // Values span light to shade (the shader's smoothstep window sits inside this range).
    let lo = 255;
    let hi = 0;
    for (const v of d) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeLessThan(0.42 * 255);
    expect(hi).toBeGreaterThan(0.68 * 255);
    tex.dispose();
  });
});
