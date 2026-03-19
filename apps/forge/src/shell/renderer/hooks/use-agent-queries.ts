/**
 * Forge Agent Resource Queries (FG-AGENT-001)
 */

import { useQuery } from '@tanstack/react-query';
import {
  listCreatorAgents,
  getAgent,
  getAgentSoulPrime,
  listCreatorKeys,
  type ForgeAgentDetailResponse,
  type ForgeCreatorAgentListItem,
  type ForgeCreatorKeyListItem,
} from '@renderer/data/agent-data-client.js';

type AgentSoulPrimePayload = Awaited<ReturnType<typeof getAgentSoulPrime>>;
type AgentListPayload = Awaited<ReturnType<typeof listCreatorAgents>>;
type AgentDetailPayload = Awaited<ReturnType<typeof getAgent>>;
type CreatorKeyListPayload = Awaited<ReturnType<typeof listCreatorKeys>>;

export type AgentSummary = {
  id: string;
  handle: string;
  displayName: string;
  concept: string;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED';
  worldId: string | null;
  status: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentDetail = {
  id: string;
  handle: string;
  displayName: string;
  concept: string;
  description: string | null;
  scenario: string | null;
  greeting: string | null;
  ownershipType: 'MASTER_OWNED' | 'WORLD_OWNED';
  worldId: string | null;
  status: string;
  state: string;
  avatarUrl: string | null;
  dna: ForgeAgentDetailResponse['dna'] | null;
  rules: { format: string; lines: string[]; text: string } | null;
  wakeStrategy: 'PASSIVE' | 'PROACTIVE';
  createdAt: string;
  updatedAt: string;
};

export type CreatorKeyItem = {
  id: string;
  name: string;
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

function toAgentSummaryList(payload: AgentListPayload): AgentSummary[] {
  const items: ForgeCreatorAgentListItem[] = payload.items;
  return items
    .map((item) => ({
      id: item.id,
      handle: item.handle,
      displayName: item.displayName,
      concept: item.concept,
      ownershipType: item.ownershipType,
      worldId: item.worldId,
      status: item.status,
      avatarUrl: item.avatarUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
    .filter((item) => Boolean(item.id));
}

function toAgentDetail(item: AgentDetailPayload): AgentDetail {
  const rulesRaw = item.rules;
  return {
    id: item.id,
    handle: item.handle,
    displayName: item.displayName,
    concept: item.concept,
    description: item.description,
    scenario: item.scenario,
    greeting: item.greeting,
    ownershipType: item.ownershipType,
    worldId: item.worldId,
    status: item.status,
    state: item.state,
    avatarUrl: item.avatarUrl,
    dna: item.dna ?? null,
    rules: rulesRaw
      ? {
          format: rulesRaw.format,
          lines: rulesRaw.lines,
          text: rulesRaw.text,
        }
      : null,
    wakeStrategy: item.wakeStrategy,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function toKeyList(payload: CreatorKeyListPayload): CreatorKeyItem[] {
  const items: ForgeCreatorKeyListItem[] = payload.items;
  return items
    .map((item) => ({
      id: item.id,
      name: item.name,
      keyPreview: item.keyPreview,
      createdAt: item.createdAt,
      lastUsedAt: item.lastUsedAt,
      expiresAt: item.expiresAt,
    }))
    .filter((item) => Boolean(item.id));
}

// ── Hooks ──────────────────────────────────────────────────

export function useAgentListQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'agents', 'list'],
    enabled,
    retry: false,
    queryFn: async () => toAgentSummaryList(await listCreatorAgents()),
  });
}

export function useAgentDetailQuery(agentId: string) {
  return useQuery({
    queryKey: ['forge', 'agents', 'detail', agentId],
    enabled: Boolean(agentId),
    retry: false,
    queryFn: async () => toAgentDetail(await getAgent(agentId)),
  });
}

export function useAgentSoulPrimeQuery(agentId: string) {
  return useQuery({
    queryKey: ['forge', 'agents', 'soul-prime', agentId],
    enabled: Boolean(agentId),
    retry: false,
    queryFn: async (): Promise<AgentSoulPrimePayload> => await getAgentSoulPrime(agentId),
  });
}

export function useCreatorKeysQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'creator', 'keys'],
    enabled,
    retry: false,
    queryFn: async () => toKeyList(await listCreatorKeys()),
  });
}
