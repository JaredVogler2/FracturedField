import type { AbilityId } from '@ff/game-data';
import type {
  ActionIntent,
  ActionResult,
  GameEvent,
  MatchEndMessage,
  PlayerSlot,
  WorldSnapshot,
} from '@ff/protocol';
import type { BotDifficulty } from '@ff/sim';

/** Messages from the main thread to the local authority worker. */
export type ToSimWorker =
  | {
      readonly type: 'init';
      readonly seed: number;
      readonly autoStart: boolean;
      readonly bots: readonly { readonly slot: PlayerSlot; readonly difficulty: BotDifficulty }[];
      /** Optional rule overrides (fast test rounds). Local play only. */
      readonly fast?: boolean;
      /**
       * Test runs only: wall-clock speed of the simulation (0.25–1). Rules, physics and every
       * tick are unchanged; only the time between ticks grows.
       */
      readonly timeScale?: number;
      /** Advanced-move picks per seat. */
      readonly loadouts?: readonly [readonly AbilityId[], readonly AbilityId[]];
      /** The Hands Lab sandbox: lab rules; the empty second seat counts as ready. */
      readonly lab?: boolean;
    }
  | {
      /** Hands Lab only: set up a task (the core, and a boulder moved into place). */
      readonly type: 'labPlace';
      readonly core: readonly [number, number];
      readonly boulder?: {
        readonly from: readonly [number, number];
        readonly to: readonly [number, number];
      };
    }
  | { readonly type: 'intent'; readonly slot: PlayerSlot; readonly intent: ActionIntent }
  | {
      readonly type: 'ready';
      readonly slots: readonly PlayerSlot[];
      /** Advanced-move picks per readied seat (applied before the match starts). */
      readonly loadouts?: readonly {
        readonly slot: PlayerSlot;
        readonly picks: readonly AbilityId[];
      }[];
    }
  | { readonly type: 'rematch'; readonly slots: readonly PlayerSlot[] }
  | { readonly type: 'pause'; readonly paused: boolean }
  | { readonly type: 'dispose' };

/** Messages from the local authority worker to the main thread. */
export type FromSimWorker =
  | { readonly type: 'ready'; readonly seed: number; readonly rapier: string }
  | {
      readonly type: 'frame';
      readonly snapshot: WorldSnapshot;
      readonly events: readonly GameEvent[];
      readonly acks: readonly { slot: PlayerSlot; result: ActionResult }[];
      readonly stepMs: number;
    }
  | { readonly type: 'matchEnd'; readonly end: MatchEndMessage }
  | { readonly type: 'error'; readonly message: string };
