import { useEffect, useRef, useState } from 'react';
import { desktopBridge } from '@renderer/bridge';
import type { JsonObject } from '../../bridge/runtime-bridge/types';
import { getOfflineCoordinator } from '@runtime/offline';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  applyRuntimeBridgeConfigToState,
  buildRuntimeBridgeConfigFromState,
  serializeRuntimeBridgeProjection,
} from './runtime-bridge-config';
import { replaceConnectorsInState } from './runtime-config-connector-actions';
import { asRecord, type SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';

const RUNTIME_BRIDGE_CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

type UseRuntimeConfigBridgeSyncInput = {
  hydrated: boolean;
  state: RuntimeConfigStateV11 | null;
  setState: (updater: (previous: RuntimeConfigStateV11 | null) => RuntimeConfigStateV11 | null) => void;
  setStatusBanner: SetRuntimeConfigBanner;
};

export function useRuntimeConfigBridgeSync(input: UseRuntimeConfigBridgeSyncInput): void {
  const { hydrated, state, setState, setStatusBanner } = input;

  const runtimeBridgeConfigRef = useRef<JsonObject>({});
  const runtimeBridgeProjectionRef = useRef('');
  const runtimeBridgeFailedProjectionRef = useRef('');
  const runtimeBridgeLoadStartedRef = useRef(false);
  const [bridgeRetryCount, setBridgeRetryCount] = useState(0);
  const runtimeBridgeReadSucceededRef = useRef(false);
  const runtimeBridgeRestartHintShownRef = useRef(false);

  useEffect(() => {
    if (!hydrated || runtimeBridgeLoadStartedRef.current) return;
    runtimeBridgeLoadStartedRef.current = true;

    if (!desktopBridge.hasTauriInvoke()) {
      return;
    }

    let cancelled = false;
    const loadBridgeConfig = async () => {
      try {
        const { sdkListConnectors } = await import('./runtime-config-connector-sdk-service');
        const [bridgeResult, connectorResult] = await Promise.allSettled([
          desktopBridge.getRuntimeBridgeConfig(),
          sdkListConnectors(),
        ]);

        if (cancelled) return;

        if (bridgeResult.status === 'rejected') {
          throw bridgeResult.reason;
        }

        runtimeBridgeConfigRef.current = asRecord(bridgeResult.value.config);
        runtimeBridgeReadSucceededRef.current = true;
        setState((previous) => {
          if (!previous) return previous;
          const next = applyRuntimeBridgeConfigToState(previous, runtimeBridgeConfigRef.current);
          runtimeBridgeProjectionRef.current = serializeRuntimeBridgeProjection(next);
          runtimeBridgeFailedProjectionRef.current = '';
          return next;
        });

        if (!cancelled && connectorResult.status === 'fulfilled' && connectorResult.value.length > 0) {
          setState((previous) => {
            if (!previous) return previous;
            return replaceConnectorsInState(previous, connectorResult.value);
          });
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error || 'runtime config bridge load failed');
        setStatusBanner({
          kind: 'warning',
          message: `Runtime config read failed, keep local view: ${message}`,
          actionLabel: 'Retry',
          onAction: () => {
            runtimeBridgeLoadStartedRef.current = false;
            setStatusBanner(null);
            setBridgeRetryCount((c) => c + 1);
          },
        });
      }
    };

    void loadBridgeConfig();
    return () => {
      cancelled = true;
    };
  }, [hydrated, setState, setStatusBanner, bridgeRetryCount]);

  useEffect(() => {
    if (!hydrated || !state) return;
    if (!runtimeBridgeReadSucceededRef.current) return;
    if (!desktopBridge.hasTauriInvoke()) return;

    const nextProjection = serializeRuntimeBridgeProjection(state);
    if (nextProjection === runtimeBridgeProjectionRef.current) return;
    if (nextProjection === runtimeBridgeFailedProjectionRef.current) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const persist = async (currentState: RuntimeConfigStateV11, projection: string) => {
        try {
          const nextConfig = buildRuntimeBridgeConfigFromState(currentState, runtimeBridgeConfigRef.current);
          const result = await desktopBridge.setRuntimeBridgeConfig(JSON.stringify(nextConfig));
          if (cancelled) return;

          runtimeBridgeConfigRef.current = asRecord(result.config);
          runtimeBridgeProjectionRef.current = projection;
          runtimeBridgeFailedProjectionRef.current = '';

          if (
            result.reasonCode === RUNTIME_BRIDGE_CONFIG_RESTART_REQUIRED
            && !runtimeBridgeRestartHintShownRef.current
          ) {
            runtimeBridgeRestartHintShownRef.current = true;
            const hint = String(result.actionHint || '').trim();
            setStatusBanner({
              kind: 'info',
              message: hint || 'Runtime config saved. Restart runtime to apply changes.',
            });
          }
        } catch (error) {
          if (cancelled) return;
          runtimeBridgeFailedProjectionRef.current = projection;
          const message = error instanceof Error ? error.message : String(error || 'runtime config bridge save failed');
          setStatusBanner({
            kind: 'error',
            message: `Runtime config save failed: ${message}`,
          });
        }
      };

      void persist(state, nextProjection);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, state, setStatusBanner]);

  useEffect(() => {
    if (!desktopBridge.hasTauriInvoke()) {
      return undefined;
    }
    const coordinator = getOfflineCoordinator();
    return coordinator.subscribeRuntimeReconnect(() => {
      if (!hydrated || !state || !runtimeBridgeReadSucceededRef.current) {
        return;
      }
      const nextProjection = serializeRuntimeBridgeProjection(state);
      if (!runtimeBridgeFailedProjectionRef.current || runtimeBridgeFailedProjectionRef.current !== nextProjection) {
        return;
      }
      void (async () => {
        try {
          const nextConfig = buildRuntimeBridgeConfigFromState(state, runtimeBridgeConfigRef.current);
          const result = await desktopBridge.setRuntimeBridgeConfig(JSON.stringify(nextConfig));
          runtimeBridgeConfigRef.current = asRecord(result.config);
          runtimeBridgeProjectionRef.current = nextProjection;
          runtimeBridgeFailedProjectionRef.current = '';
        } catch {
          // Keep failed projection intact for the next reconnect edge.
        }
      })();
    });
  }, [hydrated, setStatusBanner, state]);
}
