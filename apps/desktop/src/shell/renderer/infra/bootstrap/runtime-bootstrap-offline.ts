import type { OfflineCoordinator, OfflineTier } from '@runtime/offline';

export type OfflineCoordinatorBindingsInput = {
  coordinator: OfflineCoordinator;
  setOfflineTier: (tier: OfflineTier) => void;
  suspendRuntimeCallbacksForL2: () => void;
  probeRealmReachability: () => Promise<boolean>;
  probeRuntimeReachability: () => Promise<boolean>;
  hasPendingRealmRecoveryWork: () => Promise<boolean>;
  flushChatOutbox: () => Promise<void>;
  flushSocialOutbox: () => Promise<void>;
  invalidateQueries: () => Promise<unknown>;
  rebootstrapRuntime: () => Promise<void>;
};

export function attachOfflineCoordinatorBindings(input: OfflineCoordinatorBindingsInput): () => void {
  input.setOfflineTier(input.coordinator.getTier());
  input.coordinator.configureReconnectHandlers({
    probeRealmReachability: input.probeRealmReachability,
    probeRuntimeReachability: input.probeRuntimeReachability,
    hasPendingRealmRecoveryWork: input.hasPendingRealmRecoveryWork,
  });
  const unsubscribeTier = input.coordinator.subscribeTier((change) => {
    input.setOfflineTier(change.to);
    if (change.to === 'L2') {
      input.suspendRuntimeCallbacksForL2();
    }
  });
  const unsubscribeRealmReconnect = input.coordinator.subscribeRealmReconnect(async () => {
    await Promise.allSettled([
      input.flushChatOutbox(),
      input.flushSocialOutbox(),
    ]);
    await input.invalidateQueries();
  });
  const unsubscribeRuntimeReconnect = input.coordinator.subscribeRuntimeReconnect(async () => {
    await input.rebootstrapRuntime();
  });

  return () => {
    unsubscribeTier();
    unsubscribeRealmReconnect();
    unsubscribeRuntimeReconnect();
  };
}
