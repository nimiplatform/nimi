import type {
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
} from '@renderer/bridge';
import { mergeRuntimeBridgeDeveloperRegistrationConfig } from '@nimiplatform/sdk/runtime';
import { createRuntimeConfigManualRestartRequiredError } from './runtime-bootstrap-config-errors';

const CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

export type RuntimeDeveloperRegistrationSyncBridge = {
  getRuntimeBridgeConfig: () => Promise<RuntimeBridgeConfigGetResult>;
  setRuntimeBridgeConfig: (configJson: string) => Promise<RuntimeBridgeConfigSetResult>;
  restartRuntimeBridge: () => Promise<RuntimeBridgeDaemonStatus>;
};

/**
 * Reconcile `auth.developerRegistration.enabled` (runtime K-AUTHSVC-014 gate)
 * with the desktop "local app testing" intent. The desktop control is the
 * discoverable Developer Mode switch (D-DEV-002): Developer Mode on enables the
 * runtime developer-registration gate so a local developer's not-yet-admitted
 * app can register; off restores the production fail-closed default.
 */
export const mergeRuntimeDeveloperRegistrationConfig = mergeRuntimeBridgeDeveloperRegistrationConfig;

export async function syncRuntimeDeveloperRegistrationConfig(input: {
  daemonStatus: RuntimeBridgeDaemonStatus;
  enabled: boolean;
  bridge: RuntimeDeveloperRegistrationSyncBridge;
}): Promise<RuntimeBridgeDaemonStatus> {
  const { daemonStatus, enabled, bridge } = input;

  const current = await bridge.getRuntimeBridgeConfig();
  const { nextConfig, changed } = mergeRuntimeDeveloperRegistrationConfig(current.config, enabled);
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
      || 'Runtime developer-registration config updated and requires restart. Please restart external runtime manually.',
    );
  }

  return bridge.restartRuntimeBridge();
}
