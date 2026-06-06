import type {
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
} from '@renderer/bridge';
import { mergeNimiRuntimeBridgeRealmJwtConfig } from '@nimiplatform/sdk/runtime';
import { createRuntimeConfigManualRestartRequiredError } from './runtime-bootstrap-config-errors';

const CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

export type RuntimeJwtSyncBridge = {
  getRuntimeBridgeConfig: () => Promise<RuntimeBridgeConfigGetResult>;
  setRuntimeBridgeConfig: (configJson: string) => Promise<RuntimeBridgeConfigSetResult>;
  restartRuntimeBridge: () => Promise<RuntimeBridgeDaemonStatus>;
};

export const mergeRuntimeJwtConfig = mergeNimiRuntimeBridgeRealmJwtConfig;

export async function syncRuntimeJwtConfig(input: {
  daemonStatus: RuntimeBridgeDaemonStatus;
  realmDefaults: RuntimeDefaults['realm'];
  bridge: RuntimeJwtSyncBridge;
}): Promise<RuntimeBridgeDaemonStatus> {
  const { daemonStatus, realmDefaults, bridge } = input;

  const current = await bridge.getRuntimeBridgeConfig();
  const { nextConfig, changed } = mergeRuntimeJwtConfig(current.config, realmDefaults);
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
      || 'Runtime JWT config updated and requires restart. Please restart external runtime manually.',
    );
  }

  return bridge.restartRuntimeBridge();
}
