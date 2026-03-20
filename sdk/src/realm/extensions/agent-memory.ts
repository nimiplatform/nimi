import type { RealmModel, RealmServiceResult } from '../generated/type-helpers.js';
import type { Realm } from '../client.js';

export type AgentMemorySliceInput = {
  agentId: string;
  limit?: number;
};

export type AgentEntityMemorySliceInput = AgentMemorySliceInput & {
  entityId: string;
};

export type AgentMemoryRecallInput = {
  agentId: string;
  entityId: string;
  query?: string;
  limit?: number;
};

export type AgentMemoryRecord = RealmModel<'AgentMemoryRecordDto'>;
export type AgentMemoryRecallOutput = RealmServiceResult<'AgentsService', 'agentControllerRecallForEntity'>;

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

export async function listAgentCoreMemories(
  realm: Realm,
  input: AgentMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'AGENT_MEMORY_AGENT_ID_REQUIRED');
  return realm.services.AgentsService.agentControllerListCoreMemories(agentId, input.limit);
}

export async function listAgentE2EMemories(
  realm: Realm,
  input: AgentEntityMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'AGENT_MEMORY_AGENT_ID_REQUIRED');
  const entityId = requireId(input.entityId, 'AGENT_MEMORY_ENTITY_ID_REQUIRED');
  return realm.services.AgentsService.agentControllerListE2EMemories(agentId, entityId, input.limit);
}

export async function recallAgentMemoriesForEntity(
  realm: Realm,
  input: AgentMemoryRecallInput,
): Promise<AgentMemoryRecallOutput> {
  const agentId = requireId(input.agentId, 'AGENT_MEMORY_AGENT_ID_REQUIRED');
  const entityId = requireId(input.entityId, 'AGENT_MEMORY_ENTITY_ID_REQUIRED');
  return realm.services.AgentsService.agentControllerRecallForEntity(
    agentId,
    entityId,
    input.limit,
    normalizeText(input.query) || undefined,
  );
}
