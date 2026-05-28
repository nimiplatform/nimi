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
import {
  createAccountProfileLibraryProfile,
  deleteAccountProfileLibraryProfile,
  editAccountProfileLibraryProfile,
  exportAccountProfileLibraryProfiles,
  importAccountProfileLibraryProfiles,
  listAccountProfileLibrary,
} from './runtime-bridge/account-profile-library';
import { getDesktopStorageDirs } from './runtime-bridge/desktop-storage';
import { clearAuthSession, loadAuthSession, saveAuthSession } from './runtime-bridge/auth-session';
import { oauthListenForCode, oauthTokenExchange } from './runtime-bridge/oauth';
import { completeMenuBarQuit, syncMenuBarRuntimeHealth } from './runtime-bridge/menu-bar';
import { focusMainWindow, openExternalUrl, startWindowDrag } from './runtime-bridge/ui';
import {
  listLocalRuntimeAssets,
  listLocalRuntimeVerifiedAssets,
  listLocalRuntimeAudits,
  pickLocalRuntimeAssetManifestPath,
  installLocalRuntimeVerifiedAsset,
  listLocalRuntimeDownloadSessions,
  pauseLocalRuntimeDownloadSession,
  resumeLocalRuntimeDownloadSession,
  cancelLocalRuntimeDownloadSession,
  importLocalRuntimeAsset,
  removeLocalRuntimeAsset,
  startLocalRuntimeAsset,
  stopLocalRuntimeAsset,
  healthLocalRuntimeAssets,
  appendLocalRuntimeInferenceAudit,
  subscribeLocalRuntimeDownloadProgress,
} from './runtime-bridge/local-ai';
import type { LocalRuntimeLifecycleCaller } from './runtime-bridge/local-ai';
import {
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
  getExternalAgentGatewayStatus,
} from './runtime-bridge/external-agent';
export type LocalRuntimeWriteOptions = {
  caller?: LocalRuntimeLifecycleCaller;
};

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
  AccountProfileLibraryProjection,
  LibraryIndexEntry,
  LibraryProfile,
  LibraryProfileOrigin,
} from './runtime-bridge/account-profile-library';

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
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeAuditEvent,
  LocalRuntimeAuditListPayload,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallVerifiedAssetPayload,
  LocalRuntimeAssetHealth,
  LocalRuntimeAssetRecord,
  LocalRuntimeAssetStatus,
  LocalRuntimeAssetsHealthResult,
  LocalRuntimeVerifiedAssetDescriptor,
  ExternalAgentGatewayStatus,
  ExternalAgentIssueTokenPayload,
  ExternalAgentIssueTokenResult,
  ExternalAgentRevokeTokenPayload,
  ExternalAgentTokenRecord,
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
  listAccountProfileLibrary,
  createAccountProfileLibraryProfile,
  editAccountProfileLibraryProfile,
  importAccountProfileLibraryProfiles,
  exportAccountProfileLibraryProfiles,
  deleteAccountProfileLibraryProfile,
  loadAuthSession,
  saveAuthSession,
  clearAuthSession,
  oauthListenForCode,
  oauthTokenExchange,
  focusMainWindow,
  openExternalUrl,
  startWindowDrag,
  syncMenuBarRuntimeHealth,
  completeMenuBarQuit,
  listLocalRuntimeAssets,
  listLocalRuntimeVerifiedAssets,
  listLocalRuntimeAudits,
  pickLocalRuntimeAssetManifestPath,
  installLocalRuntimeVerifiedAsset,
  listLocalRuntimeDownloadSessions,
  pauseLocalRuntimeDownloadSession,
  resumeLocalRuntimeDownloadSession,
  cancelLocalRuntimeDownloadSession,
  importLocalRuntimeAsset,
  removeLocalRuntimeAsset,
  startLocalRuntimeAsset,
  stopLocalRuntimeAsset,
  healthLocalRuntimeAssets,
  appendLocalRuntimeInferenceAudit,
  subscribeLocalRuntimeDownloadProgress,
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
  getExternalAgentGatewayStatus,
};
