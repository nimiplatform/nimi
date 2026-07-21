import { createContext, useContext, useSyncExternalStore, type PropsWithChildren } from 'react';
import type { AgentLocalThreadBundle } from '../../bridge/runtime-bridge/types.js';
import type { AgentVisibleProjectionStore } from './chat-agent-visible-projection-store.js';

const AgentVisibleProjectionContext = createContext<AgentVisibleProjectionStore | null>(null);

export function AgentVisibleProjectionProvider(
  props: PropsWithChildren<{ readonly store: AgentVisibleProjectionStore }>,
) {
  return (
    <AgentVisibleProjectionContext.Provider value={props.store}>
      {props.children}
    </AgentVisibleProjectionContext.Provider>
  );
}

export function useAgentVisibleProjectionStore(): AgentVisibleProjectionStore {
  const store = useContext(AgentVisibleProjectionContext);
  if (!store) throw new Error('AGENT_VISIBLE_PROJECTION_STORE_MISSING');
  return store;
}

export function useAgentVisibleProjection(
  threadId: string | null,
): AgentLocalThreadBundle | null {
  const store = useAgentVisibleProjectionStore();
  return useSyncExternalStore(
    (listener) => (threadId ? store.subscribe(threadId, listener) : () => undefined),
    () => (threadId ? store.get(threadId) : null),
    () => null,
  );
}
