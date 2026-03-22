import type { RealmModel, RealmServiceResult } from '../generated/type-helpers.js';
import type { Realm } from '../client.js';
import { createNimiError } from '../../runtime/errors.js';
import { normalizeText } from '../../internal/utils.js';
import { ReasonCode } from '../../types/index.js';

type MutationCommitActorRef = {
  actorId: string;
  actorType: string;
  role?: string;
};

type MutationCommitEvidenceRef = {
  kind: string;
  refId: string;
  uri?: string;
};

export type AgentMemoryCommitEnvelope = {
  worldId: string;
  appId: string;
  sessionId: string;
  effectClass: 'MEMORY_ONLY';
  scope: 'WORLD';
  schemaId: string;
  schemaVersion: string;
  actorRefs: MutationCommitActorRef[];
  reason: string;
  evidenceRefs?: MutationCommitEvidenceRef[];
};

export type AgentMemorySliceInput = {
  agentId: string;
  limit?: number;
};

export type AgentMemoryListInput = AgentMemorySliceInput & {
  userId: string;
};

export type AgentMemoryCommitInput = {
  agentId: string;
  commit: AgentMemoryCommitEnvelope;
  type: 'PUBLIC_SHARED' | 'WORLD_SHARED' | 'DYADIC';
  content: string;
  userId?: string;
  worldId?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
};

export type AgentMemoryRecord = RealmModel<'AgentMemoryRecordDto'>;
export type AgentMemoryCommitOutput = RealmServiceResult<'AgentsService', 'agentControllerCommitMemory'>;
export type AgentMemoryProfileListOutput = RealmServiceResult<'AgentsService', 'agentControllerListUserProfiles'>;

function requireId(value: unknown, fieldName: 'agentId' | 'userId'): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `agent memory request requires ${fieldName}`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: fieldName === 'agentId' ? 'provide_agent_id' : 'provide_user_id',
      source: 'sdk',
    });
  }
  return normalized;
}

function requireCommitEnvelope(input: AgentMemoryCommitEnvelope): AgentMemoryCommitEnvelope {
  const worldId = normalizeText(input.worldId);
  const appId = normalizeText(input.appId);
  const sessionId = normalizeText(input.sessionId);
  const schemaId = normalizeText(input.schemaId);
  const schemaVersion = normalizeText(input.schemaVersion);
  const reason = normalizeText(input.reason);

  if (!worldId || !appId || !sessionId || !schemaId || !schemaVersion || !reason) {
    throw createNimiError({
      message: 'agent memory commit requires a complete commit envelope',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_memory_commit',
      source: 'sdk',
    });
  }

  if (!Array.isArray(input.actorRefs) || input.actorRefs.length === 0) {
    throw createNimiError({
      message: 'agent memory commit requires actorRefs',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_memory_commit',
      source: 'sdk',
    });
  }

  const actorRefs = input.actorRefs.map((actor) => {
    const actorId = normalizeText(actor.actorId);
    const actorType = normalizeText(actor.actorType);
    const role = normalizeText(actor.role);
    if (!actorId || !actorType) {
      throw createNimiError({
        message: 'agent memory commit actor refs require actorId and actorType',
        reasonCode: ReasonCode.ACTION_INPUT_INVALID,
        actionHint: 'provide_memory_commit',
        source: 'sdk',
      });
    }
    return {
      actorId,
      actorType,
      ...(role ? { role } : {}),
    };
  });

  if (input.evidenceRefs !== undefined && !Array.isArray(input.evidenceRefs)) {
    throw createNimiError({
      message: 'agent memory commit evidence refs must be an array when provided',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_memory_commit',
      source: 'sdk',
    });
  }

  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? input.evidenceRefs.map((evidence) => {
      const kind = normalizeText(evidence.kind);
      const refId = normalizeText(evidence.refId);
      const uri = normalizeText(evidence.uri);
      if (!kind || !refId) {
        throw createNimiError({
          message: 'agent memory commit evidence refs require kind and refId',
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide_memory_commit',
          source: 'sdk',
        });
      }
      return {
        kind,
        refId,
        ...(uri ? { uri } : {}),
      };
    })
    : undefined;

  return {
    worldId,
    appId,
    sessionId,
    effectClass: 'MEMORY_ONLY',
    scope: 'WORLD',
    schemaId,
    schemaVersion,
    actorRefs,
    reason,
    ...(evidenceRefs ? { evidenceRefs } : {}),
  };
}

export async function listAgentCoreMemories(
  realm: Realm,
  input: AgentMemorySliceInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'agentId');
  return realm.services.AgentsService.agentControllerListCoreMemories(agentId, input.limit);
}

export async function listAgentDyadicMemories(
  realm: Realm,
  input: AgentMemoryListInput,
): Promise<AgentMemoryRecord[]> {
  const agentId = requireId(input.agentId, 'agentId');
  const userId = requireId(input.userId, 'userId');
  return realm.services.AgentsService.agentControllerListDyadicMemories(agentId, userId, input.limit);
}

export async function listAgentMemoryProfiles(
  realm: Realm,
  input: AgentMemorySliceInput,
): Promise<AgentMemoryProfileListOutput> {
  const agentId = requireId(input.agentId, 'agentId');
  return realm.services.AgentsService.agentControllerListUserProfiles(agentId);
}

export async function commitAgentMemories(
  realm: Realm,
  input: AgentMemoryCommitInput,
): Promise<AgentMemoryCommitOutput> {
  const agentId = requireId(input.agentId, 'agentId');
  const commit = requireCommitEnvelope(input.commit);
  const content = normalizeText(input.content);
  if (!content) {
    throw createNimiError({
      message: 'agent memory commit requires content',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_memory_content',
      source: 'sdk',
    });
  }
  return realm.services.AgentsService.agentControllerCommitMemory(agentId, {
    commit,
    type: input.type,
    content,
    userId: normalizeText(input.userId) || undefined,
    worldId: normalizeText(input.worldId) || undefined,
    importance: input.importance,
    metadata: input.metadata,
  });
}
