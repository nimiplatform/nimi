import { useEffect, useSyncExternalStore } from 'react';
import {
  RuntimeHealthCoordinator,
  type RuntimeHealthCoordinatorState,
  type RuntimeStreamCallOptions,
} from '@nimiplatform/sdk/runtime';
import { getPlatformClient } from '@nimiplatform/sdk';

const HEALTH_METADATA = {
  callerKind: 'desktop-core' as const,
  callerId: 'runtime-health-coordinator',
  surfaceId: 'runtime.health',
};

const HEALTH_CALL_OPTIONS = {
  timeoutMs: 5000,
  metadata: HEALTH_METADATA,
};

const HEALTH_STREAM_OPTIONS: RuntimeStreamCallOptions = {
  metadata: HEALTH_METADATA,
};

function runtimeAdmin() {
  return getPlatformClient().domains.runtimeAdmin;
}

const runtimeHealthCoordinator = new RuntimeHealthCoordinator({
  fetchRuntimeHealth: async () => runtimeAdmin().getRuntimeHealth({}, HEALTH_CALL_OPTIONS),
  fetchProviderHealth: async () => runtimeAdmin().listAIProviderHealth({}, HEALTH_CALL_OPTIONS),
  subscribeRuntimeHealth: async () => runtimeAdmin().healthEvents({}, HEALTH_STREAM_OPTIONS),
  subscribeProviderHealth: async () => runtimeAdmin().providerHealthEvents({}, HEALTH_STREAM_OPTIONS),
  subscribeRuntimeConnected: (listener) => getPlatformClient().runtime.events.on('runtime.connected', listener),
  subscribeRuntimeDisconnected: (listener) => getPlatformClient().runtime.events.on('runtime.disconnected', listener),
  setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
  clearInterval: (handle) => window.clearInterval(handle as number),
});

export { RuntimeHealthCoordinator };
export type { RuntimeHealthCoordinatorState };

export function getRuntimeHealthCoordinator(): RuntimeHealthCoordinator {
  return runtimeHealthCoordinator;
}

export function useRuntimeHealthCoordinatorBootstrap(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const coordinator = getRuntimeHealthCoordinator();
    coordinator.start();
    return () => {
      coordinator.stop();
    };
  }, [enabled]);
}

export function useRuntimeHealthCoordinatorState(): RuntimeHealthCoordinatorState {
  const coordinator = getRuntimeHealthCoordinator();
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
}
