import * as THREE from 'three';

/**
 * Bridge between the render camera and input: projects pointer positions onto the arena plane and
 * exposes screen-aligned ground axes for screen-relative keyboard/stick movement.
 */
class ViewState {
  camera: THREE.PerspectiveCamera | null = null;
  element: HTMLElement | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  /** World point on the horizontal plane y = planeY under a client-space pointer position. */
  screenToArena(clientX: number, clientY: number, planeY = 0): { x: number; z: number } | null {
    const cam = this.camera;
    const el = this.element;
    if (!cam || !el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, cam);
    this.plane.constant = -planeY;
    const p = this.raycaster.ray.intersectPlane(this.plane, this.hit);
    return p ? { x: p.x, z: p.z } : null;
  }

  /** Unit ground-plane vectors for screen-right and screen-up (away from the viewer). */
  groundAxes(): { right: { x: number; z: number }; up: { x: number; z: number } } {
    const cam = this.camera;
    if (!cam) return { right: { x: 1, z: 0 }, up: { x: 0, z: -1 } };
    cam.getWorldDirection(this.tmp);
    let ux = this.tmp.x;
    let uz = this.tmp.z;
    const ul = Math.hypot(ux, uz) || 1;
    ux /= ul;
    uz /= ul;
    // Right = up rotated -90° about Y (screen right when looking along `up`).
    return { right: { x: -uz, z: ux }, up: { x: ux, z: uz } };
  }

  /** Projects a world point to client coordinates (for HUD anchoring); null if behind camera. */
  worldToClient(x: number, y: number, z: number): { x: number; y: number } | null {
    const cam = this.camera;
    const el = this.element;
    if (!cam || !el) return null;
    this.tmp.set(x, y, z).project(cam);
    if (this.tmp.z > 1) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + ((this.tmp.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.tmp.y) / 2) * rect.height,
    };
  }
}

export const view = new ViewState();
