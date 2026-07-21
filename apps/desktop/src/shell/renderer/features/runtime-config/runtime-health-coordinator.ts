import { useEffect, useSyncExternalStore } from 'react';
import {
  NimiRuntimeHealthCoordinator,
  type NimiRuntimeHealthCoordinatorState,
  type Runtime,
} from '@nimiplatform/sdk/runtime';
import { type RuntimeTypedCallOptions } from '@nimiplatform/sdk/runtime/generated';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port';

const HEALTH_METADATA = { surfaceId: 'runtime.health' };
const HEALTH_CALL_OPTIONS = { timeoutMs: 5000, metadata: HEALTH_METADATA };
const HEALTH_STREAM_OPTIONS: RuntimeTypedCallOptions = { metadata: HEALTH_METADATA };

type RuntimeHealthTimerPort = {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
};

export function createRuntimeHealthCoordinator(
  getAudit: () => Runtime['audit'],
  timers: RuntimeHealthTimerPort,
): NimiRuntimeHealthCoordinator {
  return new NimiRuntimeHealthCoordinator({
    fetchRuntimeHealth: async () => getAudit().getRuntimeHealth({}, HEALTH_CALL_OPTIONS),
    fetchProviderHealth: async () => getAudit().listAIProviderHealth({}, HEALTH_CALL_OPTIONS),
    subscribeRuntimeHealth: async () => getAudit().subscribeRuntimeHealthEvents({}, HEALTH_STREAM_OPTIONS),
    subscribeProviderHealth: async () => getAudit().subscribeAIProviderHealthEvents({}, HEALTH_STREAM_OPTIONS),
    subscribeRuntimeConnected: () => () => {},
    subscribeRuntimeDisconnected: () => () => {},
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });
}

export { NimiRuntimeHealthCoordinator };
export type { NimiRuntimeHealthCoordinatorState };

export function connectRuntimeHealthCoordinator(
  coordinator: NimiRuntimeHealthCoordinator,
  lifecycle: Pick<DesktopRendererLifecyclePort, 'bootstrap' | 'subscribeBootstrap'>,
  enabled: boolean,
): () => void {
  if (!enabled) return () => {};
  let running = false;
  const sync = () => {
    const shouldRun = lifecycle.bootstrap().bootstrapReady;
    if (shouldRun === running) return;
    running = shouldRun;
    if (running) coordinator.start();
    else coordinator.stop();
  };
  const unsubscribe = lifecycle.subscribeBootstrap(sync);
  sync();
  return () => {
    unsubscribe();
    if (running) coordinator.stop();
  };
}

export function useRuntimeHealthCoordinatorBootstrap(enabled: boolean): void {
  const coordinator = useDesktopRendererSdk().runtimeHealthCoordinator();
  useEffect(() => {
    if (!enabled) return;
    coordinator.start();
    return () => coordinator.stop();
  }, [coordinator, enabled]);
}

export function useRuntimeHealthCoordinatorState(): NimiRuntimeHealthCoordinatorState {
  const coordinator = useDesktopRendererSdk().runtimeHealthCoordinator();
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
}
