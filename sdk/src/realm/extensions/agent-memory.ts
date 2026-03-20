import type { RealmModel, RealmServiceResult } from '../generated/type-helpers.js';
import type { Realm } from '../client.js';
import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';

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

function requireId(value: unknown, fieldName: 'agentId' | 'entityId'): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `agent memory request requires ${fieldName}`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: fieldName === 'agentId' ? 'provide_agent_id' : 'provide_entity_id',
      source: 'sdk',
    });
  }
  return normalized;
}

export async function listAgentCoreMemories(
  realm: Realm,
  input: AgentMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'agentId');
  return realm.services.AgentsService.agentControllerListCoreMemories(agentId, input.limit);
}

export async function listAgentE2EMemories(
  realm: Realm,
  input: AgentEntityMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'agentId');
  const entityId = requireId(input.entityId, 'entityId');
  return realm.services.AgentsService.agentControllerListE2EMemories(agentId, entityId, input.limit);
}

export async function recallAgentMemoriesForEntity(
  realm: Realm,
  input: AgentMemoryRecallInput,
): Promise<AgentMemoryRecallOutput> {
  const agentId = requireId(input.agentId, 'agentId');
  const entityId = requireId(input.entityId, 'entityId');
  return realm.services.AgentsService.agentControllerRecallForEntity(
    agentId,
    entityId,
    input.limit,
    normalizeText(input.query) || undefined,
  );
}
