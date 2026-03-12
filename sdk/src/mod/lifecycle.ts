import { useSyncExternalStore } from 'react';
import type { ModLifecycleState } from './internal/host-types.js';
import { subscribeModLifecycle, getModLifecycleState } from './internal/lifecycle-access.js';

export type { ModLifecycleState };

export function onRouteLifecycleChange(
  tabId: string,
  handler: (state: ModLifecycleState) => void,
): () => void {
  return subscribeModLifecycle(tabId, handler);
}

export function queryRouteLifecycleState(tabId: string): ModLifecycleState {
  return getModLifecycleState(tabId);
}

export function useRouteLifecycleState(tabId: string): ModLifecycleState {
  return useSyncExternalStore(
    (onStoreChange) => subscribeModLifecycle(tabId, onStoreChange),
    () => getModLifecycleState(tabId),
  );
}
