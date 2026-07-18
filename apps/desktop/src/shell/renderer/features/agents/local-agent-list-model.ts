import {
  createNimiHostRuntimeAgentLifecycleSurface,
  isRuntimeLocalAgentRef,
  type NimiRuntimeAgentSourceContextStatus,
  type NimiRuntimeAgentSourceRef,
} from '@nimiplatform/sdk/runtime';
import {
  getDesktopHostRuntimeAgentClient,
  withDesktopRuntimeProtectedScopes,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { characterSourceRefKey } from '@renderer/features/realm-source/realm-source-identity.js';

// The Characters tab (D-SHELL-001 `agents`) projects runtime ListAgents
// authority: source-materialized LocalAgents owned by the signed-in account.
// It never persists a renderer-local agent registry.
export type LocalAgentListItem = {
  localAgentRef: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  displayName: string;
  sourceRef: NimiRuntimeAgentSourceRef;
  sourceKey: string;
};

export type LocalAgentSourceDiscoveryProjection = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly sourceKind: NimiRuntimeAgentSourceRef['kind'];
  readonly sourceWorldId: string;
  readonly sourceId: string;
  readonly sourceHash: string;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toCharacterSourceRefFromStatus(status: NimiRuntimeAgentSourceContextStatus | null | undefined): NimiRuntimeAgentSourceRef | null {
  if (status?.ready !== true || !status.sourceRef) return null;
  const worldId = normalizeText(status.sourceRef.worldId);
  const id = normalizeText(status.sourceRef.id);
  const sourceHash = normalizeText(status.sourceRef.sourceHash);
  return worldId && id && sourceHash ? status.sourceRef : null;
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
  const sourceRef = toCharacterSourceRefFromStatus(agent.sourceContextStatus);
  if (!sourceRef) return null;
  return {
    localAgentRef: String(agent.localAgentRef),
    ownerUserId,
    runtimeSourceRef,
    displayName: normalizeText(agent.displayName) || sourceRef.id,
    sourceRef,
    sourceKey: characterSourceRefKey(sourceRef),
  };
}

export function localAgentListQueryKey(ownerUserId: string) {
  return ['local-agent-list', normalizeText(ownerUserId)] as const;
}

export function toLocalAgentSourceDiscoveryProjections(
  agents: readonly LocalAgentListItem[],
  sourceRef: NimiRuntimeAgentSourceRef | null | undefined,
): LocalAgentSourceDiscoveryProjection[] {
  if (!sourceRef) {
    return [];
  }
  return agents
    .filter((agent) =>
      characterSourceRefKey(agent.sourceRef) === characterSourceRefKey(sourceRef))
    .map((agent) => ({
      ownerUserId: agent.ownerUserId,
      runtimeSourceRef: agent.runtimeSourceRef,
      localAgentRef: agent.localAgentRef,
      sourceKind: agent.sourceRef.kind,
      sourceWorldId: agent.sourceRef.worldId,
      sourceId: agent.sourceRef.id,
      sourceHash: agent.sourceRef.sourceHash,
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
