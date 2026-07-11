import {
  createNimiHostRuntimeAgentLifecycleSurface,
  isRuntimeLocalAgentRef,
  type NimiRuntimeAgentSourceContextStatus,
} from '@nimiplatform/sdk/runtime';
import type { NimiRealmCoreSourceRef } from '@nimiplatform/sdk/realm';
import {
  getDesktopHostRuntimeAgentClient,
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toCoreSourceRefFromStatus(status: NimiRuntimeAgentSourceContextStatus | null | undefined): NimiRealmCoreSourceRef | null {
  if (status?.ready !== true || !status.sourceRef) return null;
  const kind = status.sourceRef.kind;
  const worldId = normalizeText(status.sourceRef.worldId);
  const sourceId = normalizeText(status.sourceRef.sourceId);
  const sourceContentHash = normalizeText(status.sourceRef.sourceContentHash);
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
  readonly ownerUserId?: string;
  readonly runtimeSourceRef?: string;
  readonly sourceContextStatus?: NimiRuntimeAgentSourceContextStatus | null;
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
  const sourceRef = toCoreSourceRefFromStatus(agent.sourceContextStatus);
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
  const lifecycle = createNimiHostRuntimeAgentLifecycleSurface({
    getRuntime: getDesktopHostRuntimeAgentClient,
    getSubjectUserId: () => ownerUserId,
    withScopes: withDesktopRuntimeProtectedScopes,
  });
  const itemsByRef = new Map<string, LocalAgentListItem>();
  for (const agent of await lifecycle.listLocalAgents({ ownerUserId })) {
    const item = toLocalAgentListItem(agent, ownerUserId);
    if (item) {
      itemsByRef.set(item.localAgentRef, item);
    }
  }
  return [...itemsByRef.values()].sort(
    (left, right) => left.displayName.localeCompare(right.displayName),
  );
}
