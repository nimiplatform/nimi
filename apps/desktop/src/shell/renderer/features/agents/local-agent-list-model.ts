import {
  fromNimiRuntimeProtoStruct,
  isRuntimeLocalAgentRef,
} from '@nimiplatform/sdk/runtime';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import {
  getDesktopRuntime,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { realmSourceRefKey } from '@renderer/features/explore/realm-persona-source-materialization';

// The Characters tab (D-SHELL-001 `agents`) projects runtime ListAgents
// authority: source-materialized LocalAgents owned by the signed-in account.
// It never persists a renderer-local agent registry.
export type LocalAgentListItem = {
  localAgentRef: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  displayName: string;
  sourceRef: NimiRealmCoreSourceRef;
  sourceKey: string;
};

export type LocalAgentSourceDiscoveryProjection = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly sourceKind: NimiRealmCoreSourceRef['kind'];
  readonly sourceWorldId: string;
  readonly sourceId: string;
  readonly sourceContentHash: string;
};

const LIST_PAGE_SIZE = 200;
const LIST_MAX_PAGES = 10;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toCoreSourceRefFromMaterialization(value: unknown): NimiRealmCoreSourceRef | null {
  const record = readRecord(value);
  if (!record) return null;
  const kind = normalizeText(record.sourceKind);
  if (kind !== 'worldCharacter' && kind !== 'realmPersona') return null;
  const worldId = normalizeText(record.sourceWorldId);
  const sourceId = normalizeText(record.sourceId);
  const sourceContentHash = normalizeText(record.sourceContentHash);
  if (!worldId || !sourceId || !sourceContentHash) return null;
  return {
    kind,
    worldId,
    sourceId,
    sourceContentHash,
  };
}

type RuntimeAgentRecordLike = {
  readonly displayName?: string;
  readonly localAgentRef?: string;
  readonly metadata?: Parameters<typeof fromNimiRuntimeProtoStruct>[0];
  readonly ownerUserId?: string;
  readonly runtimeSourceRef?: string;
};

export function toLocalAgentListItem(
  agent: RuntimeAgentRecordLike,
  currentUserId: string,
): LocalAgentListItem | null {
  const ownerUserId = normalizeText(agent.ownerUserId);
  if (!ownerUserId || ownerUserId !== currentUserId) return null;
  if (!isRuntimeLocalAgentRef(agent.localAgentRef)) return null;
  const runtimeSourceRef = normalizeText(agent.runtimeSourceRef);
  if (!runtimeSourceRef) return null;
  const metadata = fromNimiRuntimeProtoStruct(agent.metadata);
  const sourceRef = toCoreSourceRefFromMaterialization(metadata.sourceMaterialization);
  if (!sourceRef) return null;
  return {
    localAgentRef: String(agent.localAgentRef),
    ownerUserId,
    runtimeSourceRef,
    displayName: normalizeText(agent.displayName) || sourceRef.sourceId,
    sourceRef,
    sourceKey: realmSourceRefKey(sourceRef),
  };
}

export function localAgentListQueryKey(ownerUserId: string) {
  return ['local-agent-list', normalizeText(ownerUserId)] as const;
}

export function toLocalAgentSourceDiscoveryProjections(
  agents: readonly LocalAgentListItem[],
  sourceRef: NimiRealmCoreSourceRef | null | undefined,
): LocalAgentSourceDiscoveryProjection[] {
  if (!sourceRef) {
    return [];
  }
  return agents
    .filter((agent) =>
      agent.sourceRef.kind === sourceRef.kind
      && agent.sourceRef.worldId === sourceRef.worldId
      && agent.sourceRef.sourceId === sourceRef.sourceId
      && agent.sourceRef.sourceContentHash === sourceRef.sourceContentHash)
    .map((agent) => ({
      ownerUserId: agent.ownerUserId,
      runtimeSourceRef: agent.runtimeSourceRef,
      localAgentRef: agent.localAgentRef,
      sourceKind: agent.sourceRef.kind,
      sourceWorldId: agent.sourceRef.worldId,
      sourceId: agent.sourceRef.sourceId,
      sourceContentHash: agent.sourceRef.sourceContentHash,
    }));
}

export async function fetchLocalAgentList(ownerUserIdInput: string): Promise<LocalAgentListItem[]> {
  const ownerUserId = normalizeText(ownerUserIdInput);
  if (!ownerUserId) {
    return [];
  }
  const itemsByRef = new Map<string, LocalAgentListItem>();
  let pageToken = '';
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const response = await withDesktopRuntimeProtectedScopes(
      ['runtime.agent.read'],
      (callOptions) => getDesktopRuntime().agents.listAgents({
        lifecycleFilter: AgentLifecycleStatus.ACTIVE,
        pageSize: LIST_PAGE_SIZE,
        pageToken,
      }, callOptions),
    );
    for (const agent of response.agents || []) {
      const item = toLocalAgentListItem(agent, ownerUserId);
      if (item) {
        itemsByRef.set(item.localAgentRef, item);
      }
    }
    pageToken = normalizeText(response.nextPageToken);
    if (!pageToken) break;
  }
  return [...itemsByRef.values()].sort(
    (left, right) => left.displayName.localeCompare(right.displayName),
  );
}
