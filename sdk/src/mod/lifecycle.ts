import { useSyncExternalStore } from 'react';
import type { ModLifecycleState } from './internal/host-types.js';
import { getModSdkHost } from './host.js';

export type { ModLifecycleState };

export function onRouteLifecycleChange(
  tabId: string,
  handler: (state: ModLifecycleState) => void,
): () => void {
  return getModSdkHost().lifecycle.subscribe(tabId, handler);
}

export function queryRouteLifecycleState(tabId: string): ModLifecycleState {
  return getModSdkHost().lifecycle.getState(tabId);
}

export function useRouteLifecycleState(tabId: string): ModLifecycleState {
  return useSyncExternalStore(
    (onStoreChange) => getModSdkHost().lifecycle.subscribe(tabId, onStoreChange),
    () => getModSdkHost().lifecycle.getState(tabId),
  );
}
