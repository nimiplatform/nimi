import { emitRuntimeLog } from '../telemetry/logger';
import type { LocalAiModelRecord, LocalAiModelStatus } from './types';
import type {
  GoRuntimeModelEntry,
  GoRuntimeSyncResult,
  GoRuntimeSyncTarget,
} from './go-runtime-sync-types';

const GO_STATUS_INSTALLED = 1;
const GO_STATUS_ACTIVE = 2;
const GO_STATUS_UNHEALTHY = 3;
const GO_STATUS_REMOVED = 4;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [String(key), String(item || '').trim()])
      .filter(([, item]) => Boolean(item)),
  );
}

export function normalizeEngine(value: unknown): string {
  return String(value || '').trim().toLowerCase() || 'localai';
}

export function parseGoStatus(value: unknown): { status: LocalAiModelStatus; raw: string; ambiguous: boolean } {
  const raw = String(value ?? '').trim();
  const numeric = Number(value);
  if (numeric === GO_STATUS_INSTALLED || raw.toLowerCase() === 'installed' || raw === 'LOCAL_MODEL_STATUS_INSTALLED') {
    return { status: 'installed', raw, ambiguous: false };
  }
  if (numeric === GO_STATUS_ACTIVE || raw.toLowerCase() === 'active' || raw === 'LOCAL_MODEL_STATUS_ACTIVE') {
    return { status: 'active', raw, ambiguous: false };
  }
  if (numeric === GO_STATUS_UNHEALTHY || raw.toLowerCase() === 'unhealthy' || raw === 'LOCAL_MODEL_STATUS_UNHEALTHY') {
    return { status: 'unhealthy', raw, ambiguous: false };
  }
  if (numeric === GO_STATUS_REMOVED || raw.toLowerCase() === 'removed' || raw === 'LOCAL_MODEL_STATUS_REMOVED') {
    return { status: 'removed', raw, ambiguous: false };
  }
  return { status: 'installed', raw, ambiguous: true };
}

export function normalizeGoStatus(value: unknown): LocalAiModelStatus {
  return parseGoStatus(value).status;
}

export function statusPriority(status: LocalAiModelStatus, raw?: string): number {
  if (status === 'active') return 0;
  if (status === 'unhealthy') return 1;
  if (status === 'installed') {
    return String(raw || '').trim() === '' || String(raw || '').trim() === '0' ? 3 : 2;
  }
  if (status === 'removed') return 4;
  return 5;
}

export function parseGoRuntimeModelEntry(value: unknown): GoRuntimeModelEntry {
  const record = asRecord(value);
  const source = asRecord(record.source);
  const parsedStatus = parseGoStatus(record.status);
  if (parsedStatus.ambiguous) {
    emitRuntimeLog({
      level: 'warn',
      area: 'local-ai-runtime-sync',
      message: 'phase:go-runtime-status:ambiguous',
      details: {
        localModelId: String(record.localModelId || '').trim(),
        modelId: String(record.modelId || '').trim(),
        rawStatus: parsedStatus.raw || record.status,
      },
    });
  }
  return {
    localModelId: String(record.localModelId || '').trim(),
    modelId: String(record.modelId || '').trim(),
    engine: normalizeEngine(record.engine),
    status: parsedStatus.status,
    statusRaw: parsedStatus.raw,
    endpoint: String(record.endpoint || '').trim(),
    capabilities: normalizeStringArray(record.capabilities),
    entry: String(record.entry || '').trim(),
    license: String(record.license || '').trim(),
    source: {
      repo: String(source.repo || '').trim(),
      revision: String(source.revision || '').trim(),
    },
    hashes: normalizeStringMap(record.hashes),
    installedAt: String(record.installedAt || '').trim(),
    updatedAt: String(record.updatedAt || '').trim(),
    healthDetail: String(record.healthDetail || '').trim() || undefined,
    engineConfig: asRecord(record.engineConfig),
  };
}

export function syncLookupKey(modelId: string, engine: string): string {
  return `${normalizeEngine(engine)}::${String(modelId || '').trim().toLowerCase()}`;
}

export function findGoRuntimeModel(
  models: GoRuntimeModelEntry[],
  target: GoRuntimeSyncTarget,
): { model: GoRuntimeModelEntry | null; matchedBy?: GoRuntimeSyncResult['matchedBy'] } {
  const localModelId = String(target.localModelId || '').trim();
  if (localModelId) {
    const direct = models.find((model) => model.localModelId === localModelId) || null;
    if (direct) {
      return { model: direct, matchedBy: 'localModelId' };
    }
  }

  const modelId = String(target.modelId || '').trim();
  if (!modelId) {
    return { model: null };
  }

  const engine = normalizeEngine(target.engine);
  const matched = models
    .filter((model) => syncLookupKey(model.modelId, model.engine) === syncLookupKey(modelId, engine))
    .sort((left, right) => {
      const priorityDelta = statusPriority(left.status, left.statusRaw) - statusPriority(right.status, right.statusRaw);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return String(left.localModelId || '').localeCompare(String(right.localModelId || ''));
    })[0] || null;
  if (!matched || matched.status === 'removed') {
    return { model: null };
  }
  return { model: matched, matchedBy: 'modelId+engine' };
}

export function findDesktopModel(models: LocalAiModelRecord[], target: GoRuntimeSyncTarget): LocalAiModelRecord | null {
  const localModelId = String(target.localModelId || '').trim();
  if (localModelId) {
    const direct = models.find((model) => String(model.localModelId || '').trim() === localModelId) || null;
    if (direct) {
      return direct;
    }
  }
  const modelId = String(target.modelId || '').trim();
  if (!modelId) {
    return null;
  }
  const engine = normalizeEngine(target.engine);
  return models.find((model) => syncLookupKey(model.modelId, model.engine) === syncLookupKey(modelId, engine)) || null;
}

export function toDesktopLocalModelRecord(model: GoRuntimeModelEntry): LocalAiModelRecord {
  return {
    localModelId: model.localModelId,
    modelId: model.modelId,
    capabilities: [...(model.capabilities || [])],
    engine: model.engine,
    entry: model.entry,
    license: model.license,
    source: {
      repo: model.source?.repo || '',
      revision: model.source?.revision || '',
    },
    hashes: { ...(model.hashes || {}) },
    endpoint: model.endpoint,
    status: model.status,
    installedAt: model.installedAt,
    updatedAt: model.updatedAt,
    healthDetail: model.healthDetail,
    engineConfig: model.engineConfig ? { ...model.engineConfig } : undefined,
  };
}
