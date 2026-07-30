import { useSyncExternalStore } from 'react';
import type { AgentCenterSession } from './types.js';

export function useAgentCenterStore(session: AgentCenterSession) {
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { snapshot, refresh: session.refresh };
}
