import { localAiRuntime } from '@runtime/local-ai-runtime';
import type {
  LocalAiArtifactRecord,
  LocalAiAuditEvent,
  LocalAiAuditListPayload,
  LocalAiDownloadProgressEvent,
  LocalAiDownloadSessionSummary,
  LocalAiInferenceAuditPayload,
  LocalAiImportArtifactPayload,
  LocalAiImportPayload,
  LocalAiInstallAcceptedResponse,
  LocalAiInstallVerifiedArtifactPayload,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiListArtifactsPayload,
  LocalAiListVerifiedArtifactsPayload,
  LocalAiModelRecord,
  LocalAiModelsHealthResult,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiVerifiedModelDescriptor,
} from './types';

export type LocalAiLifecycleCaller = 'core' | 'builtin' | 'injected' | 'sideload' | string;

type LocalAiWriteOptions = {
  caller?: LocalAiLifecycleCaller;
};

export async function listLocalAiModels(): Promise<LocalAiModelRecord[]> {
  return localAiRuntime.list();
}

export async function listLocalAiArtifacts(
  payload?: LocalAiListArtifactsPayload,
): Promise<LocalAiArtifactRecord[]> {
  return localAiRuntime.listArtifacts(payload);
}

export async function listLocalAiVerifiedModels(): Promise<LocalAiVerifiedModelDescriptor[]> {
  return localAiRuntime.listVerified();
}

export async function listLocalAiVerifiedArtifacts(
  payload?: LocalAiListVerifiedArtifactsPayload,
): Promise<LocalAiVerifiedArtifactDescriptor[]> {
  return localAiRuntime.listVerifiedArtifacts(payload);
}

export async function listLocalAiAudits(payload?: LocalAiAuditListPayload): Promise<LocalAiAuditEvent[]> {
  return localAiRuntime.listAudits(payload);
}

export async function pickLocalAiManifestPath(): Promise<string | null> {
  return localAiRuntime.pickManifestPath();
}

export async function pickLocalAiArtifactManifestPath(): Promise<string | null> {
  return localAiRuntime.pickArtifactManifestPath();
}

export async function installLocalAiModel(
  payload: LocalAiInstallPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  return localAiRuntime.install(payload, options);
}

export async function installLocalAiVerifiedModel(
  payload: LocalAiInstallVerifiedPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiInstallAcceptedResponse> {
  return localAiRuntime.installVerified(payload, options);
}

export async function installLocalAiVerifiedArtifact(
  payload: LocalAiInstallVerifiedArtifactPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiArtifactRecord> {
  return localAiRuntime.installVerifiedArtifact(payload, options);
}

export async function listLocalAiDownloadSessions(): Promise<LocalAiDownloadSessionSummary[]> {
  return localAiRuntime.listDownloads();
}

export async function pauseLocalAiDownloadSession(
  installSessionId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  return localAiRuntime.pauseDownload(installSessionId, options);
}

export async function resumeLocalAiDownloadSession(
  installSessionId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  return localAiRuntime.resumeDownload(installSessionId, options);
}

export async function cancelLocalAiDownloadSession(
  installSessionId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiDownloadSessionSummary> {
  return localAiRuntime.cancelDownload(installSessionId, options);
}

export async function importLocalAiModel(
  payload: LocalAiImportPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.import(payload, options);
}

export async function importLocalAiArtifact(
  payload: LocalAiImportArtifactPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiArtifactRecord> {
  return localAiRuntime.importArtifact(payload, options);
}

export async function removeLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.remove(localModelId, options);
}

export async function removeLocalAiArtifact(
  localArtifactId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiArtifactRecord> {
  return localAiRuntime.removeArtifact(localArtifactId, options);
}

export async function startLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.start(localModelId, options);
}

export async function stopLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.stop(localModelId, options);
}

export async function healthLocalAiModels(localModelId?: string): Promise<LocalAiModelsHealthResult> {
  const models = await localAiRuntime.health(localModelId);
  return { models };
}

export async function appendLocalAiInferenceAudit(payload: LocalAiInferenceAuditPayload): Promise<void> {
  await localAiRuntime.appendInferenceAudit(payload);
}

export async function subscribeLocalAiDownloadProgress(
  listener: (event: LocalAiDownloadProgressEvent) => void,
): Promise<() => void> {
  return localAiRuntime.subscribeDownloadProgress(listener);
}
