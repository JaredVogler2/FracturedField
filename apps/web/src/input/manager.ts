import {
  DEFAULT_ABILITIES,
  DEFAULT_LOADOUT,
  DEFAULT_RULES,
  MERIDIAN_ARENA,
  type AdvancedAbilityId,
} from '@ff/game-data';
import { IntentEmitter, worldToAim, type ActionEdge, type IntentSink } from '@ff/controls';
import type { HandState, InputSource, PlayerSlot, Vec2, WorldSnapshot } from '@ff/protocol';
import { view } from '../render/view';
import { localAim } from '../render/vfx/local-aim';
import type { KeyBindings, BindingAction } from './bindings';
import { MODE_SOURCE, type ControlMode } from './capabilities';
import type { MotionConfig } from './motion';
import { MotionController } from './motion-controller';
import { GamepadController } from './gamepad';

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
  /**
   * Hands-on control (ADR-0009): this seat's inputs describe a hand — grip, push, twist — that
   * rides on its aim intents; the authority turns it into force.
   */
  handsOn = false;
  private handState: HandState | null = null;
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
      // A hand described by the previous device does not carry over (nothing stays gripped).
      this.handState = null;
    }
  }

  /** The hand the seat's active input describes (hands-on control only). */
  get hand(): HandState | null {
    return this.handsOn ? this.handState : null;
  }

  /** An adapter describes the hand; only the device that owns the aim is listened to. */
  setHand(hand: HandState | null, source: InputSource): void {
    if (source === this.activeSource) this.handState = hand;
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

  /**
   * Sends an ability edge. `source` is the device that pressed it (a thumb button, a key, a pad
   * button) and is reported on this intent only; aim intents keep reporting the aim owner.
   */
  edge(edge: ActionEdge, now: number, source: InputSource = this.activeSource): void {
    const seq = this.emitter.nextSeq;
    if (source !== this.activeSource) this.emitter.setSource(source);
    this.emitter.edge(edge, this.aim(), now);
    if (source !== this.activeSource) this.emitter.setSource(this.activeSource);
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
    if (isTypingTarget(e.target) || isControlActivation(e)) return;
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

/** Keys whose browser default (scrolling, quick find) would fight the game. Tab stays free. */
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash']);

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

/**
 * Enter or Space on a control the player reached with the keyboard (Tab: `:focus-visible`)
 * activates that control, not a game key. A HUD button a mouse player just clicked keeps focus
 * without focus-visible, so Space still pulses for them.
 */
export function isControlActivation(e: KeyboardEvent): boolean {
  if (e.code !== 'Enter' && e.code !== 'NumpadEnter' && e.code !== 'Space') return false;
  const t = e.target;
  return (
    (t instanceof HTMLButtonElement ||
      t instanceof HTMLSelectElement ||
      t instanceof HTMLAnchorElement) &&
    t.matches(':focus-visible')
  );
}

const hub = new KeyboardHub();

/** Screen-relative keyboard steering with local reticle prediction, plus ability keys. */
class KeyboardController {
  private readonly unsubscribe: () => void;
  private readonly lookup = new Map<string, BindingAction>();
  private paused = false;

  constructor(
    readonly seat: SeatInput,
    bindings: KeyBindings,
  ) {
    this.setBindings(bindings);
    this.unsubscribe = hub.subscribe((code, pressed, repeat) => this.onKey(code, pressed, repeat));
  }

  /** Replaces the layout live (rebinding during a pause); held abilities are released first. */
  setBindings(bindings: KeyBindings): void {
    if (this.lookup.size > 0) this.seat.emitter.releaseAll(performance.now());
    this.lookup.clear();
    for (const [action, codes] of Object.entries(bindings) as [
      BindingAction,
      readonly string[],
    ][]) {
      for (const code of codes) this.lookup.set(code, action);
    }
  }

  private held(action: BindingAction): boolean {
    for (const [code, a] of this.lookup) if (a === action && hub.down.has(code)) return true;
    return false;
  }

  private fire(edge: ActionEdge, now: number): void {
    this.seat.edge(edge, now, 'keyboard');
  }

  private onKey(code: string, pressed: boolean, repeat: boolean): void {
    const action = this.lookup.get(code);
    if (!action || this.paused) return;
    const now = performance.now();
    if (action === 'lift') {
      if (pressed && !repeat) this.fire({ action: 'lift', phase: 'start' }, now);
      else if (!pressed && !this.held('lift')) this.fire({ action: 'lift', phase: 'end' }, now);
      return;
    }
    if (action === 'adv1' || action === 'adv2') {
      const ability = this.seat.loadout[action === 'adv1' ? 0 : 1];
      if (DEFAULT_ABILITIES[ability].kind === 'hold') {
        if (pressed && !repeat) this.fire({ action: ability, phase: 'start' }, now);
        else if (!pressed && !this.held(action)) this.fire({ action: ability, phase: 'end' }, now);
      } else if (pressed && !repeat) this.fire({ action: ability, phase: 'tap' }, now);
      return;
    }
    if (!pressed || repeat) return;
    const axes = view.groundAxes();
    switch (action) {
      case 'pulse':
        this.fire({ action: 'pulse', phase: 'tap' }, now);
        break;
      case 'guard':
        this.fire({ action: 'guard', phase: 'tap' }, now);
        break;
      case 'infuseWet':
        this.fire({ action: 'infuse', phase: 'tap', modifier: 0 }, now);
        break;
      case 'infuseHeat':
        this.fire({ action: 'infuse', phase: 'tap', modifier: 1 }, now);
        break;
      case 'sweepUp':
        this.fire({ action: 'sweep', phase: 'tap', modifier: 1, dir: [axes.up.x, axes.up.z] }, now);
        break;
      case 'sweepDown':
        this.fire(
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

/**
 * A mouse's hand (hands-on): the button closes it (ramped, per second); the wheel pushes (a rate:
 * it eases back) or, while holding, turns the grip — which stays turned, like a knob, until the
 * hand opens and it eases back.
 */
const MOUSE_GRIP_RATE = 10;
const MOUSE_PUSH_TAU = 0.15;
const MOUSE_TWIST_TAU = 0.3;

/**
 * Mouse aiming (absolute, raycast onto the arena plane) and mouse-button abilities. Hands-on:
 * hold the left button to grip, swing and release to throw, wheel to twist what you hold (or,
 * with an open hand, to push / pull); right click PULSE, middle GUARD.
 */
class PointerController {
  private readonly el: HTMLElement;
  private lastClient: { x: number; y: number } | null = null;
  private paused = false;
  private liftButtonDown = false;
  private gripTarget = 0;
  private grip = 0;
  private push = 0;
  private twist = 0;
  private lastTick = performance.now();

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

  private fire(edge: ActionEdge, now: number): void {
    this.seat.edge(edge, now, 'pointer');
  }

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
    if (this.seat.handsOn) {
      if (e.button === 0) this.gripTarget = 1;
      else if (e.button === 2) this.fire({ action: 'pulse', phase: 'tap' }, now);
      else if (e.button === 1) {
        e.preventDefault();
        this.fire({ action: 'guard', phase: 'tap' }, now);
      }
      return;
    }
    if (e.button === 0) this.fire({ action: 'pulse', phase: 'tap' }, now);
    else if (e.button === 2) {
      this.liftButtonDown = true;
      this.fire({ action: 'lift', phase: 'start' }, now);
    } else if (e.button === 1) {
      e.preventDefault();
      this.fire({ action: 'guard', phase: 'tap' }, now);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) this.gripTarget = 0;
    if (e.button === 2 && this.liftButtonDown) {
      this.liftButtonDown = false;
      this.fire({ action: 'lift', phase: 'end' }, performance.now());
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.paused) return;
    e.preventDefault();
    if (this.seat.handsOn) {
      // Wheel forward = clockwise wrist (holding) or push (open hand); back = the opposite.
      const notch = Math.max(-1, Math.min(1, -e.deltaY / 100));
      if (this.grip > 0.5) this.twist = Math.max(-1, Math.min(1, this.twist + notch * 0.4));
      else this.push = Math.max(-1, Math.min(1, this.push + notch * 0.8));
      return;
    }
    const axes = view.groundAxes();
    const up = e.deltaY < 0;
    const now = performance.now();
    this.fire(
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

  /** Hands-on: ramps the grip, lets push and twist ease back, and describes the hand. */
  tick(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    if (!this.seat.handsOn) return;
    const step = MOUSE_GRIP_RATE * dt;
    this.grip += Math.max(-step, Math.min(step, this.gripTarget - this.grip));
    this.push *= Math.exp(-dt / MOUSE_PUSH_TAU);
    if (this.grip <= 0.5) this.twist *= Math.exp(-dt / MOUSE_TWIST_TAU);
    if (Math.abs(this.push) < 0.01) this.push = 0;
    if (Math.abs(this.twist) < 0.01) this.twist = 0;
    this.seat.setHand({ grip: this.grip, push: this.push, twist: this.twist }, 'pointer');
  }

  pause(): void {
    this.paused = true;
    this.gripTarget = this.grip = this.push = this.twist = 0;
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

/** How close (m) to a body a finger must land on the arena to take hold of it (hands-on). */
const TOUCH_GRAB_RADIUS = 1.8;
/** A two-finger turn of this much (radians) is a full twist. */
const TOUCH_TWIST_RANGE = Math.PI / 3;

/**
 * One-finger drag aiming on the arena; abilities come from on-screen buttons (TouchControls).
 * Hands-on: a finger that lands on a body holds it (drag, then lift the finger to throw); one
 * that lands on open floor is an open hand (dragging it sweeps); a second finger turning around
 * the first twists what is held.
 */
class TouchAimController {
  private activeId: number | null = null;
  private paused = false;
  private holding = false;
  private primary: { x: number; y: number } | null = null;
  private second: { id: number; x: number; y: number; angle0: number } | null = null;
  private twist = 0;

  constructor(
    private readonly seat: SeatInput,
    private readonly el: HTMLElement,
    private readonly nearBody: (x: number, z: number, radius: number) => boolean = () => false,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch' || this.paused) return;
    if (this.activeId !== null) {
      // A second finger: hands-on, it turns around the first to twist.
      if (this.seat.handsOn && !this.second && this.primary) {
        this.second = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          angle0: Math.atan2(e.clientY - this.primary.y, e.clientX - this.primary.x),
        };
      }
      return;
    }
    this.activeId = e.pointerId;
    this.el.setPointerCapture?.(e.pointerId);
    this.aimAt(e);
    const r = this.seat.reticle;
    this.holding = this.seat.handsOn && this.nearBody(r.x, r.z, TOUCH_GRAB_RADIUS);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.paused) return;
    if (this.second && e.pointerId === this.second.id) {
      this.second.x = e.clientX;
      this.second.y = e.clientY;
      this.updateTwist();
      return;
    }
    if (e.pointerId !== this.activeId) return;
    this.aimAt(e);
    this.updateTwist();
  };

  private onUp = (e: PointerEvent): void => {
    if (this.second && e.pointerId === this.second.id) {
      this.second = null;
      this.twist = 0;
    }
    if (e.pointerId === this.activeId) {
      // Lifting the finger opens the hand: whatever it held flies on with its own velocity.
      this.activeId = null;
      this.holding = false;
      this.primary = null;
      this.second = null;
      this.twist = 0;
    }
  };

  private updateTwist(): void {
    if (!this.second || !this.primary) return;
    const a = Math.atan2(this.second.y - this.primary.y, this.second.x - this.primary.x);
    let d = a - this.second.angle0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    // Screen y points down: a clockwise turn on screen increases the angle.
    this.twist = Math.max(-1, Math.min(1, d / TOUCH_TWIST_RANGE));
  }

  tick(): void {
    if (!this.seat.handsOn) return;
    this.seat.setHand({ grip: this.holding ? 1 : 0, push: 0, twist: this.twist }, 'touch');
  }

  private aimAt(e: PointerEvent): void {
    this.primary = { x: e.clientX, y: e.clientY };
    const p = view.screenToArena(e.clientX, e.clientY, DEFAULT_RULES.manipulator.height);
    if (!p) return;
    this.seat.setReticle(p.x, p.z);
    this.seat.claim('touch', performance.now());
  }

  pause(): void {
    this.paused = true;
    this.holding = false;
    this.second = null;
    this.twist = 0;
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
  /**
   * The seat's control mode, for a single local player (touch/accessible add drag-aim on the
   * arena, motion adds gyro aiming). Shared-keyboard duel seats leave it unset.
   */
  readonly mode?: ControlMode;
  /** A game controller may drive this seat (single local player; plugs in at any time). */
  readonly gamepad?: boolean;
  readonly loadout?: readonly [AdvancedAbilityId, AdvancedAbilityId];
}

/**
 * One input method feeding a seat (D06 "InputController"). It is enabled by construction and
 * writes into its SeatInput: the aim (getAim = SeatInput.aim()) and ability edges (actionStart /
 * actionHold / actionEnd = SeatInput.edge phases). Disposal removes every listener it added.
 */
export interface InputAdapter {
  pause(): void;
  resume(): void;
  dispose(): void;
  /** Re-zero against the player's current pose (motion recenter); absent where meaningless. */
  calibrate?(): void;
  /** Optional per-frame work (motion stall detection, gamepad polling). */
  tick?(now: number): void;
}

/**
 * Owns all local controllers for a match: one SeatInput (single sequence space) per local seat,
 * keyboard / pointer / touch controllers feeding it, focus-loss safety and the per-frame aim pump.
 */
export class InputManager {
  readonly seats = new Map<PlayerSlot, SeatInput>();
  private readonly controllers: InputAdapter[] = [];
  private readonly keyboards: KeyboardController[] = [];
  /** Adapters that belong to a seat's current control mode (swapped by setMode). */
  private readonly modal = new Map<PlayerSlot, { mode: ControlMode; adapters: InputAdapter[] }>();
  private lastFrame = performance.now();
  private paused = false;
  /** The newest authoritative snapshot (hands-on touch: did the finger land on a body?). */
  private latest: WorldSnapshot | null = null;

  /** True when a movable body's centre lies within `radius` of (x, z) on the arena. */
  private readonly nearBody = (x: number, z: number, radius: number): boolean =>
    this.latest?.entities.some(
      (e) =>
        (e.kind === 'core' ||
          e.kind === 'boulder' ||
          e.kind === 'lodestone' ||
          e.kind === 'shard') &&
        Math.hypot(e.p[0] - x, e.p[2] - z) <= radius,
    ) ?? false;

  constructor(
    configs: readonly SeatConfig[],
    private readonly element: HTMLElement,
    send: IntentSink,
  ) {
    for (const c of configs) {
      const seat = new SeatInput(c.slot, 'keyboard', send, c.loadout ?? DEFAULT_LOADOUT);
      this.seats.set(c.slot, seat);
      const kb = new KeyboardController(seat, c.bindings);
      this.keyboards.push(kb);
      this.controllers.push(kb);
      if (c.pointer) this.controllers.push(new PointerController(seat, element));
      if (c.gamepad && typeof navigator.getGamepads === 'function')
        this.controllers.push(new GamepadController(seat));
      if (c.mode) this.setMode(c.slot, c.mode);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
  }

  /**
   * Hot-swaps a seat's control mode mid-match: held abilities are released first (no effect
   * survives the handover), the old mode's listeners are removed, and the seat keeps its intent
   * sequence, so the authority sees one continuous stream. From the swap on, the seat reports the
   * new mode's source (on-screen buttons and the idle aim pump included).
   */
  setMode(slot: PlayerSlot, mode: ControlMode, motion: Partial<MotionConfig> = {}): void {
    const seat = this.seats.get(slot);
    if (!seat) return;
    const current = this.modal.get(slot);
    if (current?.mode === mode) return;
    const now = performance.now();
    seat.emitter.releaseAll(now);
    seat.claim(MODE_SOURCE[mode], now);
    for (const a of current?.adapters ?? []) a.dispose();
    const adapters: InputAdapter[] = [];
    if (mode === 'touch' || mode === 'accessible')
      adapters.push(new TouchAimController(seat, this.element, this.nearBody));
    if (mode === 'motion') adapters.push(new MotionController(seat, motion));
    if (this.paused) for (const a of adapters) a.pause();
    this.modal.set(slot, { mode, adapters });
  }

  mode(slot: PlayerSlot): ControlMode | undefined {
    return this.modal.get(slot)?.mode;
  }

  /**
   * Hands-on control for a seat (ADR-0009). Turning it off opens the hand at once, so nothing the
   * seat held stays gripped.
   */
  setHandsOn(slot: PlayerSlot, on: boolean): void {
    const seat = this.seats.get(slot);
    if (!seat || seat.handsOn === on) return;
    seat.handsOn = on;
    if (!on) seat.setHand(null, seat.source);
  }

  /** Applies a changed keyboard layout to a seat without restarting its intent stream. */
  setBindings(slot: PlayerSlot, bindings: KeyBindings): void {
    for (const kb of this.keyboards) if (kb.seat.slot === slot) kb.setBindings(bindings);
  }

  /** The seat's motion adapter, when it is in motion mode. */
  motion(slot: PlayerSlot): MotionController | undefined {
    return this.modal
      .get(slot)
      ?.adapters.find((a): a is MotionController => a instanceof MotionController);
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
    this.latest = latest;
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    for (const seat of this.seats.values()) {
      if (!seat.reticle.initialised && latest) {
        const m = latest.players[seat.slot].m;
        seat.setReticle(m[0], m[1]);
      }
    }
    for (const c of this.controllers) c.tick?.(now);
    for (const { adapters } of this.modal.values()) for (const a of adapters) a.tick?.(now);
    if (this.paused) return;
    for (const kb of this.keyboards) kb.update(dt, now);
    for (const seat of this.seats.values()) seat.emitter.aim(seat.aim(), now, false, seat.hand);
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
      if (seat.reticle.initialised) seat.emitter.aim(seat.aim(), now, true, seat.hand);
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

  /** A seat's shared aim/intent state, for adapters that live outside the manager (camera). */
  seat(slot: PlayerSlot): SeatInput | undefined {
    return this.seats.get(slot);
  }

  /** Ability edge from an on-screen control (the thumb buttons in touch, motion and simplified). */
  action(slot: PlayerSlot, edge: ActionEdge, source: InputSource = 'touch'): void {
    this.seats.get(slot)?.edge(edge, performance.now(), source);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.releaseAll();
    const all = [...this.controllers, ...[...this.modal.values()].flatMap((m) => m.adapters)];
    for (const c of all) {
      if (paused) c.pause();
      else c.resume();
    }
  }

  dispose(): void {
    this.releaseAll();
    for (const slot of this.seats.keys()) localAim.delete(slot);
    for (const c of this.controllers) c.dispose();
    for (const { adapters } of this.modal.values()) for (const a of adapters) a.dispose();
    this.modal.clear();
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
  }
}
