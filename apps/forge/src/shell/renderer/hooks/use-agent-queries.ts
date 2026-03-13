/**
 * Forge Agent Resource Queries (FG-AGENT-001)
 */

import { useQuery } from '@tanstack/react-query';
import {
  listCreatorAgents,
  getAgent,
  getAgentSoulPrime,
  listCreatorKeys,
} from '@renderer/data/agent-data-client.js';

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

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
  dna: Record<string, unknown> | null;
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

function toAgentSummaryList(payload: unknown): AgentSummary[] {
  const record = toRecord(payload);
  const items = Array.isArray(record.items) ? (record.items as unknown[]) : [];
  return items
    .map((item) => toRecord(item))
    .map((item) => ({
      id: String(item.id || ''),
      handle: String(item.handle || ''),
      displayName: String(item.displayName || item.name || ''),
      concept: String(item.concept || ''),
      ownershipType: (String(item.ownershipType || 'MASTER_OWNED') === 'WORLD_OWNED' ? 'WORLD_OWNED' : 'MASTER_OWNED') as AgentSummary['ownershipType'],
      worldId: item.worldId ? String(item.worldId) : null,
      status: String(item.status || 'draft'),
      avatarUrl: item.avatarUrl ? String(item.avatarUrl) : null,
      createdAt: String(item.createdAt || ''),
      updatedAt: String(item.updatedAt || ''),
    }))
    .filter((item) => Boolean(item.id));
}

function toAgentDetail(payload: unknown): AgentDetail {
  const item = toRecord(payload);
  const rulesRaw = item.rules && typeof item.rules === 'object' ? toRecord(item.rules) : null;
  return {
    id: String(item.id || ''),
    handle: String(item.handle || ''),
    displayName: String(item.displayName || item.name || ''),
    concept: String(item.concept || ''),
    description: item.description ? String(item.description) : null,
    scenario: item.scenario ? String(item.scenario) : null,
    greeting: item.greeting ? String(item.greeting) : null,
    ownershipType: (String(item.ownershipType || 'MASTER_OWNED') === 'WORLD_OWNED' ? 'WORLD_OWNED' : 'MASTER_OWNED') as AgentDetail['ownershipType'],
    worldId: item.worldId ? String(item.worldId) : null,
    status: String(item.status || 'draft'),
    state: String(item.state || 'INCUBATING'),
    avatarUrl: item.avatarUrl ? String(item.avatarUrl) : null,
    dna: item.dna && typeof item.dna === 'object' ? toRecord(item.dna) : null,
    rules: rulesRaw
      ? {
          format: String(rulesRaw.format || 'rule-lines-v1'),
          lines: Array.isArray(rulesRaw.lines) ? rulesRaw.lines.map((l: unknown) => String(l || '')) : [],
          text: String(rulesRaw.text || ''),
        }
      : null,
    wakeStrategy: String(item.wakeStrategy || 'PASSIVE') === 'PROACTIVE' ? 'PROACTIVE' : 'PASSIVE',
    createdAt: String(item.createdAt || ''),
    updatedAt: String(item.updatedAt || ''),
  };
}

function toKeyList(payload: unknown): CreatorKeyItem[] {
  const record = toRecord(payload);
  const items = Array.isArray(record.items) ? (record.items as unknown[]) : (Array.isArray(payload) ? (payload as unknown[]) : []);
  return items
    .map((item) => toRecord(item))
    .map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || 'Unnamed Key'),
      keyPreview: String(item.keyPreview || item.key || '****'),
      createdAt: String(item.createdAt || ''),
      lastUsedAt: item.lastUsedAt ? String(item.lastUsedAt) : null,
      expiresAt: item.expiresAt ? String(item.expiresAt) : null,
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
    queryFn: async () => toRecord(await getAgentSoulPrime(agentId)),
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
