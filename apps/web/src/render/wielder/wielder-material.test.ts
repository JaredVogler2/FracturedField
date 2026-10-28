import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { wielderMaterial } from './wielder-material';

/** The standard material's shader as three hands it to `onBeforeCompile`. */
function standardShader(): THREE.WebGLProgramParametersWithUniforms {
  const src = THREE.ShaderLib.standard;
  return {
    uniforms: THREE.UniformsUtils.clone(src.uniforms),
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
}

describe('wielder material (7D, D10)', () => {
  it('takes every hook it patches in this three (none silently missed)', () => {
    const { material, glow } = wielderMaterial('#ff8a3a', new THREE.Vector3(0.6, 0, 0.8));
    const shader = standardShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    const v = shader.vertexShader;
    const f = shader.fragmentShader;
    expect(v).toContain('vMat = aMat;');
    expect(v).toContain('vRigY = transformed.y;');
    // The inside of the open coat, a darker lining.
    expect(f).toContain('diffuseColor.rgb *= gl_FrontFacing ? 1.0 : 0.42;');
    expect(material.side).toBe(THREE.DoubleSide);
    // The surface from the vertices instead of the maps.
    expect(f).toContain('float roughnessFactor = vMat.x;');
    expect(f).toContain('float metalnessFactor = vMat.y;');
    expect(f).not.toContain('#include <roughnessmap_fragment>');
    expect(f).not.toContain('#include <metalnessmap_fragment>');
    // The character light after the scene's lights, on the metalness-weighted diffuse colour.
    expect(f).toContain('reflectedLight.indirectDiffuse += material.diffuseContribution * fill;');
    expect(THREE.ShaderChunk.lights_physical_fragment).toContain('material.diffuseContribution');
    expect(f.indexOf('material.diffuseContribution * fill')).toBeGreaterThan(
      f.indexOf('#include <lights_fragment_end>'),
    );
    // Glow and rim.
    expect(f).toContain('totalEmissiveRadiance += uTeam * vMat.z * g * 2.2;');
    expect(shader.uniforms.uGlow!.value).toBe(glow);
    // The relief, a bump on the shading normal after three's own normal maps.
    expect(v).toContain('vRest = position;');
    expect(f).toContain('float hRelief = ffRelief( vRest, vDetail ) * uScale;');
    expect(f.indexOf('hRelief')).toBeGreaterThan(f.indexOf('#include <normal_fragment_maps>'));
    expect(THREE.ShaderChunk.normal_fragment_begin).toContain('faceDirection');
    expect(material.customProgramCacheKey()).toBe('wielder-body');
    material.dispose();
  });

  it('draws plain surfaces without the relief on low, under its own program', () => {
    const { material } = wielderMaterial('#5fd4ff', new THREE.Vector3(-0.6, 0, 0.8), {
      relief: false,
    });
    const shader = standardShader();
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).not.toContain('ffRelief');
    expect(shader.fragmentShader).toContain('material.diffuseContribution * fill');
    expect(material.customProgramCacheKey()).toBe('wielder-body-plain');
    material.dispose();
  });
});
