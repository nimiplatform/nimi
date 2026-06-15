import { desktopBridge } from '@renderer/bridge';
import { syncRuntimeStorageConfig } from '../infra/bootstrap/runtime-bootstrap-local-models-sync.js';

export async function syncFirstRunRuntimeDataRootConfig(input: {
  readonly forceManagedRuntimeRestartWhenUnchanged?: boolean;
} = {}): Promise<void> {
  if (!desktopBridge.hasTauriInvoke()) {
    return;
  }
  await syncRuntimeStorageConfig({
    forceManagedRuntimeRestartWhenUnchanged: input.forceManagedRuntimeRestartWhenUnchanged,
    bridge: {
      getRuntimeBridgeStatus: () => desktopBridge.getRuntimeBridgeStatus(),
      getDesktopStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
      getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
      setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
      restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
    },
  });
}
