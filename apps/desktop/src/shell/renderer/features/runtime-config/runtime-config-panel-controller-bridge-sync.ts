import { useCallback, useEffect, useRef, useState } from 'react';
import { desktopBridge } from '@renderer/bridge';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import {
  applyRuntimeBridgeConfigToState,
  buildRuntimeBridgeConfigFromLocalEndpoint,
} from './runtime-bridge-config';
import { replaceConnectorsInState } from './runtime-config-connector-actions';
import { sdkListConnectors } from './runtime-config-connector-sdk-service';
import { asRecord, type SetRuntimeConfigBanner } from './runtime-config-panel-controller-utils';

const RUNTIME_BRIDGE_CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

type UseRuntimeConfigBridgeSyncInput = {
  hydrated: boolean;
  setState: (updater: (previous: RuntimeConfigStateV11 | null) => RuntimeConfigStateV11 | null) => void;
  setStatusBanner: SetRuntimeConfigBanner;
};

export type RuntimeConfigBridgeSyncController = {
  saveRuntimeLocalEndpoint: (endpoint: string) => Promise<{ restartRequired: boolean }>;
};

export function useRuntimeConfigBridgeSync(input: UseRuntimeConfigBridgeSyncInput): RuntimeConfigBridgeSyncController {
  const { hydrated, setState, setStatusBanner } = input;

  const runtimeBridgeConfigRef = useRef<JsonObject>({});
  const runtimeBridgeLoadStartedRef = useRef(false);
  const [bridgeRetryCount, setBridgeRetryCount] = useState(0);
  const runtimeBridgeReadSucceededRef = useRef(false);
  const runtimeBridgeRestartHintShownRef = useRef(false);

  const applyBridgeConfigProjection = useCallback((config: JsonObject) => {
    runtimeBridgeConfigRef.current = config;
    runtimeBridgeReadSucceededRef.current = true;
    setState((previous) => {
      if (!previous) return previous;
      return applyRuntimeBridgeConfigToState(previous, runtimeBridgeConfigRef.current);
    });
  }, [setState]);

  useEffect(() => {
    if (!hydrated || runtimeBridgeLoadStartedRef.current) return;
    runtimeBridgeLoadStartedRef.current = true;

    if (!desktopBridge.hasTauriInvoke()) {
      return;
    }

    let cancelled = false;
    const loadBridgeConfig = async () => {
      try {
        const [bridgeResult, connectorResult] = await Promise.allSettled([
          desktopBridge.getRuntimeBridgeConfig(),
          sdkListConnectors(),
        ]);

        if (cancelled) return;

        if (bridgeResult.status === 'rejected') {
          throw bridgeResult.reason;
        }

        applyBridgeConfigProjection(asRecord(bridgeResult.value.config));

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
  }, [applyBridgeConfigProjection, hydrated, setState, setStatusBanner, bridgeRetryCount]);

  const saveRuntimeLocalEndpoint = useCallback(async (endpoint: string): Promise<{ restartRequired: boolean }> => {
    if (!desktopBridge.hasTauriInvoke()) {
      throw new Error('Runtime local endpoint config requires desktop runtime');
    }
    let baseConfig = runtimeBridgeConfigRef.current;
    if (!runtimeBridgeReadSucceededRef.current) {
      const current = await desktopBridge.getRuntimeBridgeConfig();
      baseConfig = asRecord(current.config);
      runtimeBridgeReadSucceededRef.current = true;
      runtimeBridgeConfigRef.current = baseConfig;
    }

    const nextConfig = buildRuntimeBridgeConfigFromLocalEndpoint(endpoint, baseConfig);
    const result = await desktopBridge.setRuntimeBridgeConfig(JSON.stringify(nextConfig));
    const resultConfig = asRecord(result.config);
    applyBridgeConfigProjection(resultConfig);

    const restartRequired = result.reasonCode === RUNTIME_BRIDGE_CONFIG_RESTART_REQUIRED;
    if (restartRequired && !runtimeBridgeRestartHintShownRef.current) {
      runtimeBridgeRestartHintShownRef.current = true;
      const hint = String(result.actionHint || '').trim();
      setStatusBanner({
        kind: 'info',
        message: hint || 'Runtime config saved. Restart runtime to apply changes.',
      });
    }
    return { restartRequired };
  }, [applyBridgeConfigProjection, setStatusBanner]);

  return {
    saveRuntimeLocalEndpoint,
  };
}
