import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createNimiRuntimeAgentConsumeClient } from '@nimiplatform/sdk/runtime';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { useAppStore, type AuthStatus } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import type { DesktopRendererSdkPort } from '../../renderer/sdk-port.js';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';
import {
  characterSourceRefKey,
  type CharacterSourceRefV3,
} from '../realm-source/realm-source-identity.js';
import {
  fetchLocalAgentList,
  localAgentListQueryKey,
  type LocalAgentListItem,
} from './local-agent-list-model';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Resolves the Realm character source behind the active App-plane conversation.
// The protected App plane deliberately never exposes source identity, so Desktop
// joins its owner-scope surfaces instead: the active target's Conversation anchor
// id (one continuity token shared across Desktop and local-app surfaces) is
// matched against owner-scope conversation summaries, and the owning LocalAgent's
// already-resolved ready source context yields the character sourceRef. Any miss
// fails closed to null.
export async function resolveActiveConversationSourceRef(input: {
  conversationAnchorId: string;
  agents: readonly LocalAgentListItem[];
  ownerUserId: string;
  sdk: DesktopRendererSdkPort;
}): Promise<CharacterSourceRefV3 | null> {
  const consume = createNimiRuntimeAgentConsumeClient({
    runtimeAppId: input.sdk.appId(),
    runtime: { agents: input.sdk.accountProduct().agents },
  });
  for (const agent of input.agents) {
    const result = await input.sdk.withRuntimeProtectedScopes(
      ['runtime.agent.read'],
      (callOptions) => consume.anchors.listSummaries({
        ownerUserId: input.ownerUserId,
        runtimeSourceRef: agent.runtimeSourceRef,
        localAgentRef: agent.localAgentRef,
        statusFilter: ['active'],
        pageSize: 10,
      }, callOptions),
    );
    const matched = result.summaries.some((summary) => (
      normalizeText(summary.anchor?.conversationAnchorId) === input.conversationAnchorId
    ));
    if (matched) {
      return agent.sourceRef;
    }
  }
  return null;
}

// Resolves the character source behind a sidebar agent target on demand. The
// App-plane reference list deliberately carries no source identity, so the
// click path opens the canonical Conversation (idempotent) to obtain the
// shared anchor token, then runs the same owner-scope anchor join as the
// active conversation resolution above. Any miss fails closed to null.
export async function resolveAgentTargetSourceRef(input: {
  agentHandle: string;
  ownerUserId: string;
  sdk: DesktopRendererSdkPort;
}): Promise<CharacterSourceRefV3 | null> {
  const agentHandle = normalizeText(input.agentHandle);
  const ownerUserId = normalizeText(input.ownerUserId);
  if (!agentHandle || !ownerUserId) {
    return null;
  }
  const opened = await input.sdk.conversation().open({
    agentHandle: agentHandle as NimiLocalAppAgentHandle,
  });
  const conversationAnchorId = normalizeText(opened.conversationAnchorId);
  if (!conversationAnchorId) {
    return null;
  }
  const agents = await fetchLocalAgentList(ownerUserId, input.sdk);
  if (agents.length === 0) {
    return null;
  }
  return resolveActiveConversationSourceRef({
    conversationAnchorId,
    agents,
    ownerUserId,
    sdk: input.sdk,
  });
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r197
// Desktop resolves the selected owner's current-session handle without opening
// unrelated conversations. The ordinary App reference projection stays opaque.
export async function resolveAgentTargetSnapshotForSourceRef(input: {
  sourceRef: CharacterSourceRefV3;
  ownerUserId: string;
  sdk: DesktopRendererSdkPort;
}): Promise<AgentLocalTargetSnapshot | null> {
  const ownerUserId = normalizeText(input.ownerUserId);
  if (!ownerUserId) {
    return null;
  }
  const sourceKey = characterSourceRefKey(input.sourceRef);
  const agents = (await fetchLocalAgentList(ownerUserId, input.sdk))
    .filter((agent) => agent.sourceKey === sourceKey);
  if (agents.length !== 1) {
    return null;
  }
  const agent = agents[0]!;
  const { reference } = await input.sdk.accountProduct().agents.resolveDesktopAgentReference({
    localAgentRef: agent.localAgentRef,
  });
  if (!reference?.agentHandle) return null;
  const opened = await input.sdk.conversation().open({
    agentHandle: reference.agentHandle as NimiLocalAppAgentHandle,
  });
  const conversationAnchorId = normalizeText(opened.conversationAnchorId);
  if (!conversationAnchorId) return null;
  return {
    agentHandle: reference.agentHandle,
    conversationAnchorId,
    displayName: normalizeText(reference.displayName) || agent.displayName,
    handle: '',
    avatarUrl: reference.avatarUrl ?? null,
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  };
}

export function useActiveAgentConversationSourceRef(input: {
  activeTarget: AgentLocalTargetSnapshot | null;
  authStatus: AuthStatus;
}): CharacterSourceRefV3 | null {
  const bindings = useDesktopRendererBindings();
  const ownerUserId = useAppStore((state) => normalizeText(state.auth.user?.id));
  const conversationAnchorId = normalizeText(input.activeTarget?.conversationAnchorId);
  const enabled = input.authStatus === 'authenticated'
    && Boolean(ownerUserId)
    && Boolean(conversationAnchorId);
  const localAgentListQuery = useQuery({
    queryKey: localAgentListQueryKey(ownerUserId),
    queryFn: async () => fetchLocalAgentList(ownerUserId, bindings.sdk),
    enabled,
    staleTime: 15_000,
  });
  const agents = useMemo(
    () => localAgentListQuery.data ?? [],
    [localAgentListQuery.data],
  );
  const resolutionQuery = useQuery({
    queryKey: ['agent-active-conversation-source', ownerUserId, conversationAnchorId],
    queryFn: async () => resolveActiveConversationSourceRef({
      conversationAnchorId,
      agents,
      ownerUserId,
      sdk: bindings.sdk,
    }),
    enabled: enabled && agents.length > 0,
    staleTime: 30_000,
  });
  return resolutionQuery.data ?? null;
}
