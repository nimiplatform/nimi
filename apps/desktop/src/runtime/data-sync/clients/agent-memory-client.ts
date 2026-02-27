import type { MemoryStatsResponseDto, Realm } from '@nimiplatform/sdk/realm';

export type AgentMemoryRecord = Record<string, unknown>;

export type AgentMemorySliceQuery = {
  limit?: number;
  offset?: number;
};

export type AgentMemoryRecallQuery = {
  queryText?: string;
  topK?: number;
};

export type AgentMemorySliceResponse = {
  items: AgentMemoryRecord[];
  raw: unknown;
};

export type AgentMemoryRecallResponse = {
  items: AgentMemoryRecord[];
  core: AgentMemoryRecord[];
  e2e: AgentMemoryRecord[];
  raw: unknown;
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toPositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  return rounded > 0 ? rounded : undefined;
}

function toNonNegativeInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  return rounded >= 0 ? rounded : undefined;
}

function toMemoryItems(value: unknown): AgentMemoryRecord[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as AgentMemoryRecord);
  }
  const record = toRecord(value);
  if (Array.isArray(record.items)) {
    return toMemoryItems(record.items);
  }
  if (Array.isArray(record.data)) {
    return toMemoryItems(record.data);
  }
  return [];
}

function inferRecallKind(item: AgentMemoryRecord): 'core' | 'e2e' {
  const typeField = String(item.type || item.memoryType || '').trim().toUpperCase();
  if (typeField === 'E2E' || typeField === 'EPISODIC') {
    return 'e2e';
  }
  const subjectId = String(item.subjectId || item.entityId || '').trim();
  if (subjectId) {
    return 'e2e';
  }
  return 'core';
}

function toSliceQuery(query: AgentMemorySliceQuery | undefined): Record<string, number> | undefined {
  const limit = toPositiveInt(query?.limit);
  const offset = toNonNegativeInt(query?.offset);
  const next: Record<string, number> = {};
  if (typeof limit === 'number') next.limit = limit;
  if (typeof offset === 'number') next.offset = offset;
  return Object.keys(next).length > 0 ? next : undefined;
}

function toRecallQuery(query: AgentMemoryRecallQuery | undefined): Record<string, string | number> | undefined {
  const topK = toPositiveInt(query?.topK);
  const queryText = String(query?.queryText || '').trim();
  const next: Record<string, string | number> = {};
  if (queryText) {
    next.query = queryText;
    next.queryText = queryText;
  }
  if (typeof topK === 'number') {
    next.limit = topK;
    next.topK = topK;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export async function fetchAgentCoreMemorySlice(
  realm: Realm,
  input: {
    agentId: string;
    query?: AgentMemorySliceQuery;
  },
): Promise<AgentMemorySliceResponse> {
  const payload = await realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(input.agentId)}/memory/core`,
    query: toSliceQuery(input.query),
  });
  return {
    items: toMemoryItems(payload),
    raw: payload,
  };
}

export async function fetchAgentE2EMemorySlice(
  realm: Realm,
  input: {
    agentId: string;
    entityId: string;
    query?: AgentMemorySliceQuery;
  },
): Promise<AgentMemorySliceResponse> {
  const payload = await realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(input.agentId)}/memory/e2e/${encodeURIComponent(input.entityId)}`,
    query: toSliceQuery(input.query),
  });
  return {
    items: toMemoryItems(payload),
    raw: payload,
  };
}

export async function fetchAgentRecallForEntity(
  realm: Realm,
  input: {
    agentId: string;
    entityId: string;
    query?: AgentMemoryRecallQuery;
  },
): Promise<AgentMemoryRecallResponse> {
  const payload = await realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(input.agentId)}/memory/recall/${encodeURIComponent(input.entityId)}`,
    query: toRecallQuery(input.query),
  });

  const root = toRecord(payload);
  const explicitCore = toMemoryItems(root.core || root.coreMemory || root.coreMemories);
  const explicitE2E = toMemoryItems(root.e2e || root.e2eMemory || root.e2eMemories);
  if (explicitCore.length > 0 || explicitE2E.length > 0) {
    return {
      items: [...explicitCore, ...explicitE2E],
      core: explicitCore,
      e2e: explicitE2E,
      raw: payload,
    };
  }

  const inferredItems = toMemoryItems(payload);
  const core: AgentMemoryRecord[] = [];
  const e2e: AgentMemoryRecord[] = [];
  inferredItems.forEach((item) => {
    if (inferRecallKind(item) === 'e2e') {
      e2e.push(item);
      return;
    }
    core.push(item);
  });

  return {
    items: inferredItems,
    core,
    e2e,
    raw: payload,
  };
}

export async function fetchAgentMemoryStats(
  realm: Realm,
  input: {
    agentId: string;
  },
): Promise<MemoryStatsResponseDto> {
  return realm.raw.request<MemoryStatsResponseDto>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(input.agentId)}/memory/stats`,
  });
}
