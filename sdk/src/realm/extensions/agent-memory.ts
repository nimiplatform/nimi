import type { Realm } from '../client.js';

export type AgentMemorySliceInput = {
  agentId: string;
  limit?: number;
  offset?: number;
};

export type AgentEntityMemorySliceInput = AgentMemorySliceInput & {
  entityId: string;
};

export type AgentMemoryRecallInput = {
  agentId: string;
  entityId: string;
  queryText?: string;
  topK?: number;
};

export type AgentMemoryRecord = Record<string, unknown>;
export type AgentMemoryRecallOutput = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function requireId(value: unknown, errorCode: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(errorCode);
  }
  return normalized;
}

function toRecordArray(value: unknown): AgentMemoryRecord[] {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as AgentMemoryRecord);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.items)) {
      return toRecordArray(record.items);
    }
    if (Array.isArray(record.data)) {
      return toRecordArray(record.data);
    }
  }
  return [];
}

function buildSliceQuery(input: AgentMemorySliceInput): Record<string, number> | undefined {
  const query: Record<string, number> = {};
  if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
    query.limit = Math.floor(input.limit);
  }
  if (typeof input.offset === 'number' && Number.isFinite(input.offset)) {
    query.offset = Math.floor(input.offset);
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

function buildRecallQuery(input: AgentMemoryRecallInput): Record<string, string | number> | undefined {
  const query: Record<string, string | number> = {};
  if (typeof input.topK === 'number' && Number.isFinite(input.topK)) {
    query.topK = Math.floor(input.topK);
    query.limit = Math.floor(input.topK);
  }
  const queryText = normalizeText(input.queryText);
  if (queryText) {
    query.queryText = queryText;
    query.query = queryText;
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

// Explicit codegen-gap adapter: the OpenAPI surface omits these query params.
export async function listAgentCoreMemories(
  realm: Realm,
  input: AgentMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'AGENT_MEMORY_AGENT_ID_REQUIRED');
  const payload = await realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(agentId)}/memory/core`,
    query: buildSliceQuery(input),
  });
  return toRecordArray(payload);
}

// Explicit codegen-gap adapter: the OpenAPI surface omits these query params.
export async function listAgentE2EMemories(
  realm: Realm,
  input: AgentEntityMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'AGENT_MEMORY_AGENT_ID_REQUIRED');
  const entityId = requireId(input.entityId, 'AGENT_MEMORY_ENTITY_ID_REQUIRED');
  const payload = await realm.raw.request<unknown>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(agentId)}/memory/e2e/${encodeURIComponent(entityId)}`,
    query: buildSliceQuery(input),
  });
  return toRecordArray(payload);
}

// Explicit codegen-gap adapter: the OpenAPI surface omits these query params.
export async function recallAgentMemoriesForEntity(
  realm: Realm,
  input: AgentMemoryRecallInput,
): Promise<AgentMemoryRecallOutput> {
  const agentId = requireId(input.agentId, 'AGENT_MEMORY_AGENT_ID_REQUIRED');
  const entityId = requireId(input.entityId, 'AGENT_MEMORY_ENTITY_ID_REQUIRED');
  const payload = await realm.raw.request<AgentMemoryRecallOutput>({
    method: 'GET',
    path: `/api/agent/accounts/${encodeURIComponent(agentId)}/memory/recall/${encodeURIComponent(entityId)}`,
    query: buildRecallQuery(input),
  });
  return payload && typeof payload === 'object' ? payload : {};
}
