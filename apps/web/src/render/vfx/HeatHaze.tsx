/**
 * Heat refraction above flames (7C / D09), high tier only: a post effect that bends the frame in
 * a plume rising from each authoritative flame (`heat-haze.ts` finds them). Restrained: the image
 * shifts by about three pixels at most, in thin bands drifting upward like air over a fire. It
 * joins the composer's existing pass (no extra program or render target).
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Effect } from 'postprocessing';
import { useRenderFrame } from '../frame-context';
import { heatSources, MAX_HEAT_SOURCES } from './heat-haze';

const fragmentShader = /* glsl */ `
  uniform vec4 uHeat[${MAX_HEAT_SOURCES}];

  void mainUv(inout vec2 uv) {
    vec2 offset = vec2(0.0);
    for (int i = 0; i < ${MAX_HEAT_SOURCES}; i++) {
      vec4 h = uHeat[i];
      if (h.w <= 0.0) continue;
      // The plume in units of its radius: x across (aspect corrected), y up from its base.
      vec2 d = (uv - h.xy) * vec2(aspect, 1.0) / h.z;
      float width = 0.55 + 0.25 * clamp(d.y, 0.0, 2.4);
      float mask = smoothstep(-0.2, 0.2, d.y) * (1.0 - smoothstep(1.4, 2.4, d.y))
        * (1.0 - smoothstep(0.35 * width, width, abs(d.x))) * h.w;
      // Thin bands rising, wobbling sideways: light bent by the hot air above the flame.
      float a = sin(d.y * 14.0 - time * 8.0 + sin(d.x * 6.0 + time * 1.9) * 1.4);
      float b = sin(d.y * 9.0 - time * 6.0 + d.x * 5.0);
      offset += vec2(a, 0.45 * b) * mask;
    }
    uv += offset * vec2(0.0018, 0.0026);
  }
`;

class HeatHazeEffect extends Effect {
  readonly heat: THREE.Vector4[];

  constructor() {
    const heat = Array.from({ length: MAX_HEAT_SOURCES }, () => new THREE.Vector4());
    super('HeatHazeEffect', fragmentShader, {
      uniforms: new Map([['uHeat', new THREE.Uniform(heat)]]),
    });
    this.heat = heat;
  }
}

/** The heat haze: mount inside the EffectComposer, first (it bends what the others sample). */
export function HeatHaze() {
  const frame = useRenderFrame();
  const camera = useThree((s) => s.camera);
  const effect = useMemo(() => new HeatHazeEffect(), []);
  useEffect(() => () => effect.dispose(), [effect]);
  useFrame(() => {
    const effects = frame.current?.latest?.effects ?? [];
    if (camera instanceof THREE.PerspectiveCamera) heatSources(effects, camera, effect.heat);
  });
  return <primitive object={effect} dispose={null} />;
}
