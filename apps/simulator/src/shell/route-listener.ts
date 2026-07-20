/** Shell-owned route-history listener installation through the admitted global-effect scope. */

import type { SimulatorGlobalCoordinator } from './global-coordinator.ts';

export function installSimulatorRouteHistoryListener(options: {
  readonly coordinator: SimulatorGlobalCoordinator;
  readonly onHistory: () => void;
}): () => void {
  const subscribed = options.coordinator.subscribeFamily('route_history', options.onHistory);
  if (!subscribed.ok) throw new Error('SIMULATOR_ROUTE_LISTENER_UNAVAILABLE');
  return subscribed.value;
}
