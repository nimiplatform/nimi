import { hasTauriInvoke } from './runtime-bridge/env';
import { logRendererEvent, toRendererLogMessage } from './runtime-bridge/logging';
import {
  desktopUpdateCheck,
  desktopUpdateDownload,
  desktopUpdateInstall,
  desktopUpdateRestart,
  getDesktopReleaseInfo,
  getDesktopUpdateState,
  subscribeDesktopUpdateState,
} from './runtime-bridge/desktop-release';
import {
  getRuntimeBridgeConfig,
  getRuntimeBridgeStatus,
  restartRuntimeBridge,
  setRuntimeBridgeConfig,
  startRuntimeBridge,
  stopRuntimeBridge,
} from './runtime-bridge/runtime-daemon';
import { getSystemResourceSnapshot } from './runtime-bridge/system-resources';
import { proxyHttp } from './runtime-bridge/http';
import { getRuntimeDefaults } from './runtime-bridge/runtime-defaults';
import {
  admitProductReadyForUse,
  defaultProductDataRootDirectory,
  getAccountDefaultProfileForScopeInit,
  getProductControlRecord,
  pickProductDataRootDirectory,
  prepareProductFirstRunLocalAiReady,
  selectProductDataRoot,
  setProductFirstRunInstallLevel,
  setProductFirstRunSetupState,
} from './runtime-bridge/product-control';
import {
  executeNimiDataCleanup,
  planNimiDataCleanup,
  previewNimiDataMigration,
  runNimiDataMigration,
} from './runtime-bridge/nimi-data-migration';
import { exportDesktopLogs } from './runtime-bridge/support-logs-export';
import { getAppsBridgeProjection } from './runtime-bridge/apps-projection';
import { getDesktopStorageDirs } from './runtime-bridge/desktop-storage';
import { oauthListenForCode, oauthTokenExchange } from './runtime-bridge/oauth';
import { completeMenuBarQuit, syncMenuBarRuntimeHealth } from './runtime-bridge/menu-bar';
import { focusMainWindow, openExternalUrl, startWindowDrag } from './runtime-bridge/ui';

export type {
  ProductControlRecord,
  ProductControlRecordProjection,
  ProductControlState,
  AccountDefaultProfileAIProfile,
} from './runtime-bridge/product-control';

export type {
  NimiDataMigrationState,
  NimiDataDirectoryImpact,
  NimiDataMigrationPreview,
  NimiDataMigrationOutcome,
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
} from './runtime-bridge/nimi-data-migration';

export { NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION } from './runtime-bridge/nimi-data-migration';

export type { LogsExportResult } from './runtime-bridge/support-logs-export';

export type { AppsBridgeProjection } from './runtime-bridge/apps-projection';
export type { DesktopStorageDirs } from './runtime-bridge/desktop-storage';

export type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  RendererLogLevel,
  RendererLogMessage,
  RuntimeBridgeDaemonStatus,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeDefaults,
  SystemResourceSnapshot,
  OpenExternalUrlResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
} from './runtime-bridge/types';

export {
  getDesktopReleaseInfo,
  getDesktopUpdateState,
  desktopUpdateCheck,
  desktopUpdateDownload,
  desktopUpdateInstall,
  desktopUpdateRestart,
  subscribeDesktopUpdateState,
  hasTauriInvoke,
  logRendererEvent,
  toRendererLogMessage,
  getRuntimeBridgeStatus,
  getRuntimeBridgeConfig,
  getSystemResourceSnapshot,
  startRuntimeBridge,
  stopRuntimeBridge,
  restartRuntimeBridge,
  setRuntimeBridgeConfig,
  proxyHttp,
  getRuntimeDefaults,
  getProductControlRecord,
  pickProductDataRootDirectory,
  defaultProductDataRootDirectory,
  selectProductDataRoot,
  setProductFirstRunInstallLevel,
  setProductFirstRunSetupState,
  prepareProductFirstRunLocalAiReady,
  admitProductReadyForUse,
  getAccountDefaultProfileForScopeInit,
  previewNimiDataMigration,
  runNimiDataMigration,
  planNimiDataCleanup,
  executeNimiDataCleanup,
  exportDesktopLogs,
  getAppsBridgeProjection,
  getDesktopStorageDirs,
  oauthListenForCode,
  oauthTokenExchange,
  focusMainWindow,
  openExternalUrl,
  startWindowDrag,
  syncMenuBarRuntimeHealth,
  completeMenuBarQuit,
};
