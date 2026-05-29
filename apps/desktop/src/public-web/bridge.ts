// Desktop public-for-web boundary: bridge types and functions.
// Web adapters import from here instead of reaching into desktop bridge internals.

export { logRendererEvent, toRendererLogMessage } from '../shell/renderer/bridge/runtime-bridge/logging';
export { completeMenuBarQuit, syncMenuBarRuntimeHealth } from '../shell/renderer/bridge/runtime-bridge/menu-bar';
export { proxyHttp } from '../shell/renderer/bridge/runtime-bridge/http';
export { getSystemResourceSnapshot } from '../shell/renderer/bridge/runtime-bridge/system-resources';
export { startWindowDrag } from '../shell/renderer/bridge/runtime-bridge/ui';

export type { AppsBridgeProjection } from '../shell/renderer/bridge/runtime-bridge/apps-projection';

export type {
  NimiDataMigrationState,
  NimiDataDirectoryImpact,
  NimiDataMigrationPreview,
  NimiDataMigrationOutcome,
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
  NimiDataOldRootReclaimPlan,
} from '../shell/renderer/bridge/runtime-bridge/nimi-data-migration';

export type { LogsExportResult } from '../shell/renderer/bridge/runtime-bridge/support-logs-export';

export type {
  ProductControlState,
  ProductControlRecord,
  ProductControlRecordProjection,
} from '../shell/renderer/bridge/runtime-bridge/product-control';

export type { DesktopStorageDirs } from '../shell/renderer/bridge/runtime-bridge/desktop-storage';

export type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
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
  SystemResourceSnapshot,
} from '../shell/renderer/bridge/runtime-bridge/types';
