import { create } from 'zustand';
import type { PlayerSlot } from '@ff/protocol';

export interface MatchRecord {
  readonly id: number;
  readonly mode: string;
  readonly winner: PlayerSlot | -1;
  readonly roundWins: readonly [number, number];
  readonly finishedAt: number;
  readonly digest: string;
}

interface HistoryStore {
  records: MatchRecord[];
  add(r: Omit<MatchRecord, 'id' | 'finishedAt'>): void;
}

let nextId = 1;

/** In-memory match outcomes for this session (no accounts or database in this phase). */
export const useHistory = create<HistoryStore>((set) => ({
  records: [],
  add: (r) =>
    set((s) => ({
      records: [{ ...r, id: nextId++, finishedAt: Date.now() }, ...s.records].slice(0, 20),
    })),
}));
