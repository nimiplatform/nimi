import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  LocalRuntimeAuditEvent,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeModelRecord,
  LocalRuntimeModelStatus,
  LocalRuntimeModelsHealthResult,
  LocalRuntimeVerifiedModelDescriptor,
} from './local-ai-types.js';

export function parseLocalRuntimeModelRecord(value: unknown): LocalRuntimeModelRecord {
  const record = assertRecord(value, 'local_runtime returned invalid model payload');
  const source = assertRecord(record.source, 'local_runtime model source is invalid');
  const hashes = assertRecord(record.hashes || {}, 'local_runtime model hashes is invalid');
  const rawCapabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  const files = Array.isArray(record.files)
    ? record.files.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const knownTotalSizeBytes = Number(record.knownTotalSizeBytes);
  const statusValue = String(record.status || '').trim();
  const normalizedStatus: LocalRuntimeModelStatus = (
    statusValue === 'active'
    || statusValue === 'unhealthy'
    || statusValue === 'removed'
  )
    ? statusValue
    : 'installed';

  return {
    localModelId: parseRequiredString(record.localModelId, 'localModelId', 'local_runtime model'),
    modelId: parseRequiredString(record.modelId, 'modelId', 'local_runtime model'),
    capabilities: rawCapabilities.map((capability) => String(capability || '').trim()).filter(Boolean),
    engine: parseRequiredString(record.engine, 'engine', 'local_runtime model'),
    entry: parseRequiredString(record.entry, 'entry', 'local_runtime model'),
    files,
    license: parseRequiredString(record.license, 'license', 'local_runtime model'),
    source: {
      repo: parseRequiredString(source.repo, 'source.repo', 'local_runtime model'),
      revision: parseRequiredString(source.revision, 'source.revision', 'local_runtime model'),
    },
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hashValue]) => [String(key), String(hashValue || '').trim()]),
    ),
    tags,
    knownTotalSizeBytes: Number.isFinite(knownTotalSizeBytes) && knownTotalSizeBytes > 0
      ? knownTotalSizeBytes
      : undefined,
    endpoint: parseRequiredString(record.endpoint, 'endpoint', 'local_runtime model'),
    status: normalizedStatus,
    installedAt: parseRequiredString(record.installedAt, 'installedAt', 'local_runtime model'),
    updatedAt: parseRequiredString(record.updatedAt, 'updatedAt', 'local_runtime model'),
    healthDetail: parseOptionalString(record.healthDetail),
  };
}

export function parseLocalRuntimeVerifiedModelDescriptor(value: unknown): LocalRuntimeVerifiedModelDescriptor {
  const record = assertRecord(value, 'local_runtime_models_verified_list returned invalid payload');
  const hashes = assertRecord(record.hashes || {}, 'local_runtime_models_verified_list hashes is invalid');
  const files = Array.isArray(record.files)
    ? record.files.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const fileCountRaw = Number(record.fileCount);
  const totalSizeBytesRaw = Number(record.totalSizeBytes);
  return {
    templateId: parseRequiredString(record.templateId, 'templateId', 'local_runtime_models_verified_list'),
    title: parseRequiredString(record.title, 'title', 'local_runtime_models_verified_list'),
    description: String(record.description || '').trim(),
    installKind: parseRequiredString(record.installKind, 'installKind', 'local_runtime_models_verified_list'),
    modelId: parseRequiredString(record.modelId, 'modelId', 'local_runtime_models_verified_list'),
    repo: parseRequiredString(record.repo, 'repo', 'local_runtime_models_verified_list'),
    revision: parseRequiredString(record.revision, 'revision', 'local_runtime_models_verified_list'),
    capabilities,
    engine: parseRequiredString(record.engine, 'engine', 'local_runtime_models_verified_list'),
    entry: parseRequiredString(record.entry, 'entry', 'local_runtime_models_verified_list'),
    files,
    license: parseRequiredString(record.license, 'license', 'local_runtime_models_verified_list'),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hashValue]) => [String(key), String(hashValue || '').trim()]),
    ),
    endpoint: parseRequiredString(record.endpoint, 'endpoint', 'local_runtime_models_verified_list'),
    fileCount: Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? fileCountRaw : files.length,
    totalSizeBytes: Number.isFinite(totalSizeBytesRaw) && totalSizeBytesRaw > 0 ? totalSizeBytesRaw : undefined,
    tags,
  };
}

export function parseLocalRuntimeVerifiedModelDescriptorList(value: unknown): LocalRuntimeVerifiedModelDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalRuntimeVerifiedModelDescriptor(item));
}

export function parseLocalRuntimeModelRecordList(value: unknown): LocalRuntimeModelRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalRuntimeModelRecord(item));
}

export function parseLocalRuntimeModelsHealthResult(value: unknown): LocalRuntimeModelsHealthResult {
  const record = assertRecord(value, 'local_runtime_models_health returned invalid payload');
  const rows = Array.isArray(record.models) ? record.models : [];
  return {
    models: rows.map((item) => {
      const row = assertRecord(item, 'local_runtime_models_health model payload is invalid');
      const statusValue = String(row.status || '').trim();
      const status: LocalRuntimeModelStatus = (
        statusValue === 'active'
        || statusValue === 'unhealthy'
        || statusValue === 'removed'
      )
        ? statusValue
        : 'installed';
      return {
        localModelId: parseRequiredString(row.localModelId, 'localModelId', 'local_runtime_models_health'),
        status,
        detail: String(row.detail || '').trim(),
        endpoint: String(row.endpoint || '').trim(),
      };
    }),
  };
}

export function parseLocalRuntimeAuditEvent(value: unknown): LocalRuntimeAuditEvent {
  const record = assertRecord(value, 'local_runtime_audits_list returned invalid payload');
  const payload = parseOptionalJsonObject(record.payload);
  const source = parseOptionalString(record.source || payload?.source);
  const modality = parseOptionalString(record.modality || payload?.modality);
  const reasonCode = parseOptionalString(record.reasonCode || payload?.reasonCode);
  const detail = parseOptionalString(record.detail || payload?.detail || payload?.error);
  return {
    id: parseRequiredString(record.id, 'id', 'local_runtime_audits_list'),
    eventType: parseRequiredString(record.eventType, 'eventType', 'local_runtime_audits_list'),
    occurredAt: parseRequiredString(record.occurredAt, 'occurredAt', 'local_runtime_audits_list'),
    source,
    modality,
    reasonCode,
    detail,
    modelId: parseOptionalString(record.modelId),
    localModelId: parseOptionalString(record.localModelId),
    payload,
  };
}

export function parseLocalRuntimeAuditEventList(value: unknown): LocalRuntimeAuditEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalRuntimeAuditEvent(item));
}

export function parseLocalRuntimePickManifestResult(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function parseLocalRuntimeDownloadProgressEvent(value: unknown): LocalRuntimeDownloadProgressEvent {
  const record = assertRecord(value, 'local-ai://download-progress returned invalid payload');
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  const done = Boolean(record.done);
  const success = Boolean(record.success);
  const stateRaw = parseOptionalString(record.state)?.toLowerCase();
  const state = (
    stateRaw === 'queued'
    || stateRaw === 'running'
    || stateRaw === 'paused'
    || stateRaw === 'failed'
    || stateRaw === 'completed'
    || stateRaw === 'cancelled'
  )
    ? stateRaw
    : (done ? (success ? 'completed' : 'failed') : 'running');
  return {
    installSessionId: parseRequiredString(record.installSessionId, 'installSessionId', 'local-ai://download-progress'),
    modelId: parseRequiredString(record.modelId, 'modelId', 'local-ai://download-progress'),
    localModelId: parseOptionalString(record.localModelId),
    phase: parseRequiredString(record.phase, 'phase', 'local-ai://download-progress'),
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: parseOptionalString(record.message),
    state,
    reasonCode: parseOptionalString(record.reasonCode),
    retryable: typeof record.retryable === 'boolean' ? Boolean(record.retryable) : undefined,
    done,
    success,
  };
}
