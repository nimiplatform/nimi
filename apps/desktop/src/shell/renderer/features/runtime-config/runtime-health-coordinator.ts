import { useEffect, useSyncExternalStore } from 'react';
import { NimiRuntimeHealthCoordinator, type NimiRuntimeHealthCoordinatorState } from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { getDesktopRuntime } from '../../infra/sdk/desktop-nimi-client-session';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';

const HEALTH_METADATA = {
  surfaceId: 'runtime.health',
};

const HEALTH_CALL_OPTIONS = {
  timeoutMs: 5000,
  metadata: HEALTH_METADATA,
};

const HEALTH_STREAM_OPTIONS: RuntimeTypedCallOptions = {
  metadata: HEALTH_METADATA,
};

function runtimeAudit() {
  return getDesktopRuntime().audit;
}

const runtimeHealthCoordinator = new NimiRuntimeHealthCoordinator({
  fetchRuntimeHealth: async () => runtimeAudit().getRuntimeHealth({}, HEALTH_CALL_OPTIONS),
  fetchProviderHealth: async () => runtimeAudit().listAIProviderHealth({}, HEALTH_CALL_OPTIONS),
  subscribeRuntimeHealth: async () => runtimeAudit().subscribeRuntimeHealthEvents({}, HEALTH_STREAM_OPTIONS),
  subscribeProviderHealth: async () => runtimeAudit().subscribeAIProviderHealthEvents({}, HEALTH_STREAM_OPTIONS),
  subscribeRuntimeConnected: () => () => {},
  subscribeRuntimeDisconnected: () => () => {},
  setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
  clearInterval: (handle) => window.clearInterval(handle as number),
});

export { NimiRuntimeHealthCoordinator };
export type { NimiRuntimeHealthCoordinatorState };

export function getRuntimeHealthCoordinator(): NimiRuntimeHealthCoordinator {
  return runtimeHealthCoordinator;
}

export function connectRuntimeHealthCoordinator(
  lifecycle: Pick<DesktopRendererLifecyclePort, 'bootstrap' | 'subscribeBootstrap'>,
  enabled: boolean,
): () => void {
  if (!enabled) {
    return () => {};
  }
  const coordinator = getRuntimeHealthCoordinator();
  let running = false;
  const sync = () => {
    const shouldRun = lifecycle.bootstrap().bootstrapReady;
    if (shouldRun === running) return;
    running = shouldRun;
    if (running) {
      coordinator.start();
    } else {
      coordinator.stop();
    }
  };
  const unsubscribe = lifecycle.subscribeBootstrap(sync);
  sync();
  return () => {
    unsubscribe();
    if (running) {
      running = false;
      coordinator.stop();
    }
  };
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

export function useRuntimeHealthCoordinatorState(): NimiRuntimeHealthCoordinatorState {
  const coordinator = getRuntimeHealthCoordinator();
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
}
