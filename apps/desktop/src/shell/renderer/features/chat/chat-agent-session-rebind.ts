import {
  isNimiLocalAppAgentSelectorMismatchError,
  type NimiLocalAppAgentReference,
  type NimiLocalAppAgentReferencesClient,
  type NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types';

export type DesktopAgentSessionRebindClients = {
  readonly agents: Pick<NimiLocalAppAgentReferencesClient, 'listReferences'>;
  readonly conversation: Pick<NimiLocalAppConversationClient, 'snapshot'>;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isDesktopAgentSessionBindingError(error: unknown): boolean {
  return isNimiLocalAppAgentSelectorMismatchError(error)
    || normalizeText(extractNimiErrorFields(error).reasonCode) === 'LOCAL_APP_SESSION_REVOKED';
}

// @nimi-authority: rule.nimi.desktop.agent-projection.r025
/**
 * Rebinds one active Desktop Agent target after the protected App session has
 * rotated. The durable Conversation anchor is the only selection evidence:
 * each current-session reference is checked against that anchor, and no
 * display metadata or raw owner identity participates in the match.
 */
export async function resolveDesktopAgentSessionRebind(
  target: AgentLocalTargetSnapshot,
  clients: DesktopAgentSessionRebindClients,
): Promise<AgentLocalTargetSnapshot | null> {
  const staleAgentHandle = normalizeText(target.agentHandle);
  const conversationAnchorId = normalizeText(target.conversationAnchorId);
  if (!staleAgentHandle || !conversationAnchorId) return null;

  const references = await clients.agents.listReferences();
  if (references.some((reference) => reference.agentHandle === staleAgentHandle)) {
    return null;
  }

  const matches: NimiLocalAppAgentReference[] = [];
  for (const reference of references) {
    try {
      const snapshot = await clients.conversation.snapshot({
        agentHandle: reference.agentHandle,
        conversationAnchorId,
      });
      if (snapshot.conversationAnchorId !== conversationAnchorId) {
        return null;
      }
      matches.push(reference);
    } catch (error) {
      if (!isNimiLocalAppAgentSelectorMismatchError(error)) {
        throw error;
      }
    }
  }

  if (matches.length !== 1) return null;
  const reference = matches[0]!;
  return {
    ...target,
    agentHandle: reference.agentHandle,
    conversationAnchorId,
    displayName: reference.displayName,
    avatarUrl: reference.avatarUrl,
  };
}
