import type { AgentLocalThreadBundle } from '../../bridge/runtime-bridge/types';

export function createAgentVisibleProjectionStore() {
  const projectionsByThreadId = new Map<string, AgentLocalThreadBundle>();
  const listenersByThreadId = new Map<string, Set<() => void>>();
  let disposed = false;

  function requireActive(): void {
    if (disposed) throw new Error('AGENT_VISIBLE_PROJECTION_STORE_DISPOSED');
  }

  function emit(threadId: string): void {
    const listeners = listenersByThreadId.get(threadId);
    if (!listeners) return;
    for (const listener of listeners) listener();
  }

  return Object.freeze({
    get(threadId: string): AgentLocalThreadBundle | null {
      requireActive();
      return projectionsByThreadId.get(threadId) || null;
    },
    set(threadId: string, bundle: AgentLocalThreadBundle | null): void {
      requireActive();
      if (bundle) projectionsByThreadId.set(threadId, bundle);
      else projectionsByThreadId.delete(threadId);
      emit(threadId);
    },
    subscribe(threadId: string, listener: () => void): () => void {
      requireActive();
      const listeners = listenersByThreadId.get(threadId) || new Set<() => void>();
      listeners.add(listener);
      listenersByThreadId.set(threadId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByThreadId.delete(threadId);
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      projectionsByThreadId.clear();
      listenersByThreadId.clear();
    },
  });
}

export type AgentVisibleProjectionStore = ReturnType<typeof createAgentVisibleProjectionStore>;
