import { desktopBridge } from '@renderer/bridge';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import { safeBootstrapErrorMessage } from '@nimiplatform/kit/shell/renderer/bootstrap';
import { isDeveloperModeEnabled } from '@renderer/features/developer/developer-mode';
import { isRuntimeConfigManualRestartRequiredError } from './runtime-bootstrap-config-errors';
import { syncRuntimeDeveloperRegistrationConfig } from './runtime-bootstrap-developer-registration-sync';
import { syncRuntimeJwtConfig } from './runtime-bootstrap-jwt-sync';
import { syncRuntimeStorageConfig } from './runtime-bootstrap-local-models-sync';

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

async function shouldDegradeRuntimeConfigManualRestartForProductSetup(flowId: string): Promise<boolean> {
  if (!desktopBridge.hasTauriInvoke()) {
    return false;
  }
  try {
    const projection = await desktopBridge.getProductControlRecord();
    return projection.state !== 'ready_for_use';
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:product-control:read-for-config-restart-gate-failed',
      flowId,
      details: {
        error: safeBootstrapErrorMessage(error),
      },
    });
    return false;
  }
}

function isFirstRunDataRootSelectionPendingMessage(message: string): boolean {
  return message.includes('selected nimi_data is not ready')
    || message.includes('first-run data-root selection has not initialized product control')
    || message.includes('has no selected absolute dataRoot.path');
}

async function shouldSkipRuntimeStorageConfigWarningForFirstRun(input: {
  errorMessage: string;
  flowId: string;
  step: string;
}): Promise<boolean> {
  if (
    input.step !== 'runtime local storage config sync'
    || !desktopBridge.hasTauriInvoke()
    || !isFirstRunDataRootSelectionPendingMessage(input.errorMessage)
  ) {
    return false;
  }
  try {
    const projection = await desktopBridge.getProductControlRecord();
    const pendingFirstRunDataRoot =
      projection.state === 'config_missing' || projection.state === 'data_root_missing';
    if (pendingFirstRunDataRoot) {
      logRendererEvent({
        level: 'info',
        area: 'renderer-bootstrap',
        message: 'phase:runtime-config-sync:skipped-first-run-data-root',
        flowId: input.flowId,
        details: {
          step: input.step,
          productControlState: projection.state,
        },
      });
    }
    return pendingFirstRunDataRoot;
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:product-control:read-for-storage-sync-skip-failed',
      flowId: input.flowId,
      details: {
        error: safeBootstrapErrorMessage(error),
      },
    });
    return false;
  }
}

async function handleRuntimeConfigSyncError(input: {
  error: unknown;
  flowId: string;
  step: string;
}): Promise<string | null> {
  const message = safeBootstrapErrorMessage(input.error);
  if (isRuntimeConfigManualRestartRequiredError(input.error)) {
    const degradeForProductSetup = await shouldDegradeRuntimeConfigManualRestartForProductSetup(input.flowId);
    if (!degradeForProductSetup) {
      throw input.error;
    }
    logRendererEvent({
      level: 'warn',
      area: 'renderer-bootstrap',
      message: 'phase:runtime-config-sync:degraded',
      flowId: input.flowId,
      details: {
        error: message,
        step: input.step,
        productStateReady: false,
      },
    });
    return message;
  }
  if (await shouldSkipRuntimeStorageConfigWarningForFirstRun({
    errorMessage: message,
    flowId: input.flowId,
    step: input.step,
  })) {
    return null;
  }
  logRendererEvent({
    level: 'warn',
    area: 'renderer-bootstrap',
    message: 'phase:runtime-config-sync:degraded',
    flowId: input.flowId,
    details: {
      error: message,
      step: input.step,
    },
  });
  return message;
}

export async function syncDesktopRuntimeBootstrapConfig(
  input: SyncDesktopRuntimeBootstrapConfigInput,
): Promise<SyncDesktopRuntimeBootstrapConfigResult> {
  let daemonStatus = input.daemonStatus;
  let runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
  let bootstrapRuntimeConfigWarning: string | null = null;
  if (!desktopBridge.hasTauriInvoke()) {
    return {
      daemonStatus,
      runtimeUnavailable,
      bootstrapRuntimeConfigWarning,
    };
  }

  try {
    daemonStatus = await syncRuntimeJwtConfig({
      daemonStatus,
      realmDefaults: input.realmDefaults,
      bridge: {
        getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
        setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
        restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
      },
    });
    runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
  } catch (error) {
    const warning = await handleRuntimeConfigSyncError({
      error,
      flowId: input.flowId,
      step: 'runtime account auth config sync',
    });
    if (warning) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning ?? warning;
  }
  try {
    daemonStatus = await syncRuntimeStorageConfig({
      daemonStatus,
      preserveLocalRuntimeStatePath: input.preserveLocalRuntimeStatePath,
      bridge: {
        getRuntimeBridgeStatus: () => desktopBridge.getRuntimeBridgeStatus(),
        getDesktopStorageDirs: () => desktopBridge.getDesktopStorageDirs(),
        getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
        setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
        restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
      },
    });
    runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
  } catch (error) {
    const warning = await handleRuntimeConfigSyncError({
      error,
      flowId: input.flowId,
      step: 'runtime local storage config sync',
    });
    if (warning) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning ?? warning;
  }
  try {
    daemonStatus = await syncRuntimeDeveloperRegistrationConfig({
      daemonStatus,
      enabled: isDeveloperModeEnabled(),
      bridge: {
        getRuntimeBridgeConfig: () => desktopBridge.getRuntimeBridgeConfig(),
        setRuntimeBridgeConfig: (configJson: string) => desktopBridge.setRuntimeBridgeConfig(configJson),
        restartRuntimeBridge: () => desktopBridge.restartRuntimeBridge(),
      },
    });
    runtimeUnavailable = runtimeDaemonUnavailable(daemonStatus);
  } catch (error) {
    const warning = await handleRuntimeConfigSyncError({
      error,
      flowId: input.flowId,
      step: 'runtime developer-registration config sync',
    });
    if (warning) bootstrapRuntimeConfigWarning = bootstrapRuntimeConfigWarning ?? warning;
  }

  return {
    daemonStatus,
    runtimeUnavailable,
    bootstrapRuntimeConfigWarning,
  };
}
