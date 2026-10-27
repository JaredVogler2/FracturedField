import {
  DEFAULT_ABILITIES,
  DEFAULT_LOADOUT,
  DEFAULT_RULES,
  MERIDIAN_ARENA,
  type AdvancedAbilityId,
} from '@ff/game-data';
import { IntentEmitter, worldToAim, type ActionEdge, type IntentSink } from '@ff/controls';
import type { InputSource, PlayerSlot, Vec2, WorldSnapshot } from '@ff/protocol';
import { view } from '../render/view';
import { localAim } from '../render/vfx/local-aim';
import type { KeyBindings, BindingAction } from './bindings';

const ARENA = MERIDIAN_ARENA;
const SPACE = { halfLength: ARENA.halfLength, halfWidth: ARENA.halfWidth };

/** Mirrors the authority's legal manipulator region so the local reticle never leaves it. */
function clampToSide(slot: PlayerSlot, x: number, z: number): { x: number; z: number } {
  const m = DEFAULT_RULES.manipulator;
  const L = ARENA.halfLength - m.wallMargin;
  const W = ARENA.halfWidth - m.wallMargin;
  const minX = slot === 0 ? -L : -m.midlineReach;
  const maxX = slot === 0 ? m.midlineReach : L;
  return { x: Math.min(maxX, Math.max(minX, x)), z: Math.min(W, Math.max(-W, z)) };
}

/** Per-seat aim + action state shared by all of a seat's controllers. */
export class SeatInput {
  readonly emitter: IntentEmitter;
  /** Locally predicted reticle (cosmetic; the authority decides the real manipulator). */
  readonly reticle = { x: 0, z: 0, initialised: false };
  private activeSource: InputSource;
  private lastActivity = 0;

  constructor(
    readonly slot: PlayerSlot,
    source: InputSource,
    send: IntentSink,
    /** Advanced moves bound to the seat's two loadout keys. */
    readonly loadout: readonly [AdvancedAbilityId, AdvancedAbilityId] = DEFAULT_LOADOUT,
  ) {
    this.activeSource = source;
    this.emitter = new IntentEmitter(slot, source, send, 15);
  }

  get source(): InputSource {
    return this.activeSource;
  }

  /** Marks a controller as the active aim source (most recent activity wins). */
  claim(source: InputSource, now: number): void {
    this.lastActivity = now;
    if (source !== this.activeSource) {
      this.activeSource = source;
      this.emitter.setSource(source);
    }
  }

  get idleMs(): number {
    return performance.now() - this.lastActivity;
  }

  setReticle(x: number, z: number): void {
    const c = clampToSide(this.slot, x, z);
    this.reticle.x = c.x;
    this.reticle.z = c.z;
    this.reticle.initialised = true;
    localAim.set(this.slot, { x: c.x, z: c.z });
  }

  aim(): Vec2 {
    return worldToAim(this.reticle.x, this.reticle.z, SPACE);
  }

  /** Recent sequence -> ability, so refused actions can be shown on the right HUD chip. */
  private readonly recent = new Map<number, string>();

  edge(edge: ActionEdge, now: number): void {
    const seq = this.emitter.nextSeq;
    this.emitter.edge(edge, this.aim(), now);
    this.recent.set(seq, edge.action);
    if (this.recent.size > 64) {
      const first = this.recent.keys().next();
      if (!first.done) this.recent.delete(first.value);
    }
  }

  actionForSeq(seq: number): string | undefined {
    return this.recent.get(seq);
  }
}

/** Shared keyboard state (one window listener for all keyboard controllers). */
class KeyboardHub {
  readonly down = new Set<string>();
  private readonly listeners = new Set<(code: string, pressed: boolean, repeat: boolean) => void>();
  private attached = false;

  private onDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return;
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    const fresh = !this.down.has(e.code);
    this.down.add(e.code);
    for (const l of this.listeners) l(e.code, true, !fresh || e.repeat);
  };
  private onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
    for (const l of this.listeners) l(e.code, false, false);
  };
  private onBlur = (): void => {
    for (const code of [...this.down]) {
      this.down.delete(code);
      for (const l of this.listeners) l(code, false, false);
    }
  };

  subscribe(fn: (code: string, pressed: boolean, repeat: boolean) => void): () => void {
    this.listeners.add(fn);
    if (!this.attached) {
      window.addEventListener('keydown', this.onDown);
      window.addEventListener('keyup', this.onUp);
      window.addEventListener('blur', this.onBlur);
      this.attached = true;
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.attached) {
        window.removeEventListener('keydown', this.onDown);
        window.removeEventListener('keyup', this.onUp);
        window.removeEventListener('blur', this.onBlur);
        this.attached = false;
        this.down.clear();
      }
    };
  }
}

const GAME_KEYS = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Slash',
  'Tab',
]);

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

const hub = new KeyboardHub();

/** Screen-relative keyboard steering with local reticle prediction, plus ability keys. */
class KeyboardController {
  private readonly unsubscribe: () => void;
  private readonly lookup = new Map<string, BindingAction>();
  private paused = false;

  constructor(
    private readonly seat: SeatInput,
    bindings: KeyBindings,
  ) {
    for (const [action, codes] of Object.entries(bindings) as [
      BindingAction,
      readonly string[],
    ][]) {
      for (const code of codes) this.lookup.set(code, action);
    }
    this.unsubscribe = hub.subscribe((code, pressed, repeat) => this.onKey(code, pressed, repeat));
  }

  private held(action: BindingAction): boolean {
    for (const [code, a] of this.lookup) if (a === action && hub.down.has(code)) return true;
    return false;
  }

  private onKey(code: string, pressed: boolean, repeat: boolean): void {
    const action = this.lookup.get(code);
    if (!action || this.paused) return;
    const now = performance.now();
    if (action === 'lift') {
      if (pressed && !repeat) this.seat.edge({ action: 'lift', phase: 'start' }, now);
      else if (!pressed && !this.held('lift'))
        this.seat.edge({ action: 'lift', phase: 'end' }, now);
      return;
    }
    if (action === 'adv1' || action === 'adv2') {
      const ability = this.seat.loadout[action === 'adv1' ? 0 : 1];
      if (DEFAULT_ABILITIES[ability].kind === 'hold') {
        if (pressed && !repeat) this.seat.edge({ action: ability, phase: 'start' }, now);
        else if (!pressed && !this.held(action))
          this.seat.edge({ action: ability, phase: 'end' }, now);
      } else if (pressed && !repeat) this.seat.edge({ action: ability, phase: 'tap' }, now);
      return;
    }
    if (!pressed || repeat) return;
    const axes = view.groundAxes();
    switch (action) {
      case 'pulse':
        this.seat.edge({ action: 'pulse', phase: 'tap' }, now);
        break;
      case 'guard':
        this.seat.edge({ action: 'guard', phase: 'tap' }, now);
        break;
      case 'infuseWet':
        this.seat.edge({ action: 'infuse', phase: 'tap', modifier: 0 }, now);
        break;
      case 'infuseHeat':
        this.seat.edge({ action: 'infuse', phase: 'tap', modifier: 1 }, now);
        break;
      case 'sweepUp':
        this.seat.edge(
          { action: 'sweep', phase: 'tap', modifier: 1, dir: [axes.up.x, axes.up.z] },
          now,
        );
        break;
      case 'sweepDown':
        this.seat.edge(
          { action: 'sweep', phase: 'tap', modifier: -1, dir: [-axes.up.x, -axes.up.z] },
          now,
        );
        break;
      default:
        break;
    }
  }

  /** Integrates movement keys into the predicted reticle at the manipulator speed cap. */
  update(dtSeconds: number, now: number): void {
    if (this.paused) return;
    let mx = 0;
    let my = 0;
    if (this.held('right')) mx += 1;
    if (this.held('left')) mx -= 1;
    if (this.held('up')) my += 1;
    if (this.held('down')) my -= 1;
    if (mx === 0 && my === 0) return;
    const len = Math.hypot(mx, my);
    const axes = view.groundAxes();
    const step = DEFAULT_RULES.manipulator.maxSpeed * Math.min(dtSeconds, 0.05);
    const dx = ((axes.right.x * mx + axes.up.x * my) / len) * step;
    const dz = ((axes.right.z * mx + axes.up.z * my) / len) * step;
    this.seat.setReticle(this.seat.reticle.x + dx, this.seat.reticle.z + dz);
    this.seat.claim('keyboard', now);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  dispose(): void {
    this.unsubscribe();
  }
}

/** Mouse aiming (absolute, raycast onto the arena plane) and mouse-button abilities. */
class PointerController {
  private readonly el: HTMLElement;
  private lastClient: { x: number; y: number } | null = null;
  private paused = false;
  private liftButtonDown = false;

  constructor(
    private readonly seat: SeatInput,
    el: HTMLElement,
  ) {
    this.el = el;
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
  }

  private onMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.paused) return;
    this.lastClient = { x: e.clientX, y: e.clientY };
    this.project(performance.now());
  };

  private project(now: number): void {
    if (!this.lastClient) return;
    const p = view.screenToArena(
      this.lastClient.x,
      this.lastClient.y,
      DEFAULT_RULES.manipulator.height,
    );
    if (!p) return;
    this.seat.setReticle(p.x, p.z);
    this.seat.claim('pointer', now);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.paused) return;
    const now = performance.now();
    this.lastClient = { x: e.clientX, y: e.clientY };
    this.project(now);
    if (e.button === 0) this.seat.edge({ action: 'pulse', phase: 'tap' }, now);
    else if (e.button === 2) {
      this.liftButtonDown = true;
      this.seat.edge({ action: 'lift', phase: 'start' }, now);
    } else if (e.button === 1) {
      e.preventDefault();
      this.seat.edge({ action: 'guard', phase: 'tap' }, now);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 2 && this.liftButtonDown) {
      this.liftButtonDown = false;
      this.seat.edge({ action: 'lift', phase: 'end' }, performance.now());
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.paused) return;
    e.preventDefault();
    const axes = view.groundAxes();
    const up = e.deltaY < 0;
    const now = performance.now();
    this.seat.edge(
      {
        action: 'sweep',
        phase: 'tap',
        modifier: up ? 1 : -1,
        dir: up ? [axes.up.x, axes.up.z] : [-axes.up.x, -axes.up.z],
      },
      now,
    );
  };

  private onContext = (e: Event): void => {
    e.preventDefault();
  };

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  dispose(): void {
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
  }
}

/** One-finger drag aiming on the arena; abilities come from on-screen buttons (TouchControls). */
class TouchAimController {
  private activeId: number | null = null;
  private paused = false;

  constructor(
    private readonly seat: SeatInput,
    private readonly el: HTMLElement,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || this.paused || this.activeId !== null) return;
    this.activeId = e.pointerId;
    this.el.setPointerCapture?.(e.pointerId);
    this.aimAt(e);
  };

  private onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activeId || this.paused) return;
    this.aimAt(e);
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.activeId) this.activeId = null;
  };

  private aimAt(e: PointerEvent): void {
    const p = view.screenToArena(e.clientX, e.clientY, DEFAULT_RULES.manipulator.height);
    if (!p) return;
    this.seat.setReticle(p.x, p.z);
    this.seat.claim('touch', performance.now());
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
  }
}

export interface SeatConfig {
  readonly slot: PlayerSlot;
  readonly bindings: KeyBindings;
  readonly pointer: boolean;
  readonly touch: boolean;
  readonly loadout?: readonly [AdvancedAbilityId, AdvancedAbilityId];
}

interface Pausable {
  pause(): void;
  resume(): void;
  dispose(): void;
}

/**
 * Owns all local controllers for a match: one SeatInput (single sequence space) per local seat,
 * keyboard / pointer / touch controllers feeding it, focus-loss safety and the per-frame aim pump.
 */
export class InputManager {
  readonly seats = new Map<PlayerSlot, SeatInput>();
  private readonly controllers: Pausable[] = [];
  private readonly keyboards: KeyboardController[] = [];
  private lastFrame = performance.now();
  private paused = false;

  constructor(configs: readonly SeatConfig[], element: HTMLElement, send: IntentSink) {
    for (const c of configs) {
      const seat = new SeatInput(c.slot, 'keyboard', send, c.loadout ?? DEFAULT_LOADOUT);
      this.seats.set(c.slot, seat);
      const kb = new KeyboardController(seat, c.bindings);
      this.keyboards.push(kb);
      this.controllers.push(kb);
      if (c.pointer) this.controllers.push(new PointerController(seat, element));
      if (c.touch) this.controllers.push(new TouchAimController(seat, element));
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
  }

  private onVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private onBlur = (): void => {
    this.releaseAll();
  };

  /** Ends every held ability (no stuck LIFT when focus or the tab is lost). */
  releaseAll(): void {
    const now = performance.now();
    for (const seat of this.seats.values()) seat.emitter.releaseAll(now);
  }

  /** Call once per animation frame with the newest authoritative snapshot. */
  update(latest: WorldSnapshot | null): void {
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    for (const seat of this.seats.values()) {
      if (!seat.reticle.initialised && latest) {
        const m = latest.players[seat.slot].m;
        seat.setReticle(m[0], m[1]);
      }
    }
    if (this.paused) return;
    for (const kb of this.keyboards) kb.update(dt, now);
    for (const seat of this.seats.values()) seat.emitter.aim(seat.aim(), now);
  }

  /**
   * A new connection to the authority replaced the old one: held abilities were cancelled
   * server-side and the sequence space restarted. Re-send only the idempotent aim (never replay
   * casts, which may already have been applied).
   */
  onNewConnection(): void {
    const now = performance.now();
    for (const seat of this.seats.values()) {
      seat.emitter.forgetHeld();
      seat.emitter.resetSequence();
      if (seat.reticle.initialised) seat.emitter.aim(seat.aim(), now, true);
    }
  }

  /** Resynchronise reticles to the authoritative manipulators (after kickoff resets). */
  snapReticles(latest: WorldSnapshot): void {
    for (const seat of this.seats.values()) {
      const m = latest.players[seat.slot].m;
      seat.setReticle(m[0], m[1]);
    }
  }

  actionForSeq(slot: PlayerSlot, seq: number): string | undefined {
    return this.seats.get(slot)?.actionForSeq(seq);
  }

  /** Programmatic ability edge (touch buttons, accessibility controls). */
  action(slot: PlayerSlot, edge: ActionEdge): void {
    this.seats.get(slot)?.edge(edge, performance.now());
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.releaseAll();
    for (const c of this.controllers) {
      if (paused) c.pause();
      else c.resume();
    }
  }

  dispose(): void {
    this.releaseAll();
    for (const slot of this.seats.keys()) localAim.delete(slot);
    for (const c of this.controllers) c.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
  }
}
