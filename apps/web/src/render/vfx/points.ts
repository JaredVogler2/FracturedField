import * as THREE from 'three';

/*
 * Shared point-particle pieces for the element visuals: a pooled, dynamically updated point cloud
 * (position, size, alpha, colour per point) and its soft-sprite material. Every caller builds the
 * same shader source, so all of them share one compiled program per blend mode.
 */

export function createRegionPointsMaterial(
  additive: boolean,
  sprite: THREE.Texture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uMap: { value: sprite }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3 aColor;
      uniform float uScale;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
  });
}

export class RegionPoints {
  readonly geo = new THREE.BufferGeometry();
  readonly pos: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly color: Float32Array;
  readonly points: THREE.Points;
  constructor(
    readonly capacity: number,
    readonly mat: THREE.ShaderMaterial,
  ) {
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 3);
    const dyn = THREE.DynamicDrawUsage;
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(dyn));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(dyn));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(dyn));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(dyn));
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }
  set(
    i: number,
    x: number,
    y: number,
    z: number,
    size: number,
    a: number,
    r: number,
    g: number,
    b: number,
  ) {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i] = size;
    this.alpha[i] = a;
    this.color[i * 3] = r;
    this.color[i * 3 + 1] = g;
    this.color[i * 3 + 2] = b;
  }
  hide(from: number) {
    for (let i = from; i < this.capacity; i++) this.alpha[i] = 0;
  }
  commit() {
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor'])
      (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** Soft radial sprite (generated, no asset). */
export function softSprite(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.pow(1 - r, 1.8) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
