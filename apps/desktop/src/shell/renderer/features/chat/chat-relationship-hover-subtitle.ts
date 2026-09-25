import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import {
  readCharacterSourceRefV3,
  type CharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';
import { fetchLocalAgentList } from '../agents/local-agent-list-model';
import {
  fetchSourceDisplayDetail,
  sourceDisplayDetailQueryKey,
} from '../source-detail/source-detail-queries.js';
import { resolveWorldCharacterHeroSubtitle } from './chat-agent-empty-state-character-presence.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Sidebar agent references deliberately carry no source identity, so the hover
// card joins owner-scope surfaces read-only: the local agent list's resolved
// source context keyed by the desktop agent reference handle. Any per-agent
// miss fails closed and simply drops that entry.
async function resolveAgentSourceRefsByHandle(
  ownerUserId: string,
  sdk: DesktopRendererSdkPort,
): Promise<Readonly<Record<string, CharacterSourceRefV3>>> {
  const agents = await fetchLocalAgentList(ownerUserId, sdk);
  const entries = await Promise.all(agents.map(async (agent) => {
    const reference = await sdk.accountProduct().agents.resolveDesktopAgentReference({
      localAgentRef: agent.localAgentRef,
    }).then((result) => result.reference).catch(() => null);
    const agentHandle = normalizeText(reference?.agentHandle);
    return agentHandle ? ([agentHandle, agent.sourceRef] as const) : null;
  }));
  const byHandle: Record<string, CharacterSourceRefV3> = {};
  for (const entry of entries) {
    if (entry) {
      byHandle[entry[0]] = entry[1];
    }
  }
  return byHandle;
}

// Resolves the same hero subtitle line the agent chat header shows (for
// example "元代 · 权威的书画鉴赏家与艺术家") for an agent relationship target.
// Returns null for non-agent targets and whenever no character source detail
// resolves, so the card keeps its current layout.
export function useRelationshipHoverCardSubtitle(input: {
  target: ConversationTargetSummary;
  enabled: boolean;
}): string | null {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore((state) => state.auth.status);
  const ownerUserId = useAppStore((state) => normalizeText(state.auth.user?.id));
  const { target } = input;
  const isAgent = target.source === 'agent';
  const agentHandle = isAgent ? normalizeText(target.metadata?.agentHandle) : '';
  const metadataSourceRef = isAgent ? readCharacterSourceRefV3(target.metadata?.sourceRef) : null;
  const enabled = input.enabled && isAgent && authStatus === 'authenticated' && Boolean(ownerUserId);

  const sourceRefByHandleQuery = useQuery({
    queryKey: ['desktop-agent-source-ref-by-handle', ownerUserId],
    queryFn: () => resolveAgentSourceRefsByHandle(ownerUserId, bindings.sdk),
    enabled: enabled && !metadataSourceRef && Boolean(agentHandle),
    staleTime: 60_000,
  });
  const sourceRef = metadataSourceRef
    ?? (agentHandle ? sourceRefByHandleQuery.data?.[agentHandle] ?? null : null);

  const detailQuery = useQuery({
    queryKey: sourceRef
      ? sourceDisplayDetailQueryKey(sourceRef)
      : ['source-display-detail', 'missing-character-source-ref-v3'],
    queryFn: async () => (sourceRef ? fetchSourceDisplayDetail(sourceRef, bindings.sdk) : null),
    enabled: enabled && Boolean(sourceRef),
    staleTime: 30_000,
  });
  const source = detailQuery.data?.source ?? null;
  return useMemo(
    () => (source && source.sourceKind === 'worldCharacter'
      ? resolveWorldCharacterHeroSubtitle(source, t)
      : null),
    [source, t],
  );
}
