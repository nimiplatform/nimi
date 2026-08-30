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
import { desktopManagedConnectorCredentialAcquisitionHost } from './runtime-bridge/connector-auth-acquisition';
import {
  admitProductReadyForUse,
  ensureProductControlRecordCreated,
  getProductControlRecord,
  getProductControlSelectedDataRoot,
  getProductControlCheckSync,
  initializeProductControlRootActivation,
  pickProductDataRootDirectory,
  replaceProductDataRoot,
  selectProductDataRoot,
  startProductControlCheckSync,
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
export type {
  NimiProductControlRecord,
  NimiProductControlRecordProjection,
  NimiProductControlState,
  ProductControlCheckSyncProjection,
  ProductControlCheckSyncResource,
} from './runtime-bridge/product-control';

export type {
  NimiDataCleanupPlan,
  NimiDataCleanupOutcome,
} from './runtime-bridge/nimi-data-directory';

export { NIMI_DATA_DESTRUCTIVE_CLEANUP_CONFIRMATION } from './runtime-bridge/nimi-data-directory';

export type { LogsExportResult } from './runtime-bridge/support-logs-export';

export type { DesktopStorageDirs } from './runtime-bridge/desktop-storage';

export type {
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
  desktopManagedConnectorCredentialAcquisitionHost,
  getRuntimeDefaults,
  getProductControlRecord,
  getProductControlSelectedDataRoot,
  getProductControlCheckSync,
  ensureProductControlRecordCreated,
  initializeProductControlRootActivation,
  pickProductDataRootDirectory,
  replaceProductDataRoot,
  selectProductDataRoot,
  startProductControlCheckSync,
  admitProductReadyForUse,
  planNimiDataCleanup,
  executeNimiDataCleanup,
  exportDesktopLogs,
  getDesktopStorageDirs,
  oauthListenForCode,
  focusMainWindow,
  openExternalUrl,
  startWindowDrag,
  syncMenuBarRuntimeHealth,
  setDesktopOpenIntentReady,
};
