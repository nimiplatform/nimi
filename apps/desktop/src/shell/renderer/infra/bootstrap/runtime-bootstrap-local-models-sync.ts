import type {
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
} from '@renderer/bridge';
import { createRuntimeConfigManualRestartRequiredError } from './runtime-bootstrap-config-errors';

const CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

export type RuntimeLocalModelsConfigSyncBridge = {
  getRuntimeBridgeConfig: () => Promise<RuntimeBridgeConfigGetResult>;
  setRuntimeBridgeConfig: (configJson: string) => Promise<RuntimeBridgeConfigSetResult>;
  restartRuntimeBridge: () => Promise<RuntimeBridgeDaemonStatus>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalize(value: unknown): string {
  return String(value || '').trim();
}

export function mergeRuntimeLocalModelsConfig(
  baseConfig: Record<string, unknown>,
  localModelsPath: string,
): { nextConfig: Record<string, unknown>; changed: boolean } {
  const currentConfig = asRecord(baseConfig);
  const currentLocalModelsPath = normalize(currentConfig.localModelsPath);
  const nextLocalModelsPath = normalize(localModelsPath);

  if (!nextLocalModelsPath || currentLocalModelsPath === nextLocalModelsPath) {
    return {
      nextConfig: currentConfig,
      changed: false,
    };
  }

  return {
    nextConfig: {
      ...currentConfig,
      localModelsPath: nextLocalModelsPath,
    },
    changed: true,
  };
}

export async function syncRuntimeLocalModelsConfig(input: {
  daemonStatus: RuntimeBridgeDaemonStatus;
  localModelsPath: string;
  bridge: RuntimeLocalModelsConfigSyncBridge;
}): Promise<RuntimeBridgeDaemonStatus> {
  const { daemonStatus, localModelsPath, bridge } = input;

  const current = await bridge.getRuntimeBridgeConfig();
  const { nextConfig, changed } = mergeRuntimeLocalModelsConfig(current.config, localModelsPath);
  if (!changed) {
    return daemonStatus;
  }

  const setResult = await bridge.setRuntimeBridgeConfig(JSON.stringify(nextConfig));
  if (setResult.reasonCode !== CONFIG_RESTART_REQUIRED) {
    return daemonStatus;
  }

  if (!daemonStatus.running) {
    return daemonStatus;
  }

  if (!daemonStatus.managed) {
    const hint = String(setResult.actionHint || '').trim();
    throw createRuntimeConfigManualRestartRequiredError(
      hint
      || 'Runtime local models path updated and requires restart. Please restart external runtime manually.',
    );
  }

  return bridge.restartRuntimeBridge();
}
