import type { AbilityId } from '@ff/game-data';
import type { ActionIntent, InputSource, IntentPhase, PlayerSlot, Vec2 } from '@ff/protocol';

/**
 * Every physical input method (camera, touch, motion+touch, keyboard, gamepad, bot) implements
 * InputController and produces the same normalized, bounded ActionIntent. Gameplay effectiveness
 * never depends on the modality: the authority clamps intensity and enforces identical costs.
 */
export interface InputController {
  readonly source: InputSource;
  readonly slot: PlayerSlot;
  /** Attach listeners / start sensors. Must be idempotent. */
  enable(): void;
  /** Recentre / calibrate (gyro neutral pose, camera range). No-op where meaningless. */
  calibrate(): void;
  /** Current desired manipulator target, normalized arena coordinates in [-1, 1]². */
  getAim(): Vec2;
  /** Suspend all action output (tab hidden, permission revoked); held actions are released. */
  pause(): void;
  resume(): void;
  /** Remove every listener and release held actions. */
  dispose(): void;
}

/** A discrete edge produced by an adapter, before sequencing. */
export interface ActionEdge {
  readonly action: AbilityId;
  readonly phase: IntentPhase;
  readonly intensity?: number;
  readonly modifier?: number;
  readonly dir?: Vec2;
}

/** Sink that receives fully formed intents for transmission to the authority. */
export type IntentSink = (slot: PlayerSlot, intent: ActionIntent) => void;

/** Maps an arena-plane world point (metres) to normalized aim. Provided by the renderer. */
export interface AimSpace {
  readonly halfLength: number;
  readonly halfWidth: number;
}
