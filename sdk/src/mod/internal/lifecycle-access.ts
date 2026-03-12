import { getModSdkHost } from '../host.js';
import type { ModLifecycleState } from './host-types.js';

export function subscribeModLifecycle(
  tabId: string,
  handler: (state: ModLifecycleState) => void,
): () => void {
  return getModSdkHost().lifecycle.subscribe(tabId, handler);
}

export function getModLifecycleState(tabId: string): ModLifecycleState {
  return getModSdkHost().lifecycle.getState(tabId);
}
