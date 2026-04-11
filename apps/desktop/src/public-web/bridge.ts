// Desktop public-for-web boundary: bridge types and functions.
// Web adapters import from here instead of reaching into desktop bridge internals.

export { logRendererEvent, toRendererLogMessage } from '../shell/renderer/bridge/runtime-bridge/logging';
export { completeMenuBarQuit, syncMenuBarRuntimeHealth } from '../shell/renderer/bridge/runtime-bridge/menu-bar';
export { proxyHttp } from '../shell/renderer/bridge/runtime-bridge/http';
export { getSystemResourceSnapshot } from '../shell/renderer/bridge/runtime-bridge/system-resources';
export { confirmPrivateSync, startWindowDrag } from '../shell/renderer/bridge/runtime-bridge/ui';

export type {
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
} from '../shell/renderer/bridge/runtime-bridge/types';
