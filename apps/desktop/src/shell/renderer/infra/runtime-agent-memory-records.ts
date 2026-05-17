import {
  MemoryCanonicalClass,
  type CanonicalMemoryView,
} from '@nimiplatform/sdk/runtime';

export type DesktopAgentMemoryRecord = {
  actorRefs: Array<Record<string, never>>;
  appId: string;
  commitId: string;
  id: string;
  content: string;
  createdAt: string;
  createdBy: string;
  effectClass: 'MEMORY_ONLY';
  importance: number;
  reason: string;
  schemaId: string;
  schemaVersion: string;
  sessionId: string;
  type: 'PUBLIC_SHARED' | 'WORLD_SHARED' | 'DYADIC';
  userId: string | null;
  worldId: string | null;
  metadata: Record<string, unknown> | undefined;
};

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampToIso(timestamp?: { seconds: string; nanos: number }): string {
  if (!timestamp) {
    return EPOCH_ISO;
  }
  const seconds = Number(timestamp.seconds);
  const nanos = Number(timestamp.nanos);
  if (!Number.isFinite(seconds)) {
    return EPOCH_ISO;
  }
  const millis = seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  if (!Number.isFinite(millis)) {
    return EPOCH_ISO;
  }
  return new Date(millis).toISOString();
}

function requireCanonicalType(value: MemoryCanonicalClass): DesktopAgentMemoryRecord['type'] {
  switch (value) {
    case MemoryCanonicalClass.DYADIC:
      return 'DYADIC';
    case MemoryCanonicalClass.WORLD_SHARED:
      return 'WORLD_SHARED';
    case MemoryCanonicalClass.PUBLIC_SHARED:
    default:
      return 'PUBLIC_SHARED';
  }
}

export function summarizeCanonicalMemoryView(view: CanonicalMemoryView): string {
  const payload = view.record?.payload;
  switch (payload?.oneofKind) {
    case 'observational':
      return normalizeText(payload.observational.observation);
    case 'episodic':
      return normalizeText(payload.episodic.summary);
    case 'semantic':
      return [
        normalizeText(payload.semantic.subject),
        normalizeText(payload.semantic.predicate),
        normalizeText(payload.semantic.object),
      ].filter(Boolean).join(' ');
    default:
      return '';
  }
}

export function canonicalMemoryViewToDesktopRecord(view: CanonicalMemoryView): DesktopAgentMemoryRecord | null {
  const memoryId = normalizeText(view.record?.memoryId);
  if (!memoryId) {
    return null;
  }

  const owner = view.sourceBank?.owner;
  const summary = summarizeCanonicalMemoryView(view);
  const canonicalType = requireCanonicalType(view.canonicalClass);
  const userId = owner?.oneofKind === 'agentDyadic'
    ? normalizeText(owner.agentDyadic.userId) || null
    : null;
  const worldId = owner?.oneofKind === 'worldShared'
    ? normalizeText(owner.worldShared.worldId) || null
    : null;

  return {
    actorRefs: [],
    appId: normalizeText(view.record?.provenance?.sourceSystem) || 'runtime.agent',
    commitId: memoryId,
    id: memoryId,
    content: summary,
    createdAt: timestampToIso(view.record?.createdAt || view.record?.updatedAt),
    createdBy: normalizeText(view.record?.provenance?.authorId) || 'runtime.agent',
    effectClass: 'MEMORY_ONLY',
    importance: 1,
    reason: normalizeText(view.policyReason) || 'runtime_agent_projection',
    schemaId: 'runtime.agent.canonical_memory',
    schemaVersion: '1',
    sessionId: normalizeText(view.record?.provenance?.traceId),
    type: canonicalType,
    userId,
    worldId,
    metadata: view.record?.metadata as Record<string, unknown> | undefined,
  };
}
