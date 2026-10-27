import { create } from 'zustand';
import type {
  LobbyMessage,
  MatchEndMessage,
  MatchSnapshot,
  PauseMessage,
  PlayerSnapshot,
} from '@ff/protocol';
import type { TransportStatus } from '../net/session';

/** HUD-facing state, updated at most ~15 Hz (the renderer reads the snapshot buffer directly). */
export interface HudState {
  transport: TransportStatus;
  match: MatchSnapshot | null;
  players: readonly [PlayerSnapshot, PlayerSnapshot] | null;
  lobby: LobbyMessage | null;
  pause: PauseMessage | null;
  matchEnd: MatchEndMessage | null;
  roomCode: string | null;
  mySlot: 0 | 1 | null;
  /** Diagnostics */
  serverTick: number;
  snapshotsPerSecond: number;
  bodies: number;
  setTransport(t: TransportStatus): void;
}

export const useHud = create<HudState>((set) => ({
  transport: { state: 'idle', kind: 'local' },
  match: null,
  players: null,
  lobby: null,
  pause: null,
  matchEnd: null,
  roomCode: null,
  mySlot: null,
  serverTick: 0,
  snapshotsPerSecond: 0,
  bodies: 0,
  setTransport: (transport) => set({ transport }),
}));
