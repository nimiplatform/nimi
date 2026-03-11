import { hasTauriInvoke } from './runtime-bridge/env';
import { logRendererEvent, toRendererLogMessage } from './runtime-bridge/logging';
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
import { oauthListenForCode, oauthTokenExchange } from './runtime-bridge/oauth';
import {
  getRuntimeModDeveloperMode,
  installRuntimeMod,
  listRuntimeModDiagnostics,
  listInstalledRuntimeMods,
  listRuntimeLocalModManifests,
  listRuntimeModInstallProgress,
  listRuntimeModSources,
  reloadAllRuntimeMods,
  reloadRuntimeMod,
  readInstalledRuntimeModManifest,
  readRuntimeLocalModEntry,
  removeRuntimeModSource,
  subscribeRuntimeModInstallProgress,
  subscribeRuntimeModReloadResult,
  subscribeRuntimeModSourceChanged,
  uninstallRuntimeMod,
  updateRuntimeMod,
  upsertRuntimeModSource,
  setRuntimeModDeveloperMode,
} from './runtime-bridge/mod-local';
import { confirmPrivateSync, focusMainWindow, openExternalUrl, startWindowDrag } from './runtime-bridge/ui';
import type { LocalAiLifecycleCaller } from './runtime-bridge/local-ai';
import type {
  ExternalAgentActionDescriptor,
  ExternalAgentActionExecutionCompletion,
  ExternalAgentActionExecutionRequest,
  ExternalAgentGatewayStatus,
  ExternalAgentIssueTokenPayload,
  ExternalAgentIssueTokenResult,
  ExternalAgentRevokeTokenPayload,
  ExternalAgentTokenRecord,
  LocalAiAuditEvent,
  LocalAiAuditListPayload,
  LocalAiDownloadProgressEvent,
  LocalAiDownloadSessionSummary,
  LocalAiImportPayload,
  LocalAiInferenceAuditPayload,
  LocalAiInstallAcceptedResponse,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiModelRecord,
  LocalAiModelsHealthResult,
  LocalAiVerifiedModelDescriptor,
} from './runtime-bridge/types';

type LocalAiBridgeModule = typeof import('./runtime-bridge/local-ai');
type ExternalAgentBridgeModule = typeof import('./runtime-bridge/external-agent');

let localAiBridgePromise: Promise<LocalAiBridgeModule> | null = null;
let externalAgentBridgePromise: Promise<ExternalAgentBridgeModule> | null = null;

async function loadLocalAiBridge(): Promise<LocalAiBridgeModule> {
  if (!localAiBridgePromise) {
    localAiBridgePromise = import('./runtime-bridge/local-ai');
  }
  return localAiBridgePromise;
}

async function loadExternalAgentBridge(): Promise<ExternalAgentBridgeModule> {
  if (!externalAgentBridgePromise) {
    externalAgentBridgePromise = import('./runtime-bridge/external-agent');
  }
  return externalAgentBridgePromise;
}

export type LocalAiWriteOptions = {
  caller?: LocalAiLifecycleCaller;
};

export async function listLocalAiModels(): Promise<LocalAiModelRecord[]> {
  const bridge = await loadLocalAiBridge();
  return bridge.listLocalAiModels();
}

export async function listLocalAiVerifiedModels(): Promise<LocalAiVerifiedModelDescriptor[]> {
  const bridge = await loadLocalAiBridge();
  return bridge.listLocalAiVerifiedModels();
}

export async function listLocalAiAudits(payload?: LocalAiAuditListPayload): Promise<LocalAiAuditEvent[]> {
  const bridge = await loadLocalAiBridge();
  return bridge.listLocalAiAudits(payload);
}

export async function pickLocalAiManifestPath(): Promise<string | null> {
  const bridge = await loadLocalAiBridge();
  return bridge.pickLocalAiManifestPath();
}

export async function pickLocalAiArtifactManifestPath(): Promise<string | null> {
  const bridge = await loadLocalAiBridge();
  return bridge.pickLocalAiArtifactManifestPath();
}

export async function installLocalAiModel(
  payload: LocalAiInstallPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  const bridge = await loadLocalAiBridge();
  return bridge.installLocalAiModel(payload, options);
}

export async function installLocalAiVerifiedModel(
  payload: LocalAiInstallVerifiedPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  const bridge = await loadLocalAiBridge();
  return bridge.installLocalAiVerifiedModel(payload, options);
}

export async function listLocalAiDownloadSessions(): Promise<LocalAiDownloadSessionSummary[]> {
  const bridge = await loadLocalAiBridge();
  return bridge.listLocalAiDownloadSessions();
}

export async function pauseLocalAiDownloadSession(
  installSessionId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  const bridge = await loadLocalAiBridge();
  return bridge.pauseLocalAiDownloadSession(installSessionId, options);
}

export async function resumeLocalAiDownloadSession(
  installSessionId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  const bridge = await loadLocalAiBridge();
  return bridge.resumeLocalAiDownloadSession(installSessionId, options);
}

export async function cancelLocalAiDownloadSession(
  installSessionId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  const bridge = await loadLocalAiBridge();
  return bridge.cancelLocalAiDownloadSession(installSessionId, options);
}

export async function importLocalAiModel(
  payload: LocalAiImportPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  const bridge = await loadLocalAiBridge();
  return bridge.importLocalAiModel(payload, options);
}

export async function removeLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  const bridge = await loadLocalAiBridge();
  return bridge.removeLocalAiModel(localModelId, options);
}

export async function startLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  const bridge = await loadLocalAiBridge();
  return bridge.startLocalAiModel(localModelId, options);
}

export async function stopLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  const bridge = await loadLocalAiBridge();
  return bridge.stopLocalAiModel(localModelId, options);
}

export async function healthLocalAiModels(localModelId?: string): Promise<LocalAiModelsHealthResult> {
  const bridge = await loadLocalAiBridge();
  return bridge.healthLocalAiModels(localModelId);
}

export async function appendLocalAiInferenceAudit(payload: LocalAiInferenceAuditPayload): Promise<void> {
  const bridge = await loadLocalAiBridge();
  return bridge.appendLocalAiInferenceAudit(payload);
}

export async function subscribeLocalAiDownloadProgress(
  listener: (event: LocalAiDownloadProgressEvent) => void,
): Promise<() => void> {
  const bridge = await loadLocalAiBridge();
  return bridge.subscribeLocalAiDownloadProgress(listener);
}

export async function issueExternalAgentToken(
  payload: ExternalAgentIssueTokenPayload,
): Promise<ExternalAgentIssueTokenResult> {
  const bridge = await loadExternalAgentBridge();
  return bridge.issueExternalAgentToken(payload);
}

export async function listExternalAgentTokens(): Promise<ExternalAgentTokenRecord[]> {
  const bridge = await loadExternalAgentBridge();
  return bridge.listExternalAgentTokens();
}

export async function revokeExternalAgentToken(payload: ExternalAgentRevokeTokenPayload): Promise<void> {
  const bridge = await loadExternalAgentBridge();
  return bridge.revokeExternalAgentToken(payload);
}

export async function syncExternalAgentActionDescriptors(
  descriptors: ExternalAgentActionDescriptor[],
): Promise<ExternalAgentActionDescriptor[]> {
  const bridge = await loadExternalAgentBridge();
  return bridge.syncExternalAgentActionDescriptors(descriptors);
}

export async function completeExternalAgentExecution(
  payload: ExternalAgentActionExecutionCompletion,
): Promise<void> {
  const bridge = await loadExternalAgentBridge();
  return bridge.completeExternalAgentExecution(payload);
}

export async function getExternalAgentGatewayStatus(): Promise<ExternalAgentGatewayStatus> {
  const bridge = await loadExternalAgentBridge();
  return bridge.getExternalAgentGatewayStatus();
}

export async function subscribeExternalAgentActionExecuteRequests(
  listener: (request: ExternalAgentActionExecutionRequest) => void,
): Promise<() => void> {
  const bridge = await loadExternalAgentBridge();
  return bridge.subscribeExternalAgentActionExecuteRequests(listener);
}

export type {
  RendererLogLevel,
  RendererLogMessage,
  RuntimeBridgeDaemonStatus,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeDefaults,
  SystemResourceSnapshot,
  RuntimeLocalManifestSummary,
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
  RuntimeModInstallSourceKind,
  RuntimeModUpdatePayload,
  OpenExternalUrlResult,
  OauthTokenExchangePayload,
  OauthTokenExchangeResult,
  OauthListenForCodePayload,
  OauthListenForCodeResult,
  ConfirmPrivateSyncPayload,
  ConfirmPrivateSyncResult,
  LocalAiInferenceAuditPayload,
  LocalAiAuditEvent,
  LocalAiAuditListPayload,
  LocalAiDownloadProgressEvent,
  LocalAiDownloadSessionSummary,
  LocalAiImportPayload,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiModelHealth,
  LocalAiModelRecord,
  LocalAiModelStatus,
  LocalAiModelsHealthResult,
  LocalAiVerifiedModelDescriptor,
  ExternalAgentActionDescriptor,
  ExternalAgentActionExecutionCompletion,
  ExternalAgentActionExecutionRequest,
  ExternalAgentGatewayStatus,
  ExternalAgentIssueTokenPayload,
  ExternalAgentIssueTokenResult,
  ExternalAgentRevokeTokenPayload,
  ExternalAgentTokenRecord,
} from './runtime-bridge/types';

export {
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
  oauthListenForCode,
  oauthTokenExchange,
  listRuntimeLocalModManifests,
  readRuntimeLocalModEntry,
  listInstalledRuntimeMods,
  installRuntimeMod,
  updateRuntimeMod,
  uninstallRuntimeMod,
  readInstalledRuntimeModManifest,
  listRuntimeModInstallProgress,
  subscribeRuntimeModInstallProgress,
  listRuntimeModSources,
  upsertRuntimeModSource,
  removeRuntimeModSource,
  getRuntimeModDeveloperMode,
  setRuntimeModDeveloperMode,
  listRuntimeModDiagnostics,
  reloadRuntimeMod,
  reloadAllRuntimeMods,
  subscribeRuntimeModSourceChanged,
  subscribeRuntimeModReloadResult,
  confirmPrivateSync,
  focusMainWindow,
  openExternalUrl,
  startWindowDrag,
};

export const desktopBridge = {
  hasTauriInvoke,
  logRendererEvent,
  getRuntimeBridgeStatus,
  getRuntimeBridgeConfig,
  getSystemResourceSnapshot,
  startRuntimeBridge,
  stopRuntimeBridge,
  restartRuntimeBridge,
  setRuntimeBridgeConfig,
  getRuntimeDefaults,
  startWindowDrag,
  proxyHttp,
  openExternalUrl,
  oauthTokenExchange,
  oauthListenForCode,
  confirmPrivateSync,
  focusMainWindow,
  listRuntimeLocalModManifests,
  readRuntimeLocalModEntry,
  listInstalledRuntimeMods,
  installRuntimeMod,
  updateRuntimeMod,
  uninstallRuntimeMod,
  readInstalledRuntimeModManifest,
  listRuntimeModInstallProgress,
  subscribeRuntimeModInstallProgress,
  listRuntimeModSources,
  upsertRuntimeModSource,
  removeRuntimeModSource,
  getRuntimeModDeveloperMode,
  setRuntimeModDeveloperMode,
  listRuntimeModDiagnostics,
  reloadRuntimeMod,
  reloadAllRuntimeMods,
  subscribeRuntimeModSourceChanged,
  subscribeRuntimeModReloadResult,
  listLocalAiModels,
  listLocalAiVerifiedModels,
  listLocalAiAudits,
  pickLocalAiManifestPath,
  pickLocalAiArtifactManifestPath,
  installLocalAiModel,
  installLocalAiVerifiedModel,
  listLocalAiDownloadSessions,
  pauseLocalAiDownloadSession,
  resumeLocalAiDownloadSession,
  cancelLocalAiDownloadSession,
  importLocalAiModel,
  removeLocalAiModel,
  startLocalAiModel,
  stopLocalAiModel,
  healthLocalAiModels,
  appendLocalAiInferenceAudit,
  subscribeLocalAiDownloadProgress,
  issueExternalAgentToken,
  listExternalAgentTokens,
  revokeExternalAgentToken,
  syncExternalAgentActionDescriptors,
  completeExternalAgentExecution,
  getExternalAgentGatewayStatus,
  subscribeExternalAgentActionExecuteRequests,
};
