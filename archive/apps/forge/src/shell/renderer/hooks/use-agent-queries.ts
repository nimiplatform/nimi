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
  type ForgeAgentSoulPrimePayload,
  type ForgeCreatorAgentListItem,
  type ForgeCreatorKeyListItem,
} from '@renderer/data/agent-data-client.js';
import { listWorldResourceBindings } from '@renderer/data/world-data-client.js';
import {
  AGENT_DELIVERABLE_REGISTRY,
  type AgentDeliverableFamily,
} from '@renderer/features/asset-ops/deliverable-registry.js';

type AgentSoulPrimePayload = ForgeAgentSoulPrimePayload;
type AgentListPayload = Awaited<ReturnType<typeof listCreatorAgents>>;
type AgentDetailPayload = Awaited<ReturnType<typeof getAgent>>;
type CreatorKeyListPayload = Awaited<ReturnType<typeof listCreatorKeys>>;
type WorldResourceBindingsPayload = Awaited<ReturnType<typeof listWorldResourceBindings>>;

type BindingRecord = {
  id: string | null;
  hostId: string | null;
  hostType: string | null;
  bindingPoint: string | null;
  bindingKind: string | null;
  objectId: string | null;
  objectType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  priority: number | null;
};

export type DeliverableCurrentState = 'MISSING' | 'PRESENT' | 'BOUND';
type DeliverableOpsState = 'MISSING' | 'BOUND';
type CompletenessState = 'MISSING' | 'PARTIAL' | 'COMPLETE';

export type AgentDeliverableStatus = {
  family: AgentDeliverableFamily;
  label: string;
  required: boolean;
  currentState: DeliverableCurrentState;
  opsState: DeliverableOpsState;
  source: 'DIRECT_FIELD' | 'WORLD_BINDING';
  bindingPoint: string | null;
  objectId: string | null;
  value: string | null;
};

export type DeliverableCompletenessSummary = {
  requiredFamilyCount: number;
  currentReadyCount: number;
  opsReadyCount: number;
  boundCount: number;
  unverifiedCount: number;
  missingCount: number;
  currentState: CompletenessState;
  opsState: CompletenessState;
};

export type DeliverableFamilyCoverageSummary = {
  currentReadyCount: number;
  opsReadyCount: number;
  boundCount: number;
  unverifiedCount: number;
  missingCount: number;
};

export type WorldOwnedAgentRosterItem = AgentSummary & {
  description: string | null;
  scenario: string | null;
  greeting: string | null;
  deliverables: AgentDeliverableStatus[];
  completeness: DeliverableCompletenessSummary;
};

export type WorldOwnedAgentRosterSummary = {
  worldId: string;
  agentCount: number;
  currentCompleteCount: number;
  opsCompleteCount: number;
  missingRequiredFamilyCount: number;
  unverifiedRequiredFamilyCount: number;
  familyCoverage: Record<AgentDeliverableFamily, DeliverableFamilyCoverageSummary>;
};

export type WorldOwnedAgentRoster = {
  worldId: string;
  items: WorldOwnedAgentRosterItem[];
  summary: WorldOwnedAgentRosterSummary;
};

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

function toObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toBindingRecordList(payload: WorldResourceBindingsPayload): BindingRecord[] {
  const root = toObjectRecord(payload);
  const items = Array.isArray(root?.items) ? root.items : [];
  return items
    .map((entry) => {
      const item = toObjectRecord(entry);
      if (!item) {
        return null;
      }
      const priority =
        typeof item.priority === 'number'
          ? item.priority
          : Number.isFinite(Number(item.priority))
            ? Number(item.priority)
            : null;
      return {
        id: toStringOrNull(item.id),
        hostId: toStringOrNull(item.hostId),
        hostType: toStringOrNull(item.hostType),
        bindingPoint: toStringOrNull(item.bindingPoint),
        bindingKind: toStringOrNull(item.bindingKind),
        objectId: toStringOrNull(item.objectId),
        objectType: toStringOrNull(item.objectType),
        createdAt: toStringOrNull(item.createdAt),
        updatedAt: toStringOrNull(item.updatedAt),
        priority,
      } satisfies BindingRecord;
    })
    .filter((item): item is BindingRecord => item !== null);
}

function compareBindingPriority(left: BindingRecord, right: BindingRecord): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
  return leftPriority - rightPriority
    || (right.updatedAt || '').localeCompare(left.updatedAt || '')
    || (right.createdAt || '').localeCompare(left.createdAt || '')
    || (right.id || '').localeCompare(left.id || '');
}

function findBinding(
  bindings: BindingRecord[],
  input: {
    hostId: string;
    hostType: 'WORLD' | 'AGENT';
    bindingPoint: string;
  },
): BindingRecord | null {
  return bindings
    .filter((item) =>
      item.hostId === input.hostId
      && item.hostType === input.hostType
      && item.bindingPoint === input.bindingPoint
      && item.bindingKind === 'PRESENTATION',
    )
    .sort(compareBindingPriority)[0] ?? null;
}

function toCompletenessState(readyCount: number, requiredFamilyCount: number): CompletenessState {
  if (requiredFamilyCount <= 0 || readyCount <= 0) {
    return 'MISSING';
  }
  if (readyCount >= requiredFamilyCount) {
    return 'COMPLETE';
  }
  return 'PARTIAL';
}

function summarizeDeliverables(deliverables: AgentDeliverableStatus[]): DeliverableCompletenessSummary {
  const requiredFamilies = deliverables.filter((item) => item.required);
  const requiredFamilyCount = requiredFamilies.length;
  const currentReadyCount = requiredFamilies.filter((item) => item.currentState !== 'MISSING').length;
  const opsReadyCount = requiredFamilies.filter((item) => item.opsState !== 'MISSING').length;
  const boundCount = requiredFamilies.filter((item) => item.currentState === 'BOUND').length;
  const unverifiedCount = requiredFamilies.filter((item) => item.currentState !== 'MISSING' && item.opsState === 'MISSING').length;
  const missingCount = requiredFamilies.filter((item) => item.currentState === 'MISSING').length;
  return {
    requiredFamilyCount,
    currentReadyCount,
    opsReadyCount,
    boundCount,
    unverifiedCount,
    missingCount,
    currentState: toCompletenessState(currentReadyCount, requiredFamilyCount),
    opsState: toCompletenessState(opsReadyCount, requiredFamilyCount),
  };
}

function summarizeFamilyCoverage(
  items: WorldOwnedAgentRosterItem[],
  family: AgentDeliverableFamily,
): DeliverableFamilyCoverageSummary {
  const familyItems = items
    .map((item) => item.deliverables.find((deliverable) => deliverable.family === family))
    .filter((item): item is AgentDeliverableStatus => item !== undefined);
  return {
    currentReadyCount: familyItems.filter((item) => item.currentState !== 'MISSING').length,
    opsReadyCount: familyItems.filter((item) => item.opsState !== 'MISSING').length,
    boundCount: familyItems.filter((item) => item.currentState === 'BOUND').length,
    unverifiedCount: familyItems.filter((item) => item.currentState !== 'MISSING' && item.opsState === 'MISSING').length,
    missingCount: familyItems.filter((item) => item.currentState === 'MISSING').length,
  };
}

function toBindingDeliverableStatus(input: {
  family: AgentDeliverableFamily;
  label: string;
  required: boolean;
  bindingPoint: string;
  hostId: string;
  bindings: BindingRecord[];
}): AgentDeliverableStatus {
  const binding = findBinding(input.bindings, {
    hostId: input.hostId,
    hostType: 'AGENT',
    bindingPoint: input.bindingPoint,
  });
  return {
    family: input.family,
    label: input.label,
    required: input.required,
    currentState: binding ? 'BOUND' : 'MISSING',
    opsState: binding ? 'BOUND' : 'MISSING',
    source: 'WORLD_BINDING',
    bindingPoint: input.bindingPoint,
    objectId: binding?.objectId ?? null,
    value: binding?.objectId ?? null,
  };
}

function toDirectDeliverableStatus(input: {
  family: AgentDeliverableFamily;
  label: string;
  required: boolean;
  value: string | null;
}): AgentDeliverableStatus {
  return {
    family: input.family,
    label: input.label,
    required: input.required,
    currentState: input.value ? 'PRESENT' : 'MISSING',
    opsState: 'MISSING',
    source: 'DIRECT_FIELD',
    bindingPoint: null,
    objectId: null,
    value: input.value,
  };
}

function buildAgentDeliverables(item: AgentDetailPayload, bindings: BindingRecord[]): AgentDeliverableStatus[] {
  return AGENT_DELIVERABLE_REGISTRY.map((entry) => {
    switch (entry.family) {
      case 'agent-avatar':
        return toDirectDeliverableStatus({
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          value: item.avatarUrl,
        });
      case 'agent-cover':
        return toBindingDeliverableStatus({
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          bindingPoint: 'AGENT_PORTRAIT',
          hostId: item.id,
          bindings,
        });
      case 'agent-greeting-primary':
        return toDirectDeliverableStatus({
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          value: item.greeting,
        });
      case 'agent-voice-demo':
        return toBindingDeliverableStatus({
          family: entry.family,
          label: entry.label,
          required: entry.requiredForPublish,
          bindingPoint: 'AGENT_VOICE_SAMPLE',
          hostId: item.id,
          bindings,
        });
    }
  });
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

function toWorldOwnedAgentRoster(
  worldId: string,
  agentSummaries: AgentSummary[],
  agentDetails: AgentDetailPayload[],
  bindingsPayload: WorldResourceBindingsPayload,
): WorldOwnedAgentRoster {
  const bindings = toBindingRecordList(bindingsPayload);
  const detailById = new Map(agentDetails.map((item) => [item.id, item]));
  const items = agentSummaries
    .filter((item) => item.worldId === worldId)
    .map((summary) => {
      const detail = detailById.get(summary.id);
      const deliverables = buildAgentDeliverables(
        detail ?? {
          ...summary,
          description: null,
          scenario: null,
          greeting: null,
          state: '',
          dna: null,
          rules: null,
          wakeStrategy: 'PASSIVE',
        },
        bindings,
      );
      return {
        ...summary,
        description: detail?.description ?? null,
        scenario: detail?.scenario ?? null,
        greeting: detail?.greeting ?? null,
        deliverables,
        completeness: summarizeDeliverables(deliverables),
      } satisfies WorldOwnedAgentRosterItem;
    });

  const familyCoverage = AGENT_DELIVERABLE_REGISTRY.reduce<Record<AgentDeliverableFamily, DeliverableFamilyCoverageSummary>>((acc, entry) => {
    acc[entry.family] = summarizeFamilyCoverage(items, entry.family);
    return acc;
  }, {} as Record<AgentDeliverableFamily, DeliverableFamilyCoverageSummary>);

  return {
    worldId,
    items,
    summary: {
      worldId,
      agentCount: items.length,
      currentCompleteCount: items.filter((item) => item.completeness.currentState === 'COMPLETE').length,
      opsCompleteCount: items.filter((item) => item.completeness.opsState === 'COMPLETE').length,
      missingRequiredFamilyCount: items.reduce((sum, item) => sum + item.completeness.missingCount, 0),
      unverifiedRequiredFamilyCount: items.reduce((sum, item) => sum + item.completeness.unverifiedCount, 0),
      familyCoverage,
    },
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

export function useWorldOwnedAgentRosterQuery(worldId: string, enabled = true) {
  return useQuery({
    queryKey: ['forge', 'world', 'agents-roster', worldId],
    enabled: enabled && Boolean(worldId),
    retry: false,
    queryFn: async (): Promise<WorldOwnedAgentRoster> => {
      const agentSummaries = toAgentSummaryList(await listCreatorAgents());
      const worldAgents = agentSummaries.filter((item) => item.worldId === worldId);
      const [agentDetails, bindings] = await Promise.all([
        Promise.all(worldAgents.map(async (item) => await getAgent(item.id))),
        listWorldResourceBindings(worldId),
      ]);
      return toWorldOwnedAgentRoster(worldId, agentSummaries, agentDetails, bindings);
    },
  });
}

export function useAgentSoulPrimeQuery(worldId: string, agentId: string) {
  return useQuery({
    queryKey: ['forge', 'agents', 'soul-prime', worldId, agentId],
    enabled: Boolean(worldId) && Boolean(agentId),
    retry: false,
    queryFn: async (): Promise<AgentSoulPrimePayload> => await getAgentSoulPrime(worldId, agentId),
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
