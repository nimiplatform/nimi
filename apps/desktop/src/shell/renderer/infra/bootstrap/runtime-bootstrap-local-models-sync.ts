import type {
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeModStorageDirs,
} from '@renderer/bridge';
import { createRuntimeConfigManualRestartRequiredError } from './runtime-bootstrap-config-errors';

const CONFIG_RESTART_REQUIRED = 'CONFIG_RESTART_REQUIRED';

export type RuntimeLocalModelsConfigSyncBridge = {
  getRuntimeBridgeConfig: () => Promise<RuntimeBridgeConfigGetResult>;
  setRuntimeBridgeConfig: (configJson: string) => Promise<RuntimeBridgeConfigSetResult>;
  restartRuntimeBridge: () => Promise<RuntimeBridgeDaemonStatus>;
};

/**
 * Bridge surface for {@link syncRuntimeStorageConfig}: the runtime-config
 * read/write/restart triple plus the runtime daemon status and the desktop
 * storage-dir resolver. `getRuntimeModStorageDirs` fails closed (throws) on a
 * fresh install before the user has selected `nimi_data`.
 */
export type RuntimeStorageConfigSyncBridge = RuntimeLocalModelsConfigSyncBridge & {
  getRuntimeBridgeStatus: () => Promise<RuntimeBridgeDaemonStatus>;
  getRuntimeModStorageDirs: () => Promise<RuntimeModStorageDirs>;
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
  dataRootPath: string,
  localModelsPath: string,
  localStatePath?: string,
): { nextConfig: Record<string, unknown>; changed: boolean } {
  const currentConfig = asRecord(baseConfig);
  const currentDataRootRef = normalize(currentConfig.dataRootRef);
  const currentManagedRoots = asRecord(currentConfig.managedRoots);
  const nextLocalModelsPath = normalize(localModelsPath);
  const nextDataRootRef = normalize(dataRootPath);
  const currentLocalStatePath = normalize(currentConfig.localStatePath);
  const nextLocalStatePath = normalize(localStatePath);
  const nextManagedRoots = {
    ...currentManagedRoots,
    ...(nextLocalModelsPath ? { models: nextLocalModelsPath } : {}),
    ...(nextDataRootRef ? {
      dependencies: `${nextDataRootRef}/dependencies`,
      environments: `${nextDataRootRef}/environments`,
      logs: `${nextDataRootRef}/logs`,
      audit: `${nextDataRootRef}/audit`,
    } : {}),
  };

  const hasLegacyLocalModelsPath = normalize(currentConfig.localModelsPath) !== '';
  const shouldUpdateDataRootRef = nextDataRootRef && currentDataRootRef !== nextDataRootRef;
  const shouldUpdateManagedRoots = JSON.stringify(currentManagedRoots) !== JSON.stringify(nextManagedRoots);
  const shouldUpdateLocalStatePath = nextLocalStatePath && currentLocalStatePath !== nextLocalStatePath;

  if (!hasLegacyLocalModelsPath && !shouldUpdateDataRootRef && !shouldUpdateManagedRoots && !shouldUpdateLocalStatePath) {
    return {
      nextConfig: currentConfig,
      changed: false,
    };
  }
  const { localModelsPath: _removedLocalModelsPath, ...configWithoutLegacyLocalModelsPath } = currentConfig;

  return {
    nextConfig: {
      ...configWithoutLegacyLocalModelsPath,
      ...(shouldUpdateDataRootRef ? { dataRootRef: nextDataRootRef } : {}),
      managedRoots: nextManagedRoots,
      ...(shouldUpdateLocalStatePath ? { localStatePath: nextLocalStatePath } : {}),
    },
    changed: true,
  };
}

export async function syncRuntimeLocalModelsConfig(input: {
  daemonStatus: RuntimeBridgeDaemonStatus;
  dataRootPath: string;
  localModelsPath: string;
  localStatePath?: string;
  bridge: RuntimeLocalModelsConfigSyncBridge;
}): Promise<RuntimeBridgeDaemonStatus> {
  const { daemonStatus, dataRootPath, localModelsPath, localStatePath, bridge } = input;

  const current = await bridge.getRuntimeBridgeConfig();
  const { nextConfig, changed } = mergeRuntimeLocalModelsConfig(current.config, dataRootPath, localModelsPath, localStatePath);
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

/**
 * Resolves the desktop-owned `nimi_data` storage dirs and writes them into the
 * runtime config (`dataRootRef` / `managedRoots`), restarting the managed
 * runtime when the config write requires it.
 *
 * This is the single desktop→runtime data-root config sync mechanism, shared by
 * the bootstrap path and the first-run Storage phase. It exists because the
 * data root is NOT known at bootstrap on a fresh install: bootstrap runs before
 * the first-run "Storage" step, so `getRuntimeModStorageDirs` fails closed there
 * (the product-control record has no `nimi_data` yet). The first-run workflow
 * therefore re-runs this immediately after `selectProductDataRoot` records the
 * user-selected data root — before any materialization can start — so the
 * runtime config reliably carries the data root when the model materializer
 * resolves its models root.
 *
 * `getRuntimeModStorageDirs` throwing (no data root selected yet) propagates:
 * a caller reaching materialization with no resolved data root fails closed
 * rather than letting the runtime stage models into a relative/CWD path.
 */
export async function syncRuntimeStorageConfig(input: {
  bridge: RuntimeStorageConfigSyncBridge;
  daemonStatus?: RuntimeBridgeDaemonStatus;
  /** Omit the local runtime state path from the sync when true. */
  preserveLocalRuntimeStatePath?: boolean;
}): Promise<RuntimeBridgeDaemonStatus> {
  const { bridge, preserveLocalRuntimeStatePath } = input;
  const daemonStatus = input.daemonStatus ?? (await bridge.getRuntimeBridgeStatus());
  const runtimeStorageDirs = await bridge.getRuntimeModStorageDirs();
  return syncRuntimeLocalModelsConfig({
    daemonStatus,
    dataRootPath: runtimeStorageDirs.nimiDataDir,
    localModelsPath: runtimeStorageDirs.localModelsDir,
    localStatePath: preserveLocalRuntimeStatePath
      ? undefined
      : runtimeStorageDirs.localRuntimeStatePath,
    bridge,
  });
}
