import { localRuntime } from '@runtime/local-runtime';
import type {
  LocalRuntimeAssetRecord,
  LocalRuntimeAuditEvent,
  LocalRuntimeAuditListPayload,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeDownloadSessionSummary,
  LocalRuntimeInferenceAuditPayload,
  LocalRuntimeImportAssetPayload,
  LocalRuntimeInstallVerifiedAssetPayload,
  LocalRuntimeListAssetsPayload,
  LocalRuntimeListVerifiedAssetsPayload,
  LocalRuntimeAssetsHealthResult,
  LocalRuntimeVerifiedAssetDescriptor,
} from './local-ai-types.js';

export type LocalRuntimeLifecycleCaller = 'core' | 'builtin' | 'injected' | 'sideload' | string;

type LocalRuntimeWriteOptions = {
  caller?: LocalRuntimeLifecycleCaller;
};

export async function listLocalRuntimeAssets(
  payload?: LocalRuntimeListAssetsPayload,
): Promise<LocalRuntimeAssetRecord[]> {
  return localRuntime.listAssets(payload) as Promise<LocalRuntimeAssetRecord[]>;
}

export async function listLocalRuntimeVerifiedAssets(
  payload?: LocalRuntimeListVerifiedAssetsPayload,
): Promise<LocalRuntimeVerifiedAssetDescriptor[]> {
  return localRuntime.listVerifiedAssets(payload) as Promise<LocalRuntimeVerifiedAssetDescriptor[]>;
}

export async function listLocalRuntimeAudits(payload?: LocalRuntimeAuditListPayload): Promise<LocalRuntimeAuditEvent[]> {
  return localRuntime.listAudits(payload) as Promise<LocalRuntimeAuditEvent[]>;
}

export async function pickLocalRuntimeAssetManifestPath(): Promise<string | null> {
  return localRuntime.pickAssetManifestPath();
}

export async function installLocalRuntimeVerifiedAsset(
  payload: LocalRuntimeInstallVerifiedAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.installVerifiedAsset(payload, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function listLocalRuntimeDownloadSessions(): Promise<LocalRuntimeDownloadSessionSummary[]> {
  return localRuntime.listDownloads() as Promise<LocalRuntimeDownloadSessionSummary[]>;
}

export async function pauseLocalRuntimeDownloadSession(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  return localRuntime.pauseDownload(installSessionId, options) as Promise<LocalRuntimeDownloadSessionSummary>;
}

export async function resumeLocalRuntimeDownloadSession(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  return localRuntime.resumeDownload(installSessionId, options) as Promise<LocalRuntimeDownloadSessionSummary>;
}

export async function cancelLocalRuntimeDownloadSession(
  installSessionId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeDownloadSessionSummary> {
  return localRuntime.cancelDownload(installSessionId, options) as Promise<LocalRuntimeDownloadSessionSummary>;
}

export async function importLocalRuntimeAsset(
  payload: LocalRuntimeImportAssetPayload,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.importAsset(payload, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function removeLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.remove(localAssetId, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function startLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.start(localAssetId, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function stopLocalRuntimeAsset(
  localAssetId: string,
  options?: LocalRuntimeWriteOptions,
): Promise<LocalRuntimeAssetRecord> {
  return localRuntime.stop(localAssetId, options) as Promise<LocalRuntimeAssetRecord>;
}

export async function healthLocalRuntimeAssets(localAssetId?: string): Promise<LocalRuntimeAssetsHealthResult> {
  const assets = await localRuntime.health(localAssetId);
  return { assets } as LocalRuntimeAssetsHealthResult;
}

export async function appendLocalRuntimeInferenceAudit(payload: LocalRuntimeInferenceAuditPayload): Promise<void> {
  await localRuntime.appendInferenceAudit(payload as Parameters<typeof localRuntime.appendInferenceAudit>[0]);
}

export async function subscribeLocalRuntimeDownloadProgress(
  listener: (event: LocalRuntimeDownloadProgressEvent) => void,
): Promise<() => void> {
  return localRuntime.subscribeDownloadProgress(listener as Parameters<typeof localRuntime.subscribeDownloadProgress>[0]);
}
