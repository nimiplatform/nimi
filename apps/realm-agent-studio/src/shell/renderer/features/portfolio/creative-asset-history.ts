export type CreativeAssetHistoryKind =
  | 'runtime-image-candidate'
  | 'identity-resource-upload'
  | 'voice-demo-candidate';

export type CreativeAssetHistoryRecord = {
  id: string;
  agentId: string;
  kind: CreativeAssetHistoryKind;
  label: string;
  createdAt: string;
  source: string;
  publicTruth: false;
  detail: string;
  resourceId?: string;
  artifactIds?: string[];
  traceId?: string;
};

type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const HISTORY_LIMIT = 20;
const HISTORY_PREFIX = 'realm-agent-studio.creative-asset-history.';

function historyKey(agentId: string): string {
  return `${HISTORY_PREFIX}${agentId}`;
}

function isHistoryKind(value: string): value is CreativeAssetHistoryKind {
  return value === 'runtime-image-candidate'
    || value === 'identity-resource-upload'
    || value === 'voice-demo-candidate';
}

function normalizeRecord(value: unknown, agentId: string): CreativeAssetHistoryRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === 'string' && isHistoryKind(record.kind) ? record.kind : null;
  const id = typeof record.id === 'string' && record.id.trim() ? record.id : null;
  const label = typeof record.label === 'string' && record.label.trim() ? record.label : null;
  const createdAt = typeof record.createdAt === 'string' && record.createdAt.trim() ? record.createdAt : null;
  const source = typeof record.source === 'string' && record.source.trim() ? record.source : null;
  const detail = typeof record.detail === 'string' && record.detail.trim() ? record.detail : null;

  if (!kind || !id || !label || !createdAt || !source || !detail || record.publicTruth !== false) {
    return null;
  }

  const resourceId = typeof record.resourceId === 'string' && record.resourceId.trim() ? record.resourceId : undefined;
  const traceId = typeof record.traceId === 'string' && record.traceId.trim() ? record.traceId : undefined;
  const artifactIds = Array.isArray(record.artifactIds)
    ? record.artifactIds.filter((artifactId): artifactId is string => typeof artifactId === 'string' && artifactId.trim().length > 0)
    : undefined;

  return {
    id,
    agentId,
    kind,
    label,
    createdAt,
    source,
    publicTruth: false,
    detail,
    ...(resourceId ? { resourceId } : {}),
    ...(artifactIds && artifactIds.length > 0 ? { artifactIds } : {}),
    ...(traceId ? { traceId } : {}),
  };
}

function resolveStorage(storage?: LocalStorageLike | null): LocalStorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export function loadLocalCreativeAssetHistory(agentId: string, storage?: LocalStorageLike | null): CreativeAssetHistoryRecord[] {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) {
    return [];
  }

  try {
    const raw = targetStorage.getItem(historyKey(agentId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.flatMap((item) => {
        const normalized = normalizeRecord(item, agentId);
        return normalized ? [normalized] : [];
      }).slice(0, HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function appendLocalCreativeAssetHistory(
  agentId: string,
  record: Omit<CreativeAssetHistoryRecord, 'id' | 'agentId' | 'createdAt' | 'publicTruth'> & {
    id?: string;
    createdAt?: string;
  },
  storage?: LocalStorageLike | null,
): CreativeAssetHistoryRecord[] {
  const targetStorage = resolveStorage(storage);
  const createdAt = record.createdAt || new Date().toISOString();
  const id = record.id || `${record.kind}-${createdAt}`;
  const nextRecord: CreativeAssetHistoryRecord = {
    ...record,
    id,
    agentId,
    createdAt,
    publicTruth: false,
  };
  const current = loadLocalCreativeAssetHistory(agentId, targetStorage);
  const next = [nextRecord, ...current].slice(0, HISTORY_LIMIT);

  if (targetStorage) {
    targetStorage.setItem(historyKey(agentId), JSON.stringify(next));
  }

  return next;
}
