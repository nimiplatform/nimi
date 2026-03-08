import type {
  GgufVariantDescriptor,
  LocalAiAuditEvent,
  LocalAiDownloadState,
  LocalAiDownloadProgressEvent,
  LocalAiDownloadSessionSummary,
  LocalAiInstallAcceptedResponse,
  LocalAiModelHealth,
  OrphanModelFile,
} from './types';
import { asRecord, asString } from './parser-primitives';
import { normalizeStatus } from './parsers';

export function parseModelHealth(value: unknown): LocalAiModelHealth {
  const record = asRecord(value);
  return {
    localModelId: asString(record.localModelId),
    status: normalizeStatus(record.status),
    detail: asString(record.detail),
    endpoint: asString(record.endpoint),
  };
}

export function parseGgufVariantDescriptor(value: unknown): GgufVariantDescriptor {
  const record = asRecord(value);
  return {
    filename: asString(record.filename),
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
    sha256: asString(record.sha256) || undefined,
  };
}

export function parseOrphanModelFile(value: unknown): OrphanModelFile {
  const record = asRecord(value);
  return {
    filename: asString(record.filename),
    path: asString(record.path),
    sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : 0,
  };
}

export function parseAuditEvent(value: unknown): LocalAiAuditEvent {
  const record = asRecord(value);
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : undefined;
  const source = asString(record.source || payload?.source) || undefined;
  const modality = asString(record.modality || payload?.modality) || undefined;
  const reasonCode = asString(record.reasonCode || payload?.reasonCode) || undefined;
  const detail = asString(record.detail || payload?.detail || payload?.error) || undefined;
  return {
    id: asString(record.id),
    eventType: asString(record.eventType),
    occurredAt: asString(record.occurredAt),
    source,
    modality,
    reasonCode,
    detail,
    modelId: asString(record.modelId) || undefined,
    localModelId: asString(record.localModelId) || undefined,
    payload,
  };
}

export function normalizeDownloadState(
  value: unknown,
  fallbackDone?: boolean,
  fallbackSuccess?: boolean,
): LocalAiDownloadState {
  const raw = asString(value).toLowerCase();
  if (
    raw === 'queued'
    || raw === 'running'
    || raw === 'paused'
    || raw === 'failed'
    || raw === 'completed'
    || raw === 'cancelled'
  ) {
    return raw;
  }
  if (fallbackDone) {
    return fallbackSuccess ? 'completed' : 'failed';
  }
  return 'running';
}

export function parseDownloadProgressEvent(value: unknown): LocalAiDownloadProgressEvent {
  const record = asRecord(value);
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  const done = Boolean(record.done);
  const success = Boolean(record.success);
  const retryable = typeof record.retryable === 'boolean' ? Boolean(record.retryable) : undefined;
  return {
    installSessionId: asString(record.installSessionId),
    modelId: asString(record.modelId),
    localModelId: asString(record.localModelId) || undefined,
    phase: asString(record.phase) || 'download',
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: asString(record.message) || undefined,
    state: normalizeDownloadState(record.state, done, success),
    reasonCode: asString(record.reasonCode) || undefined,
    retryable,
    done,
    success,
  };
}

export function parseDownloadSessionSummary(value: unknown): LocalAiDownloadSessionSummary {
  const record = asRecord(value);
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  return {
    installSessionId: asString(record.installSessionId),
    modelId: asString(record.modelId),
    localModelId: asString(record.localModelId),
    phase: asString(record.phase) || 'download',
    state: normalizeDownloadState(record.state),
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: asString(record.message) || undefined,
    reasonCode: asString(record.reasonCode) || undefined,
    retryable: Boolean(record.retryable),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

export function parseInstallAcceptedResponse(value: unknown): LocalAiInstallAcceptedResponse {
  const record = asRecord(value);
  return {
    installSessionId: asString(record.installSessionId),
    modelId: asString(record.modelId),
    localModelId: asString(record.localModelId),
  };
}
