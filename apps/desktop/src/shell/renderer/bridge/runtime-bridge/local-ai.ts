import { localAiRuntime } from '@runtime/local-ai-runtime';
import type {
  LocalAiAuditEvent,
  LocalAiAuditListPayload,
  LocalAiDownloadProgressEvent,
  LocalAiInferenceAuditPayload,
  LocalAiImportPayload,
  LocalAiInstallPayload,
  LocalAiInstallVerifiedPayload,
  LocalAiModelRecord,
  LocalAiModelsHealthResult,
  LocalAiVerifiedModelDescriptor,
} from './types';

export type LocalAiLifecycleCaller = 'core' | 'builtin' | 'injected' | 'sideload' | string;

type LocalAiWriteOptions = {
  caller?: LocalAiLifecycleCaller;
};

export async function listLocalAiModels(): Promise<LocalAiModelRecord[]> {
  return localAiRuntime.list();
}

export async function listLocalAiVerifiedModels(): Promise<LocalAiVerifiedModelDescriptor[]> {
  return localAiRuntime.listVerified();
}

export async function listLocalAiAudits(payload?: LocalAiAuditListPayload): Promise<LocalAiAuditEvent[]> {
  return localAiRuntime.listAudits(payload);
}

export async function pickLocalAiManifestPath(): Promise<string | null> {
  return localAiRuntime.pickManifestPath();
}

export async function installLocalAiModel(
  payload: LocalAiInstallPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.install(payload, options);
}

export async function installLocalAiVerifiedModel(
  payload: LocalAiInstallVerifiedPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.installVerified(payload, options);
}

export async function importLocalAiModel(
  payload: LocalAiImportPayload,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.import(payload, options);
}

export async function removeLocalAiModel(
  localModelId: string,
  options?: LocalAiWriteOptions,
): Promise<LocalAiModelRecord> {
  return localAiRuntime.remove(localModelId, options);
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
