import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  LocalRuntimeAuditEvent,
  LocalRuntimeAssetRecord,
  LocalRuntimeAssetStatus,
  LocalRuntimeAssetsHealthResult,
  LocalRuntimeVerifiedAssetDescriptor,
} from './local-ai-types.js';

function inferIntegrityModeFromRepo(repo: string): LocalRuntimeAssetRecord['integrityMode'] {
  return repo.trim().toLowerCase().startsWith('local-import/')
    ? 'local_unverified'
    : 'verified';
}

export function parseLocalRuntimeAssetRecord(value: unknown): LocalRuntimeAssetRecord {
  const record = assertRecord(value, 'local_runtime returned invalid asset payload');
  const source = assertRecord(record.source, 'local_runtime asset source is invalid');
  const hashes = assertRecord(record.hashes || {}, 'local_runtime asset hashes is invalid');
  const rawCapabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  const files = Array.isArray(record.files)
    ? record.files.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const _tags = Array.isArray(record.tags)
    ? record.tags.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const _knownTotalSizeBytes = Number(record.knownTotalSizeBytes);
  const statusValue = String(record.status || '').trim();
  const normalizedStatus: LocalRuntimeAssetStatus = (
    statusValue === 'active'
    || statusValue === 'unhealthy'
    || statusValue === 'removed'
  )
    ? statusValue
    : 'installed';

  return {
    localAssetId: parseRequiredString(record.localAssetId, 'localAssetId', 'local_runtime asset'),
    assetId: parseRequiredString(record.assetId, 'assetId', 'local_runtime asset'),
    kind: (String(record.kind || record.assetKind || 'chat').trim() || 'chat') as LocalRuntimeAssetRecord['kind'],
    capabilities: rawCapabilities.map((capability) => String(capability || '').trim()).filter(Boolean),
    engine: parseRequiredString(record.engine, 'engine', 'local_runtime asset'),
    entry: parseRequiredString(record.entry, 'entry', 'local_runtime asset'),
    files,
    license: parseRequiredString(record.license, 'license', 'local_runtime asset'),
    source: {
      repo: parseRequiredString(source.repo, 'source.repo', 'local_runtime asset'),
      revision: parseRequiredString(source.revision, 'source.revision', 'local_runtime asset'),
    },
    integrityMode: (
      String(record.integrityMode || '').trim() === 'local_unverified'
      || String(record.integrityMode || '').trim() === 'verified'
    )
      ? String(record.integrityMode || '').trim() as LocalRuntimeAssetRecord['integrityMode']
      : inferIntegrityModeFromRepo(String(source.repo || '').trim()),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hashValue]) => [String(key), String(hashValue || '').trim()]),
    ),
    status: normalizedStatus,
    installedAt: parseRequiredString(record.installedAt, 'installedAt', 'local_runtime asset'),
    updatedAt: parseRequiredString(record.updatedAt, 'updatedAt', 'local_runtime asset'),
    healthDetail: parseOptionalString(record.healthDetail),
  };
}

export function parseLocalRuntimeVerifiedAssetDescriptor(value: unknown): LocalRuntimeVerifiedAssetDescriptor {
  const record = assertRecord(value, 'local_runtime_assets_verified_list returned invalid payload');
  const hashes = assertRecord(record.hashes || {}, 'local_runtime_assets_verified_list hashes is invalid');
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
    templateId: parseRequiredString(record.templateId, 'templateId', 'local_runtime_assets_verified_list'),
    title: parseRequiredString(record.title, 'title', 'local_runtime_assets_verified_list'),
    description: String(record.description || '').trim(),
    installKind: parseOptionalString(record.installKind),
    assetId: parseRequiredString(record.assetId, 'assetId', 'local_runtime_assets_verified_list'),
    kind: (String(record.kind || record.assetKind || 'chat').trim() || 'chat') as LocalRuntimeVerifiedAssetDescriptor['kind'],
    repo: parseRequiredString(record.repo, 'repo', 'local_runtime_assets_verified_list'),
    revision: parseRequiredString(record.revision, 'revision', 'local_runtime_assets_verified_list'),
    capabilities,
    engine: parseRequiredString(record.engine, 'engine', 'local_runtime_assets_verified_list'),
    entry: parseRequiredString(record.entry, 'entry', 'local_runtime_assets_verified_list'),
    files,
    license: parseRequiredString(record.license, 'license', 'local_runtime_assets_verified_list'),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hashValue]) => [String(key), String(hashValue || '').trim()]),
    ),
    endpoint: parseOptionalString(record.endpoint),
    fileCount: Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? fileCountRaw : files.length,
    totalSizeBytes: Number.isFinite(totalSizeBytesRaw) && totalSizeBytesRaw > 0 ? totalSizeBytesRaw : undefined,
    tags,
  };
}

export function parseLocalRuntimeVerifiedAssetDescriptorList(value: unknown): LocalRuntimeVerifiedAssetDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalRuntimeVerifiedAssetDescriptor(item));
}

export function parseLocalRuntimeAssetRecordList(value: unknown): LocalRuntimeAssetRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalRuntimeAssetRecord(item));
}

export function parseLocalRuntimeAssetsHealthResult(value: unknown): LocalRuntimeAssetsHealthResult {
  const record = assertRecord(value, 'local_runtime_assets_health returned invalid payload');
  const rows = Array.isArray(record.assets) ? record.assets : [];
  return {
    assets: rows.map((item) => {
      const row = assertRecord(item, 'local_runtime_assets_health asset payload is invalid');
      const statusValue = String(row.status || '').trim();
      const status: LocalRuntimeAssetStatus = (
        statusValue === 'active'
        || statusValue === 'unhealthy'
        || statusValue === 'removed'
      )
        ? statusValue
        : 'installed';
      return {
        localAssetId: parseRequiredString(row.localAssetId, 'localAssetId', 'local_runtime_assets_health'),
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
    modelId: parseOptionalString(record.modelId || record.assetId),
    localModelId: parseOptionalString(record.localModelId || record.localAssetId),
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
