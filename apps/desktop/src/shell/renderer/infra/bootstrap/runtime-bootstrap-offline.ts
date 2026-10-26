import type { OfflineCoordinator, OfflineTier } from '@nimiplatform/kit/core/offline-coordinator';

export type OfflineCoordinatorBindingsInput = {
  coordinator: OfflineCoordinator;
  setOfflineTier: (tier: OfflineTier) => void;
  suspendRuntimeCallbacksForL2: () => void;
  probeRealmReachability: () => Promise<boolean>;
  probeRuntimeReachability: () => Promise<boolean>;
  hasPendingRealmRecoveryWork: () => Promise<boolean>;
  invalidateRealmQueries: () => Promise<unknown>;
  refreshAccountProfile: () => Promise<void>;
  rebootstrapRuntime: () => Promise<void>;
};

export function attachOfflineCoordinatorBindings(input: OfflineCoordinatorBindingsInput): () => void {
  let active = true;
  const probeWhileActive = async (probe: () => Promise<boolean>) => {
    if (!active) return false;
    const reachable = await probe();
    return active && reachable;
  };
  input.setOfflineTier(input.coordinator.getTier());
  input.coordinator.configureReconnectHandlers({
    probeRealmReachability: () => probeWhileActive(input.probeRealmReachability),
    probeRuntimeReachability: () => probeWhileActive(input.probeRuntimeReachability),
    recoverRuntimeReachability: async () => {
      if (!active) throw new Error('Runtime bootstrap binding is no longer current.');
      await input.rebootstrapRuntime();
      if (!active) throw new Error('Runtime bootstrap binding is no longer current.');
    },
    hasPendingRealmRecoveryWork: () => probeWhileActive(input.hasPendingRealmRecoveryWork),
  });
  const unsubscribeTier = input.coordinator.subscribeTier((change) => {
    input.setOfflineTier(change.to);
    if (change.to === 'L2') {
      input.suspendRuntimeCallbacksForL2();
    }
  });
  const unsubscribeRealmReconnect = input.coordinator.subscribeRealmReconnect(async () => {
    if (!active) return;
    await Promise.all([input.invalidateRealmQueries(), input.refreshAccountProfile()]);
  });

  return () => {
    active = false;
    unsubscribeTier();
    unsubscribeRealmReconnect();
  };
}
