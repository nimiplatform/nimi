import { desktopBridge } from '@renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { safeBootstrapErrorMessage } from '@nimiplatform/kit/shell/renderer/bootstrap';
import {
  syncRuntimeDeveloperRegistrationConfig,
  type RuntimeDeveloperRegistrationSyncBridge,
} from '@renderer/infra/bootstrap/runtime-bootstrap-developer-registration-sync';
import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge/runtime-bridge/types';

export type DeveloperModeRuntimeSyncBridge = RuntimeDeveloperRegistrationSyncBridge & {
  hasTauriInvoke: () => boolean;
  getRuntimeBridgeStatus: () => Promise<RuntimeBridgeDaemonStatus>;
};

export async function syncDeveloperModeRuntimeGate(input: {
  enabled: boolean;
  flowId: string;
  bridge?: DeveloperModeRuntimeSyncBridge;
}): Promise<RuntimeBridgeDaemonStatus | null> {
  const bridge = input.bridge ?? {
    hasTauriInvoke: () => desktopBridge.hasTauriInvoke(),
    getRuntimeBridgeStatus: () => desktopBridge.getRuntimeBridgeStatus(),
    getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
    setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
    restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
  };

  if (!bridge.hasTauriInvoke()) {
    return null;
  }

  const daemonStatus = await bridge.getRuntimeBridgeStatus();
  const nextStatus = await syncRuntimeDeveloperRegistrationConfig({
    daemonStatus,
    enabled: input.enabled,
    bridge,
  });

  logRendererEvent({
    level: 'info',
    area: 'developer-mode',
    message: 'action:runtime-developer-registration-synced',
    flowId: input.flowId,
    details: {
      enabled: input.enabled,
      runtimeRunning: nextStatus.running,
      runtimeManaged: nextStatus.managed,
    },
  });
  return nextStatus;
}

export function describeDeveloperModeRuntimeSyncError(error: unknown): string {
  return safeBootstrapErrorMessage(error)
    || 'Developer Mode could not update Runtime local app testing.';
}
