import * as THREE from 'three';

/*
 * Camera-facing ribbons for field lines (wind streamlines, gravity field arcs, magnet flux): soft
 * edges, a colour and an opacity per point, and optional dashes that flow along the line. Many
 * polylines go into one dynamic buffer and draw in one call; rebuilt every frame on the CPU (a few
 * hundred points at most).
 */

export function ribbonMaterial(additive: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSide;
      attribute vec4 aColor;
      // distance along the line (m), dash flow speed (m/s; 0 = solid)
      attribute vec2 aFlow;
      varying float vSide;
      varying vec4 vColor;
      varying vec2 vFlow;
      void main() {
        vSide = aSide;
        vColor = aColor;
        vFlow = aFlow;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying float vSide;
      varying vec4 vColor;
      varying vec2 vFlow;
      void main() {
        float d = abs(vSide);
        float body = smoothstep(1.0, 0.15, d);
        float dash = 1.0;
        if (vFlow.y != 0.0) {
          float u = fract((vFlow.x - uTime * vFlow.y) * 0.8);
          dash = smoothstep(0.0, 0.25, u) * smoothstep(1.0, 0.55, u);
        }
        float a = body * dash * vColor.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor.rgb, a);
      }`,
  });
}

export class RibbonBatch {
  readonly geometry = new THREE.BufferGeometry();
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly side: Float32Array;
  private readonly color: Float32Array;
  private readonly flow: Float32Array;
  private readonly index: Uint16Array;
  private v = 0;
  private ix = 0;
  private drawn = 0;
  private readonly cam = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(
    readonly maxPoints: number,
    readonly material: THREE.ShaderMaterial,
  ) {
    const dyn = THREE.DynamicDrawUsage;
    this.pos = new Float32Array(maxPoints * 2 * 3);
    this.side = new Float32Array(maxPoints * 2);
    this.color = new Float32Array(maxPoints * 2 * 4);
    this.flow = new Float32Array(maxPoints * 2 * 2);
    this.index = new Uint16Array(maxPoints * 6);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(dyn));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1).setUsage(dyn));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(dyn));
    this.geometry.setAttribute('aFlow', new THREE.BufferAttribute(this.flow, 2).setUsage(dyn));
    this.geometry.setIndex(new THREE.BufferAttribute(this.index, 1).setUsage(dyn));
    this.geometry.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  begin(camera: THREE.Camera): void {
    this.v = 0;
    this.ix = 0;
    camera.getWorldPosition(this.cam);
  }

  /**
   * One polyline of `count` points (xyz in `pts` from point `start`). `width` is the full ribbon
   * width (m); `alpha(i)` the opacity at point i (0..1, times `a`); `flow` the dash speed (0: solid).
   * Ends taper when `taper` is set. Lines that do not fit are dropped whole.
   */
  add(
    pts: ArrayLike<number>,
    start: number,
    count: number,
    width: number,
    r: number,
    g: number,
    b: number,
    a: number,
    alpha: (i: number) => number,
    flow = 0,
    taper = true,
  ): void {
    if (count < 2 || this.v + count * 2 > this.maxPoints * 2) return;
    const first = this.v;
    let along = 0;
    for (let i = 0; i < count; i++) {
      const k = (start + i) * 3;
      const p = Math.max(0, i - 1);
      const n = Math.min(count - 1, i + 1);
      this.t.set(
        pts[(start + n) * 3]! - pts[(start + p) * 3]!,
        pts[(start + n) * 3 + 1]! - pts[(start + p) * 3 + 1]!,
        pts[(start + n) * 3 + 2]! - pts[(start + p) * 3 + 2]!,
      );
      if (i > 0)
        along += Math.hypot(
          pts[k]! - pts[k - 3]!,
          pts[k + 1]! - pts[k - 2]!,
          pts[k + 2]! - pts[k - 1]!,
        );
      this.s.set(pts[k]! - this.cam.x, pts[k + 1]! - this.cam.y, pts[k + 2]! - this.cam.z);
      this.s.cross(this.t);
      const len = this.s.length() || 1;
      const end = taper ? Math.min(1, (Math.min(i, count - 1 - i) + 0.5) / 2) : 1;
      this.s.multiplyScalar((width * 0.5 * end) / len);
      const op = Math.max(0, Math.min(1, alpha(i))) * a;
      // Two vertices across the ribbon (no per-point allocation: this runs every frame).
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const v = this.v++;
        this.pos[v * 3] = pts[k]! + this.s.x * sgn;
        this.pos[v * 3 + 1] = pts[k + 1]! + this.s.y * sgn;
        this.pos[v * 3 + 2] = pts[k + 2]! + this.s.z * sgn;
        this.side[v] = sgn;
        this.color[v * 4] = r;
        this.color[v * 4 + 1] = g;
        this.color[v * 4 + 2] = b;
        this.color[v * 4 + 3] = op;
        this.flow[v * 2] = along;
        this.flow[v * 2 + 1] = flow;
      }
    }
    for (let i = 0; i < count - 1; i++) {
      const a0 = first + i * 2;
      this.index[this.ix++] = a0;
      this.index[this.ix++] = a0 + 1;
      this.index[this.ix++] = a0 + 2;
      this.index[this.ix++] = a0 + 1;
      this.index[this.ix++] = a0 + 3;
      this.index[this.ix++] = a0 + 2;
    }
  }

  end(): void {
    this.geometry.setDrawRange(0, this.ix);
    if (this.ix > 0 || this.drawn > 0) {
      for (const name of ['position', 'aSide', 'aColor', 'aFlow'])
        (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
      this.geometry.getIndex()!.needsUpdate = true;
    }
    this.drawn = this.ix;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
