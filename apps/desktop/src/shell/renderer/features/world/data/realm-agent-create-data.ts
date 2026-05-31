import type { Realm } from '@nimiplatform/sdk/realm';
import { callRealmApi } from '@renderer/infra/realm/realm-api';

type RealmAgentCreateApiCaller = <T>(task: (realm: Realm) => Promise<T>, fallbackMessage?: string) => Promise<T>;

export type CreateMasterAgentInput = {
  worldId: string;
  handle: string;
  concept: string;
  displayName?: string;
  description?: string;
  referenceImageUrl?: string;
  dnaPrimary?: 'CARING' | 'PLAYFUL' | 'INTELLECTUAL' | 'CONFIDENT' | 'MYSTERIOUS' | 'ROMANTIC';
  dnaSecondary?: Array<'HUMOROUS' | 'SARCASTIC' | 'GENTLE' | 'DIRECT' | 'OPTIMISTIC' | 'REALISTIC' | 'DRAMATIC' | 'PASSIONATE' | 'REBELLIOUS' | 'INNOCENT' | 'WISE' | 'ECCENTRIC'>;
};

export async function createMasterAgent(
  callApi: RealmAgentCreateApiCaller,
  input: CreateMasterAgentInput,
): Promise<Record<string, unknown>> {
  const result = await callApi(
    (realm) => realm.services.CreatorService.creatorControllerCreateAgent({
      handle: input.handle.trim(),
      concept: input.concept.trim(),
      displayName: input.displayName?.trim() || undefined,
      description: input.description?.trim() || undefined,
      referenceImageUrl: input.referenceImageUrl?.trim() || undefined,
      dnaPrimary: input.dnaPrimary,
      dnaSecondary: input.dnaSecondary?.length ? input.dnaSecondary : undefined,
      ownershipType: 'MASTER_OWNED',
      worldId: input.worldId,
    }),
    '创建 Agent 失败',
  );
  return (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
}

let inflightCreatorAgents: Promise<Record<string, unknown>[]> | null = null;

export async function loadCreatorAgents(
  callApi: RealmAgentCreateApiCaller,
): Promise<Record<string, unknown>[]> {
  if (inflightCreatorAgents) return inflightCreatorAgents;
  const task = loadCreatorAgentsInternal(callApi).finally(() => { inflightCreatorAgents = null; });
  inflightCreatorAgents = task;
  return task;
}

async function loadCreatorAgentsInternal(
  callApi: RealmAgentCreateApiCaller,
): Promise<Record<string, unknown>[]> {
  const agents = await callApi(
    (realm) => realm.services.CreatorService.creatorControllerListAgents(),
    '加载我的 Agent 列表失败',
  );
  return Array.isArray(agents)
    ? agents.map((agent) => (agent && typeof agent === 'object' ? { ...(agent as Record<string, unknown>) } : {}))
    : [];
}

export const realmAgentCreateData = {
  createAgent: (input: CreateMasterAgentInput) =>
    createMasterAgent(callRealmApi, input),
  loadMyAgents: () =>
    loadCreatorAgents(callRealmApi),
};
