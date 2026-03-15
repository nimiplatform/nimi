import { localRuntime } from '@runtime/local-runtime';
import type {
  LocalRuntimeArtifactRecord,
  LocalRuntimeAuditEvent,
  LocalRuntimeAuditListPayload,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeImportArtifactPayload,
  LocalRuntimeImportPayload,
  LocalRuntimeInstallAcceptedResponse,
  LocalRuntimeInstallVerifiedArtifactPayload,
  LocalRuntimeInstallPayload,
  LocalRuntimeInstallVerifiedPayload,
  LocalRuntimeListArtifactsPayload,
  LocalRuntimeListVerifiedArtifactsPayload,
  LocalRuntimeModelRecord,
  LocalRuntimeModelsHealthResult,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
} from './types';

export type LocalRuntimeLifecycleCaller = 'core' | 'builtin' | 'injected' | 'sideload' | string;

type LocalRuntimeWriteOptions = {
  caller?: LocalRuntimeLifecycleCaller;
};

export async function listLocalRuntimeModels(): Promise<LocalRuntimeModelRecord[]> {
  return localRuntime.list();
}

export async function listLocalRuntimeArtifacts(
  payload?: LocalRuntimeListArtifactsPayload,
): Promise<LocalRuntimeArtifactRecord[]> {
  return localRuntime.listArtifacts(payload);
}

export async function listLocalRuntimeVerifiedModels(): Promise<LocalRuntimeVerifiedModelDescriptor[]> {
  return localRuntime.listVerified();
}

export async function listLocalRuntimeVerifiedArtifacts(
  payload?: LocalRuntimeListVerifiedArtifactsPayload,
): Promise<LocalRuntimeVerifiedArtifactDescriptor[]> {
  return localRuntime.listVerifiedArtifacts(payload);
}

export async function listLocalRuntimeAudits(payload?: LocalRuntimeAuditListPayload): Promise<LocalRuntimeAuditEvent[]> {
  return localRuntime.listAudits(payload);
}

export async function pickLocalRuntimeManifestPath(): Promise<string | null> {
  return localRuntime.pickManifestPath();
}

export async function pickLocalRuntimeArtifactManifestPath(): Promise<string | null> {
  return localRuntime.pickArtifactManifestPath();
}

export async function installLocalRuntimeModel(
  payload: LocalRuntimeInstallPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeInstallAcceptedResponse> {
  return localRuntime.install(payload, options);
}

export async function installLocalRuntimeVerifiedModel(
  payload: LocalRuntimeInstallVerifiedPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeInstallAcceptedResponse> {
  return localRuntime.installVerified(payload, options);
}

export async function installLocalRuntimeVerifiedArtifact(
  payload: LocalRuntimeInstallVerifiedArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  return localRuntime.installVerifiedArtifact(payload, options);
}

export async function listLocalRuntimeDownloadSessions(): Promise<LocalRuntimeDownloadSessionSummary[]> {
  return localRuntime.listDownloads();
}

export async function pauseLocalRuntimeDownloadSession(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  return localRuntime.pauseDownload(installSessionId, options);
}

export async function resumeLocalRuntimeDownloadSession(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  return localRuntime.resumeDownload(installSessionId, options);
}

export async function cancelLocalRuntimeDownloadSession(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  return localRuntime.cancelDownload(installSessionId, options);
}

export async function importLocalRuntimeModel(
  payload: LocalRuntimeImportPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  return localRuntime.import(payload, options);
}

export async function importLocalRuntimeArtifact(
  payload: LocalRuntimeImportArtifactPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  return localRuntime.importArtifact(payload, options);
}

export async function removeLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  return localRuntime.remove(localModelId, options);
}

export async function removeLocalRuntimeArtifact(
  localArtifactId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeArtifactRecord> {
  return localRuntime.removeArtifact(localArtifactId, options);
}

export async function startLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  return localRuntime.start(localModelId, options);
}

export async function stopLocalRuntimeModel(
  localModelId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeModelRecord> {
  return localRuntime.stop(localModelId, options);
}

export async function healthLocalRuntimeModels(localModelId?: string): Promise<LocalRuntimeModelsHealthResult> {
  const models = await localRuntime.health(localModelId);
  return { models };
}

export async function appendLocalRuntimeInferenceAudit(payload: LocalRuntimeInferenceAuditPayload): Promise<void> {
  await localRuntime.appendInferenceAudit(payload);
}

export async function subscribeLocalRuntimeDownloadProgress(
  listener: (event: LocalRuntimeDownloadProgressEvent) => void,
): Promise<() => void> {
  return localRuntime.subscribeDownloadProgress(listener);
}
