import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type { GameClient } from '../game/client';
import type { RenderFrame } from '../game/snapshot-buffer';

const ClientContext = createContext<GameClient | null>(null);
const FrameContext = createContext<RefObject<RenderFrame | null> | null>(null);

export function GameClientProvider({
  client,
  children,
}: {
  client: GameClient;
  children: ReactNode;
}) {
  const frameRef = useRef<RenderFrame | null>(null);
  return (
    <ClientContext.Provider value={client}>
      <FrameContext.Provider value={frameRef}>{children}</FrameContext.Provider>
    </ClientContext.Provider>
  );
}

export function useGameClient(): GameClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error('GameClientProvider missing');
  return c;
}

export function useRenderFrame(): RefObject<RenderFrame | null> {
  const f = useContext(FrameContext);
  if (!f) throw new Error('GameClientProvider missing');
  return f;
}

/** Samples the interpolated authoritative frame once per rendered frame, before other updates. */
export function FrameDriver() {
  const client = useGameClient();
  const frame = useRenderFrame();
  useFrame(() => {
    frame.current = client.sample(performance.now());
  }, -2);
  return null;
}
