import { getPlatformClient } from '@nimiplatform/sdk';
import { commitAgentMemories } from '@nimiplatform/sdk/realm';
import type { RealmServiceResult } from '@nimiplatform/sdk/realm';

type DyadicMemoryResult = RealmServiceResult<'AgentsService', 'agentControllerListDyadicMemories'>;
type DyadicMemoryDto = DyadicMemoryResult extends (infer T)[] ? T : never;

export type AgentMemoryRecord = {
  id: string;
  content: string;
  class: string;
  createdAt: string;
};

export type WriteAgentMemoryInput = {
  agentId: string;
  learnerId: string;
  worldId: string;
  sessionId: string;
  memoryText: string;
};

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected object`);
  }
  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label}: expected array`);
  }
  return value;
}

function expectString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label}.${key}: expected non-empty string`);
  }
  return value.trim();
}

function parseMemory(raw: unknown): AgentMemoryRecord {
  const record = expectObject(raw, 'agent_memory');
  return {
    id: expectString(record, 'id', 'agent_memory'),
    content: expectString(record, 'content', 'agent_memory'),
    class: expectString(record, 'class', 'agent_memory'),
    createdAt: expectString(record, 'createdAt', 'agent_memory'),
  };
}

export async function recallAgentMemory(agentId: string, learnerId: string): Promise<AgentMemoryRecord[]> {
  const result = await getPlatformClient().realm.services.AgentsService.agentControllerListDyadicMemories(agentId, learnerId);
  return expectArray(result as DyadicMemoryDto[], 'agent_memory_list').map((item) => parseMemory(item));
}

export async function writeAgentMemory(input: WriteAgentMemoryInput): Promise<void> {
  const { agentId, learnerId, worldId, sessionId, memoryText } = input;
  await commitAgentMemories(getPlatformClient().realm, {
    agentId,
    userId: learnerId,
    worldId,
    type: 'DYADIC',
    content: memoryText,
    commit: {
      worldId,
      appId: 'nimi.shiji',
      sessionId,
      effectClass: 'MEMORY_ONLY',
      scope: 'WORLD',
      schemaId: 'shiji.agent-memory',
      schemaVersion: '1',
      actorRefs: [
        { actorId: agentId, actorType: 'agent', role: 'speaker' },
        { actorId: learnerId, actorType: 'user', role: 'learner' },
      ],
      reason: 'dialogue_session_summary',
    },
  });
}
