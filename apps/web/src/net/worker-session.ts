import { DEFAULT_RULES, type AbilityId } from '@ff/game-data';
import type { ActionIntent, InputSource, PlayerSlot } from '@ff/protocol';
import type { BotDifficulty } from '@ff/sim';
import type { SeatLoadouts, SessionCallbacks, SessionDriver } from './session';
import type { FromSimWorker, ToSimWorker } from './sim-protocol';

export interface WorkerSessionOptions {
  readonly localSlots: readonly PlayerSlot[];
  readonly bots?: readonly { readonly slot: PlayerSlot; readonly difficulty: BotDifficulty }[];
  readonly seed?: number;
  readonly autoStart?: boolean;
  readonly fast?: boolean;
  readonly loadouts?: readonly [readonly AbilityId[], readonly AbilityId[]];
}

/**
 * Local play with the authority in a dedicated Web Worker (same GameWorld as the server). Keeps
 * physics at a steady 30 Hz even when rendering is slow, and keeps the render thread free.
 */
export class WorkerSession implements SessionDriver {
  readonly kind = 'local' as const;
  readonly tickRate = DEFAULT_RULES.match.tickRate;
  readonly localSlots: readonly PlayerSlot[];
  private worker: Worker | null = null;
  private readonly seed: number;
  stepMs = 0;

  constructor(
    private readonly cb: SessionCallbacks,
    private readonly opts: WorkerSessionOptions,
  ) {
    this.localSlots = opts.localSlots;
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  }

  start(): Promise<void> {
    this.cb.onStatus({ state: 'connecting', kind: 'local', detail: 'starting local authority' });
    const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
      type: 'module',
      name: 'ff-local-authority',
    });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      worker.onmessage = (ev: MessageEvent<FromSimWorker>) => {
        const msg = ev.data;
        switch (msg.type) {
          case 'ready':
            this.cb.onStatus({
              state: 'connected',
              kind: 'local',
              detail: `seed ${msg.seed} · rapier ${msg.rapier}`,
            });
            this.cb.onWelcome?.({
              slot: this.localSlots[0] ?? 0,
              roomCode: 'LOCAL',
              tickRate: this.tickRate,
              snapshotRate: this.tickRate,
            });
            resolve();
            break;
          case 'frame': {
            this.stepMs = msg.stepMs;
            const now = performance.now();
            for (const a of msg.acks) this.cb.onAck(a.slot, a.result);
            if (msg.events.length > 0) this.cb.onEvents(msg.events);
            this.cb.onSnapshot(msg.snapshot, now);
            break;
          }
          case 'matchEnd':
            this.cb.onMatchEnd?.(msg.end);
            break;
          case 'error':
            this.cb.onStatus({ state: 'error', kind: 'local', detail: msg.message });
            reject(new Error(msg.message));
            break;
        }
      };
      worker.onerror = (e) => {
        this.cb.onStatus({ state: 'error', kind: 'local', detail: e.message });
        reject(new Error(e.message));
      };
      this.post({
        type: 'init',
        seed: this.seed,
        autoStart: this.opts.autoStart ?? false,
        bots: this.opts.bots ?? [],
        ...(this.opts.fast ? { fast: true } : {}),
        ...(this.opts.loadouts ? { loadouts: this.opts.loadouts } : {}),
      });
    });
  }

  private post(msg: ToSimWorker): void {
    this.worker?.postMessage(msg);
  }

  sendIntent(slot: PlayerSlot, intent: ActionIntent): void {
    if (!this.localSlots.includes(slot)) return;
    this.post({ type: 'intent', slot, intent });
  }

  setReady(ready: boolean, _inputMode: InputSource, loadouts?: SeatLoadouts): void {
    if (!ready) return;
    const picks = this.localSlots.flatMap((slot) => {
      const l = loadouts?.[slot];
      return l ? [{ slot, picks: [...l] }] : [];
    });
    this.post({
      type: 'ready',
      slots: this.localSlots,
      ...(picks.length ? { loadouts: picks } : {}),
    });
  }

  requestRematch(): void {
    this.post({ type: 'rematch', slots: this.localSlots });
  }

  setPaused(paused: boolean): void {
    this.post({ type: 'pause', paused });
  }

  dispose(): void {
    this.post({ type: 'dispose' });
    this.worker = null;
    this.cb.onStatus({ state: 'closed', kind: 'local' });
  }
}
