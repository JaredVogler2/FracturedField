/**
 * Game controller input (Phase 06 / D06): the W3C "standard" pad layout mapped to the same
 * actions as the keyboard. The mapping is pure (testable with plain objects); GamepadController
 * polls navigator.getGamepads() once per frame and feeds a seat.
 *
 *   left stick  move the force point (right stick: fine, 40 %)
 *   A / RT      PULSE            B   GUARD
 *   X           WET              Y   HEAT
 *   LB / RB     first / second pick (held for hold moves)
 *   LT          LIFT (held)      D-pad  SWEEP in that screen direction
 *   Start       pause menu
 *
 * Hands-on (ADR-0009) the pad describes a hand: RT closes it (analog — squeeze to hold, ease off
 * to let go and throw), the right stick turns it (x: right is clockwise) and pushes or pulls
 * (y: up pushes away). A still PULSEs; the rest is unchanged.
 */
import { create } from 'zustand';
import {
  DEFAULT_ABILITIES,
  DEFAULT_RULES,
  type AbilityId,
  type AdvancedAbilityId,
} from '@ff/game-data';
import type { ActionEdge } from '@ff/controls';
import type { HandState } from '@ff/protocol';
import type { SeatInput } from './manager';
import { view } from '../render/view';

/** The part of a Gamepad the mapper reads (real pads and test doubles alike). */
export interface PadState {
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

/** A screen-space edge: SWEEP carries its screen direction until the controller maps it. */
export type PadEdge =
  ActionEdge | { readonly action: 'sweep-screen'; readonly x: number; readonly y: number };

export interface PadFrame {
  /** Stick deflection in screen space (x right, y up), 0..1 magnitude after the dead zone. */
  readonly move: readonly [number, number];
  readonly edges: readonly PadEdge[];
  /** Start was pressed this frame. */
  readonly menu: boolean;
  /** Hands-on: the hand the pad describes (null when hands-on is off). */
  readonly hand: HandState | null;
}

const DEAD = 0.18;
/** A trigger resting under this is open (worn triggers rarely rest at exactly 0). */
const TRIGGER_REST = 0.05;
const B = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
};

/** Radial dead zone with a quadratic response: precise near centre, full speed at the rim. */
function stick(x: number, y: number): [number, number] {
  const fx = Number.isFinite(x) ? x : 0;
  const fy = Number.isFinite(y) ? y : 0;
  const m = Math.min(1, Math.hypot(fx, fy));
  if (m <= DEAD) return [0, 0];
  const k = ((m - DEAD) / (1 - DEAD)) ** 2 / m;
  return [fx * k, -fy * k]; // pads report y down
}

export class GamepadMapper {
  private prev: boolean[] = [];
  private liftHeld = false;
  private readonly picksHeld: [boolean, boolean] = [false, false];

  constructor(private loadout: readonly [AdvancedAbilityId, AdvancedAbilityId]) {}

  setLoadout(loadout: readonly [AdvancedAbilityId, AdvancedAbilityId]): void {
    this.loadout = loadout;
  }

  update(pad: PadState, handsOn = false): PadFrame {
    const edges: PadEdge[] = [];
    const down = (i: number) => pad.buttons[i]?.pressed === true;
    const value = (i: number) => {
      const b = pad.buttons[i];
      return b ? (Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0) : 0;
    };
    const pressed = (i: number) => down(i) && !this.prev[i];
    // Hands-on, RT is the hand's grip and no longer fires PULSE.
    if (pressed(B.A) || (!handsOn && pressed(B.RT))) edges.push({ action: 'pulse', phase: 'tap' });
    if (pressed(B.B)) edges.push({ action: 'guard', phase: 'tap' });
    if (pressed(B.X)) edges.push({ action: 'infuse', phase: 'tap', modifier: 0 });
    if (pressed(B.Y)) edges.push({ action: 'infuse', phase: 'tap', modifier: 1 });
    // LIFT on the analog trigger, with hysteresis so a resting finger doesn't chatter.
    const lt = value(B.LT);
    if (!this.liftHeld && lt > 0.5) {
      this.liftHeld = true;
      edges.push({ action: 'lift', phase: 'start' });
    } else if (this.liftHeld && lt < 0.35) {
      this.liftHeld = false;
      edges.push({ action: 'lift', phase: 'end' });
    }
    ([B.LB, B.RB] as const).forEach((btn, i) => {
      const ability: AbilityId = this.loadout[i]!;
      if (DEFAULT_ABILITIES[ability].kind === 'hold') {
        if (down(btn) && !this.picksHeld[i]) {
          this.picksHeld[i] = true;
          edges.push({ action: ability, phase: 'start' });
        } else if (!down(btn) && this.picksHeld[i]) {
          this.picksHeld[i] = false;
          edges.push({ action: ability, phase: 'end' });
        }
      } else if (pressed(btn)) edges.push({ action: ability, phase: 'tap' });
    });
    if (pressed(B.UP)) edges.push({ action: 'sweep-screen', x: 0, y: 1 });
    if (pressed(B.DOWN)) edges.push({ action: 'sweep-screen', x: 0, y: -1 });
    if (pressed(B.LEFT)) edges.push({ action: 'sweep-screen', x: -1, y: 0 });
    if (pressed(B.RIGHT)) edges.push({ action: 'sweep-screen', x: 1, y: 0 });
    const menu = pressed(B.START);
    this.prev = pad.buttons.map((b) => b.pressed);
    const [lx, ly] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    const [rx, ry] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    if (handsOn) {
      const rt = Math.min(1, Math.max(0, value(B.RT)));
      const grip = rt <= TRIGGER_REST ? 0 : (rt - TRIGGER_REST) / (1 - TRIGGER_REST);
      return { move: [lx, ly], edges, menu, hand: { grip, push: ry, twist: rx } };
    }
    return { move: [lx + rx * 0.4, ly + ry * 0.4], edges, menu, hand: null };
  }

  /**
   * Ends whatever the pad was holding (pause, mode change). Button states are kept, so a button
   * still held when play resumes does not fire again.
   */
  release(): PadEdge[] {
    const out: PadEdge[] = [];
    if (this.liftHeld) out.push({ action: 'lift', phase: 'end' });
    this.picksHeld.forEach((h, i) => {
      if (h) out.push({ action: this.loadout[i]!, phase: 'end' });
    });
    this.liftHeld = false;
    this.picksHeld[0] = this.picksHeld[1] = false;
    return out;
  }

  /** A different pad (or none): forget the old one's button states too. */
  reset(): PadEdge[] {
    const out = this.release();
    this.prev = [];
    return out;
  }
}

/** Only the W3C "standard" layout is mapped: other devices' axes and buttons mean anything. */
const usable = (p: Gamepad | null | undefined): p is Gamepad =>
  !!p && p.connected && p.mapping === 'standard';

/** What the UI shows: the active controller and the last connect / disconnect notice. */
export const useGamepad = create<{
  readonly connected: string | null;
  readonly notice: { readonly text: string; readonly at: number } | null;
}>(() => ({ connected: null, notice: null }));

type PadSource = () => readonly (Gamepad | null)[];

/** Feeds one seat from the first active controller; tolerant of connect/disconnect at any time. */
export class GamepadController {
  private readonly mapper: GamepadMapper;
  private index: number | null = null;
  private paused = false;
  private lastTick = 0;

  constructor(
    private readonly seat: SeatInput,
    private readonly pads: PadSource = () => navigator.getGamepads?.() ?? [],
  ) {
    this.mapper = new GamepadMapper(seat.loadout);
    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);
  }

  private onConnect = (e: GamepadEvent): void => {
    if (!usable(e.gamepad)) {
      // A pedal, a flight stick or an unmapped pad: its resting axes could steer by themselves.
      useGamepad.setState({
        notice: {
          text: 'This controller’s layout isn’t supported — other controls still work',
          at: Date.now(),
        },
      });
      return;
    }
    this.index ??= e.gamepad.index;
    useGamepad.setState({
      connected: e.gamepad.id,
      notice: { text: 'Controller connected', at: Date.now() },
    });
  };

  private onDisconnect = (e: GamepadEvent): void => {
    if (e.gamepad.index !== this.index) return;
    this.index = null;
    this.apply(this.mapper.reset(), performance.now());
    this.seat.setHand(null, 'gamepad'); // a pad that is gone holds nothing
    useGamepad.setState({
      connected: null,
      notice: { text: 'Controller disconnected — other controls still work', at: Date.now() },
    });
  };

  private apply(edges: readonly PadEdge[], now: number): void {
    for (const e of edges) {
      if (e.action === 'sweep-screen') {
        const { right, up } = view.groundAxes();
        this.seat.edge(
          {
            action: 'sweep',
            phase: 'tap',
            modifier: e.y !== 0 ? (e.y > 0 ? 1 : -1) : e.x < 0 ? 1 : -1,
            dir: [right.x * e.x + up.x * e.y, right.z * e.x + up.z * e.y],
          },
          now,
          'gamepad',
        );
      } else this.seat.edge(e, now, 'gamepad');
    }
  }

  tick(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastTick || now)) / 1000));
    this.lastTick = now;
    const list = this.pads();
    let pad = this.index !== null ? (list[this.index] ?? null) : null;
    if (!usable(pad)) {
      // Chrome reveals pads only after a button press; adopt the first usable one that shows up.
      const found = list.find(usable) ?? null;
      if ((found?.index ?? null) !== this.index) this.mapper.reset();
      pad = found;
      this.index = found?.index ?? null;
    }
    if (!pad) return;
    this.mapper.setLoadout(this.seat.loadout);
    const frame = this.mapper.update(pad, this.seat.handsOn);
    // Start opens and closes the menu even while paused (a controller-only player must be able
    // to resume); nothing else acts until play resumes.
    if (frame.menu) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    if (this.paused) return;
    if (frame.move[0] !== 0 || frame.move[1] !== 0) {
      const { right, up } = view.groundAxes();
      const step = DEFAULT_RULES.manipulator.maxSpeed * dt;
      const [sx, sy] = frame.move;
      this.seat.setReticle(
        this.seat.reticle.x + (right.x * sx + up.x * sy) * step,
        this.seat.reticle.z + (right.z * sx + up.z * sy) * step,
      );
      this.seat.claim('gamepad', now);
    }
    const hand = frame.hand;
    if (hand) {
      // A squeezed trigger or a deflected right stick takes the seat over, as the sticks do.
      if (hand.grip > 0.5 || hand.push !== 0 || hand.twist !== 0) this.seat.claim('gamepad', now);
      this.seat.setHand(hand, 'gamepad');
    }
    // Buttons tag their own intents; only the sticks take over the aim.
    if (frame.edges.length > 0) this.apply(frame.edges, now);
  }

  pause(): void {
    this.paused = true;
    this.apply(this.mapper.release(), performance.now());
    this.seat.setHand(null, 'gamepad');
  }

  resume(): void {
    this.paused = false;
  }

  dispose(): void {
    this.apply(this.mapper.reset(), performance.now());
    this.seat.setHand(null, 'gamepad');
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
  }
}
