import { useSyncExternalStore } from 'react';
import type { AgentLocalThreadBundle } from '@renderer/bridge/runtime-bridge/types';

const projectionsByThreadId = new Map<string, AgentLocalThreadBundle>();
const listenersByThreadId = new Map<string, Set<() => void>>();

function emit(threadId: string) {
  const listeners = listenersByThreadId.get(threadId);
  if (!listeners || listeners.size === 0) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Swallow store listener failures to preserve stream continuity.
    }
  }
}

export function getAgentVisibleProjection(threadId: string): AgentLocalThreadBundle | null {
  return projectionsByThreadId.get(threadId) || null;
}

export function setAgentVisibleProjection(
  threadId: string,
  bundle: AgentLocalThreadBundle | null,
): void {
  if (bundle) {
    projectionsByThreadId.set(threadId, bundle);
  } else {
    projectionsByThreadId.delete(threadId);
  }
  emit(threadId);
}

export function subscribeAgentVisibleProjection(
  threadId: string,
  listener: () => void,
): () => void {
  const currentListeners = listenersByThreadId.get(threadId);
  if (currentListeners) {
    currentListeners.add(listener);
  } else {
    listenersByThreadId.set(threadId, new Set([listener]));
  }
  return () => {
    const activeListeners = listenersByThreadId.get(threadId);
    if (!activeListeners) {
      return;
    }
    activeListeners.delete(listener);
    if (activeListeners.size === 0) {
      listenersByThreadId.delete(threadId);
    }
  };
}

export function useAgentVisibleProjection(
  threadId: string | null,
): AgentLocalThreadBundle | null {
  return useSyncExternalStore(
    (listener) => (threadId ? subscribeAgentVisibleProjection(threadId, listener) : () => undefined),
    () => (threadId ? getAgentVisibleProjection(threadId) : null),
    () => null,
  );
}
