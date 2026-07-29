import { logRendererEvent, toRendererLogMessage } from '@nimiplatform/kit/telemetry';
import {
  getRuntimeAccountSessionStatus,
  subscribeRuntimeAccountSessionEvents,
  getRuntimeDefaults,
  hasElectronInvoke,
} from '@nimiplatform/kit/shell/renderer/bridge';
import {
  getRuntimeBridgeStatus,
  restartRuntimeBridge,
  startRuntimeBridge,
} from './runtime-bridge/runtime-daemon';
import { getSystemResourceSnapshot } from './runtime-bridge/system-resources';
import { proxyHttp } from './runtime-bridge/http';
import {
  admitProductReadyForUse,
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
import { getDesktopStorageDirs } from './runtime-bridge/desktop-storage';
import { syncMenuBarRuntimeHealth } from './runtime-bridge/menu-bar';
import { setDesktopOpenIntentReady } from './runtime-bridge/desktop-open-intent';
import {
  focusMainWindow,
  oauthListenForCode,
  openExternalUrl,
  startWindowDrag,
} from '@nimiplatform/kit/shell/renderer/bridge';
import type {
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
} from '@nimiplatform/kit/core/oauth';

async function oauthTokenExchange(
  _payload: OauthTokenExchangePayload,
): Promise<OauthTokenExchangeResult> {
  throw new Error(
    'Desktop OAuth token exchange is unavailable: Runtime owns connector and account code exchange.',
  );
}

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

export type { DesktopStorageDirs } from './runtime-bridge/desktop-storage';

export type {
  MenuBarProviderSummary,
  MenuBarRuntimeHealthSyncPayload,
} from './runtime-bridge/menu-bar';

export type {
  RendererLogLevel,
  RendererLogMessage,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  SystemResourceSnapshot,
} from './runtime-bridge/types';

export type {
  OpenExternalUrlResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';

export type {
  DesktopAccountProjection,
  DesktopAccountSessionEvent,
  DesktopAccountSessionState,
  DesktopAccountSessionStatus,
} from '@nimiplatform/kit/shell/renderer/bridge';

export {
  hasElectronInvoke,
  logRendererEvent,
  toRendererLogMessage,
  getRuntimeBridgeStatus,
  getRuntimeAccountSessionStatus,
  subscribeRuntimeAccountSessionEvents,
  getSystemResourceSnapshot,
  startRuntimeBridge,
  restartRuntimeBridge,
  proxyHttp,
  getRuntimeDefaults,
  getProductControlRecord,
  getProductControlSelectedDataRoot,
  ensureProductControlRecordCreated,
  pickProductDataRootDirectory,
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
  getDesktopStorageDirs,
  oauthListenForCode,
  oauthTokenExchange,
  focusMainWindow,
  openExternalUrl,
  startWindowDrag,
  syncMenuBarRuntimeHealth,
  setDesktopOpenIntentReady,
};
