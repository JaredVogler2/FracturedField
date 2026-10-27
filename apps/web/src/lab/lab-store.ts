import { useSyncExternalStore } from 'react';
import type { HandsTaskId } from './hands-tasks';

/** The Hands Lab's selected task, shared by the panel (DOM) and the markers (3D scene). */
let current: HandsTaskId | null = null;
const listeners = new Set<() => void>();

export function setLabTask(id: HandsTaskId | null): void {
  if (id === current) return;
  current = id;
  for (const l of listeners) l();
}

export function useLabTask(): HandsTaskId | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
