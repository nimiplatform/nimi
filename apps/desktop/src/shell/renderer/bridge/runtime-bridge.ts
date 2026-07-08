import { logRendererEvent, toRendererLogMessage } from '@nimiplatform/kit/telemetry';
import { getRuntimeDefaults, hasShellHostInvoke, hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
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
import {
  admitProductReadyForUse,
  defaultProductDataRootDirectory,
  completeProductFirstRunDeviceEnvironmentScan,
  ensureProductControlRecordCreated,
  getAccountDefaultProfileForScopeInit,
  getProductControlRecord,
  getProductControlSelectedDataRoot,
  pickProductDataRootDirectory,
  prepareProductFirstRunLocalAiReady,
  reconcileProductFirstRunSetupState,
  selectProductDataRoot,
  setProductFirstRunInstallLevel,
} from './runtime-bridge/product-control';
import {
  executeNimiDataCleanup,
  planNimiDataCleanup,
} from './runtime-bridge/nimi-data-directory';
import { exportDesktopLogs } from './runtime-bridge/support-logs-export';
import { getAppsBridgeProjection } from './runtime-bridge/apps-projection';
import { getDesktopStorageDirs } from './runtime-bridge/desktop-storage';
import { completeMenuBarQuit, syncMenuBarRuntimeHealth } from './runtime-bridge/menu-bar';
import { setDesktopOpenIntentReady } from './runtime-bridge/desktop-open-intent';
import {
  focusMainWindow,
  oauthListenForCode,
  oauthTokenExchange,
  openExternalUrl,
  startWindowDrag,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlState,
  AccountDefaultProfileAIProfile,
} from './runtime-bridge/product-control';

export type {
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
} from './runtime-bridge/nimi-data-directory';

export { NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION } from './runtime-bridge/nimi-data-directory';

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
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
} from './runtime-bridge/types';

export type {
  OpenExternalUrlResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';

export {
  getDesktopReleaseInfo,
  getDesktopUpdateState,
  desktopUpdateCheck,
  desktopUpdateDownload,
  desktopUpdateInstall,
  desktopUpdateRestart,
  subscribeDesktopUpdateState,
  hasTauriInvoke,
  hasShellHostInvoke,
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
  getProductControlSelectedDataRoot,
  ensureProductControlRecordCreated,
  pickProductDataRootDirectory,
  defaultProductDataRootDirectory,
  completeProductFirstRunDeviceEnvironmentScan,
  selectProductDataRoot,
  setProductFirstRunInstallLevel,
  reconcileProductFirstRunSetupState,
  prepareProductFirstRunLocalAiReady,
  admitProductReadyForUse,
  getAccountDefaultProfileForScopeInit,
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
  setDesktopOpenIntentReady,
};
