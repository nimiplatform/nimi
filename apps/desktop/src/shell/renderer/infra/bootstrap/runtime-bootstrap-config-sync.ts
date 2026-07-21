import { desktopBridge } from '../../bridge';

type RuntimeBridgeStatus = Awaited<ReturnType<typeof desktopBridge.getRuntimeBridgeStatus>>;
type RuntimeDefaults = Awaited<ReturnType<typeof desktopBridge.getRuntimeDefaults>>;

type SyncDesktopRuntimeBootstrapConfigInput = {
  daemonStatus: RuntimeBridgeStatus;
  realmDefaults: RuntimeDefaults['realm'];
  flowId: string;
  preserveLocalRuntimeStatePath: boolean;
};

type SyncDesktopRuntimeBootstrapConfigResult = {
  daemonStatus: RuntimeBridgeStatus;
  runtimeUnavailable: boolean;
  bootstrapRuntimeConfigWarning: string | null;
};

export function runtimeDaemonUnavailable(status: { running: boolean; lastError?: string }): boolean {
  return !status.running;
}

// Runtime owns security-sensitive configuration. Desktop can observe typed
// status/default projections but never reads, writes, or restarts Runtime from
// a generic config document.
export async function syncDesktopRuntimeBootstrapConfig(
  input: SyncDesktopRuntimeBootstrapConfigInput,
): Promise<SyncDesktopRuntimeBootstrapConfigResult> {
  return {
    daemonStatus: input.daemonStatus,
    runtimeUnavailable: runtimeDaemonUnavailable(input.daemonStatus),
    bootstrapRuntimeConfigWarning: null,
  };
}
