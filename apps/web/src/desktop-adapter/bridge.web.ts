// Web bridge adapter — uses kit for shared functions, desktop types via alias
// for type compatibility with the desktop App that web still renders.
//
// Residual desktop type coupling tracked as F-011. Full decoupling requires
// a web-specific app shell that does not render desktop App.

import type { SharedDesktopAuthSession } from '@nimiplatform/nimi-kit/auth';
import {
  hasTauriInvoke,
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  restartDaemon,
  getRuntimeDefaults,
  openExternalUrl,
  focusMainWindow,
  oauthListenForCode,
  oauthTokenExchange,
  loadAuthSession,
  saveAuthSession,
  clearAuthSession,
} from '@nimiplatform/nimi-kit/shell/renderer/bridge';

// Desktop public boundary — types and functions imported via the admitted
// public-for-web surface instead of reaching into desktop bridge internals.
import {
  logRendererEvent,
  toRendererLogMessage,
  completeMenuBarQuit,
  syncMenuBarRuntimeHealth,
  proxyHttp,
  getSystemResourceSnapshot,
  confirmPrivateSync,
  startWindowDrag,
} from '@desktop-public/bridge';
import type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  AvailableModUpdate,
  CatalogConsentReason,
  CatalogInstallResult,
  CatalogPackageRecord,
  CatalogPackageSummary,
  CatalogReleaseRecord,
  CatalogReleaseSource,
  CatalogPublisher,
  CatalogSigner,
  CatalogState,
  CatalogTrustTier,
  InstalledModPolicy,
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  RendererLogMessage,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  RuntimeLocalAsset,
  RuntimeLocalManifestSummary,
  RuntimeModStorageDirs,
  RuntimeModSourceType,
  RuntimeModSourceRecord,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticStatus,
  RuntimeModDiagnosticRecord,
  RuntimeModReloadResult,
  RuntimeModSourceChangeEvent,
  RuntimeModInstallPayload,
  RuntimeModInstallProgressEvent,
  RuntimeModInstallResult,
  RuntimeModUpdatePayload,
  SystemResourceSnapshot,
} from '@desktop-public/bridge';

export type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  AvailableModUpdate,
  CatalogConsentReason,
  CatalogInstallResult,
  CatalogPackageRecord,
  CatalogPackageSummary,
  CatalogPublisher,
  CatalogReleaseRecord,
  CatalogReleaseSource,
  CatalogSigner,
  CatalogState,
  CatalogTrustTier,
  InstalledModPolicy,
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
  OpenExternalUrlResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  RendererLogMessage,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  RuntimeLocalManifestSummary,
  RuntimeModStorageDirs,
  RuntimeModSourceType,
  RuntimeModSourceRecord,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticStatus,
  RuntimeModDiagnosticRecord,
  RuntimeModReloadResult,
  RuntimeModSourceChangeEvent,
  RuntimeModInstallPayload,
  RuntimeModInstallProgressEvent,
  RuntimeModInstallResult,
  RuntimeModUpdatePayload,
  SystemResourceSnapshot,
};

export {
  completeMenuBarQuit,
  logRendererEvent,
  syncMenuBarRuntimeHealth,
  toRendererLogMessage,
};

function unsupportedDesktopRuntime(message: string): never {
  throw new Error(message);
}

export { hasTauriInvoke, loadAuthSession, saveAuthSession, clearAuthSession };

export async function getDesktopReleaseInfo(): Promise<DesktopReleaseInfo> {
  unsupportedDesktopRuntime('Application release metadata is only available in desktop runtime');
}

export async function getDesktopUpdateState(): Promise<DesktopUpdateState> {
  unsupportedDesktopRuntime('Application update state is only available in desktop runtime');
}

export async function desktopUpdateCheck(): Promise<DesktopUpdateCheckResult> {
  unsupportedDesktopRuntime('Application update is only available in desktop runtime');
}

export async function desktopUpdateDownload(): Promise<DesktopUpdateCheckResult> {
  unsupportedDesktopRuntime('Application update is only available in desktop runtime');
}

export async function desktopUpdateInstall(): Promise<DesktopUpdateState> {
  unsupportedDesktopRuntime('Application update is only available in desktop runtime');
}

export async function desktopUpdateRestart(): Promise<void> {
  unsupportedDesktopRuntime('Application update is only available in desktop runtime');
}

export async function subscribeDesktopUpdateState(
  _listener: (event: DesktopUpdateState) => void,
): Promise<() => void> {
  unsupportedDesktopRuntime('Application update events are only available in desktop runtime');
}

export async function listRuntimeLocalModManifests(): Promise<RuntimeLocalManifestSummary[]> {
  return [];
}

export async function readRuntimeLocalModEntry(_path: string): Promise<string> {
  throw new Error('Local mod entry is only available in desktop runtime');
}

export async function readRuntimeLocalModAsset(_path: string): Promise<RuntimeLocalAsset> {
  throw new Error('Local mod asset is only available in desktop runtime');
}

export async function listInstalledRuntimeMods(): Promise<RuntimeLocalManifestSummary[]> {
  return [];
}

export async function listRuntimeModSources(): Promise<RuntimeModSourceRecord[]> {
  return [];
}

export async function getRuntimeModStorageDirs(): Promise<RuntimeModStorageDirs> {
  return {
    nimiDir: '',
    nimiDataDir: '',
    installedModsDir: '',
    runtimeModDbPath: '',
    mediaCacheDir: '',
    localModelsDir: '',
    localRuntimeStatePath: '',
  };
}

export async function upsertRuntimeModSource(_input: {
  sourceId?: string;
  sourceType: 'installed' | 'dev';
  sourceDir: string;
  enabled?: boolean;
}): Promise<RuntimeModSourceRecord> {
  throw new Error('Runtime mod sources are only available in desktop runtime');
}

export async function removeRuntimeModSource(_sourceId: string): Promise<boolean> {
  return false;
}

export async function getRuntimeModDeveloperMode(): Promise<RuntimeModDeveloperModeState> {
  return { enabled: false, autoReloadEnabled: false };
}

export async function setRuntimeModDeveloperMode(_input: {
  enabled: boolean;
  autoReloadEnabled?: boolean;
}): Promise<RuntimeModDeveloperModeState> {
  return { enabled: false, autoReloadEnabled: false };
}

export async function setRuntimeModDataDir(_nimiDataDir: string): Promise<RuntimeModStorageDirs> {
  return getRuntimeModStorageDirs();
}

export async function listRuntimeModDiagnostics(): Promise<RuntimeModDiagnosticRecord[]> {
  return [];
}

export async function openRuntimeModDir(_path: string): Promise<void> {
  unsupportedDesktopRuntime('Runtime mod directories are only available in desktop runtime');
}

export async function reloadRuntimeMod(_modId: string): Promise<RuntimeModReloadResult[]> {
  return [];
}

export async function reloadAllRuntimeMods(): Promise<RuntimeModReloadResult[]> {
  return [];
}

export async function installRuntimeMod(_payload: RuntimeModInstallPayload): Promise<RuntimeModInstallResult> {
  unsupportedDesktopRuntime('Runtime mod install is only available in desktop runtime');
}

export async function updateRuntimeMod(_payload: RuntimeModUpdatePayload): Promise<RuntimeModInstallResult> {
  unsupportedDesktopRuntime('Runtime mod update is only available in desktop runtime');
}

export async function uninstallRuntimeMod(_modId: string): Promise<RuntimeLocalManifestSummary> {
  unsupportedDesktopRuntime('Runtime mod uninstall is only available in desktop runtime');
}

export async function readInstalledRuntimeModManifest(_input: {
  modId?: string;
  path?: string;
}): Promise<RuntimeLocalManifestSummary> {
  unsupportedDesktopRuntime('Runtime mod manifest read is only available in desktop runtime');
}

export async function listCatalogMods(): Promise<CatalogPackageSummary[]> {
  return [];
}

export async function getCatalogMod(_packageId: string): Promise<CatalogPackageRecord | null> {
  return null;
}

export async function checkModUpdates(): Promise<AvailableModUpdate[]> {
  return [];
}

export async function installCatalogMod(_input: { packageId: string }): Promise<CatalogInstallResult> {
  unsupportedDesktopRuntime('Catalog mod install is only available in desktop runtime');
}

export async function updateInstalledMod(_input: { packageId: string }): Promise<CatalogInstallResult> {
  unsupportedDesktopRuntime('Installed mod update is only available in desktop runtime');
}

export async function restoreRuntimeModBackup(_input: {
  modId: string;
  backupPath: string;
}): Promise<RuntimeLocalManifestSummary> {
  unsupportedDesktopRuntime('Runtime mod backup restore is only available in desktop runtime');
}

export async function listRuntimeModInstallProgress(
  _installSessionId?: string,
): Promise<RuntimeModInstallProgressEvent[]> {
  return [];
}

export async function subscribeRuntimeModInstallProgress(
  _listener: (event: RuntimeModInstallProgressEvent) => void,
): Promise<() => void> {
  return () => {};
}

export async function subscribeRuntimeModSourceChanged(
  _listener: (event: RuntimeModSourceChangeEvent) => void,
): Promise<() => void> {
  return () => {};
}

export async function subscribeRuntimeModReloadResult(
  _listener: (event: RuntimeModReloadResult) => void,
): Promise<() => void> {
  return () => {};
}

export async function getRuntimeBridgeStatus(): Promise<RuntimeBridgeDaemonStatus> {
  return getDaemonStatus();
}

export async function getRuntimeBridgeConfig(): Promise<RuntimeBridgeConfigGetResult> {
  unsupportedDesktopRuntime('Runtime bridge config is only available in desktop runtime');
}

export async function startRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return startDaemon();
}

export async function stopRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return stopDaemon();
}

export async function restartRuntimeBridge(): Promise<RuntimeBridgeDaemonStatus> {
  return restartDaemon();
}

export async function setRuntimeBridgeConfig(_configJson: string): Promise<RuntimeBridgeConfigSetResult> {
  unsupportedDesktopRuntime('Runtime bridge config updates are only available in desktop runtime');
}

export { getRuntimeDefaults, oauthListenForCode, oauthTokenExchange, openExternalUrl, focusMainWindow };
export { proxyHttp, getSystemResourceSnapshot, confirmPrivateSync, startWindowDrag };

export const desktopBridge = {
  hasTauriInvoke,
  getDesktopReleaseInfo,
  getDesktopUpdateState,
  desktopUpdateCheck,
  desktopUpdateDownload,
  desktopUpdateInstall,
  desktopUpdateRestart,
  subscribeDesktopUpdateState,
  getRuntimeBridgeStatus,
  getRuntimeBridgeConfig,
  getSystemResourceSnapshot,
  startRuntimeBridge,
  stopRuntimeBridge,
  restartRuntimeBridge,
  setRuntimeBridgeConfig,
  getRuntimeDefaults,
  loadAuthSession,
  proxyHttp,
  openExternalUrl,
  oauthTokenExchange,
  oauthListenForCode,
  saveAuthSession,
  clearAuthSession,
  confirmPrivateSync,
  focusMainWindow,
  syncMenuBarRuntimeHealth,
  completeMenuBarQuit,
  listInstalledRuntimeMods,
  listCatalogMods,
  getCatalogMod,
  checkModUpdates,
  installRuntimeMod,
  installCatalogMod,
  listRuntimeLocalModManifests,
  listRuntimeModSources,
  getRuntimeModStorageDirs,
  upsertRuntimeModSource,
  removeRuntimeModSource,
  getRuntimeModDeveloperMode,
  setRuntimeModDeveloperMode,
  setRuntimeModDataDir,
  listRuntimeModDiagnostics,
  openRuntimeModDir,
  reloadRuntimeMod,
  reloadAllRuntimeMods,
  listRuntimeModInstallProgress,
  readInstalledRuntimeModManifest,
  readRuntimeLocalModAsset,
  readRuntimeLocalModEntry,
  subscribeRuntimeModInstallProgress,
  subscribeRuntimeModSourceChanged,
  subscribeRuntimeModReloadResult,
  startWindowDrag,
  uninstallRuntimeMod,
  updateRuntimeMod,
  updateInstalledMod,
  restoreRuntimeModBackup,
  logRendererEvent,
};
