import {
  isNimiLocalAppAgentSelectorMismatchError,
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
/** Match a fresh handle by the App-scoped durable hint, then authorize the
 * existing anchor once. The hint never authorizes access or selects by name. */
export async function resolveDesktopAgentSessionRebind(
  target: AgentLocalTargetSnapshot,
  clients: DesktopAgentSessionRebindClients,
): Promise<AgentLocalTargetSnapshot | null> {
  const staleAgentHandle = normalizeText(target.agentHandle);
  const conversationAnchorId = normalizeText(target.conversationAnchorId);
  const binding = normalizeText(target.agentBinding);
  if (!staleAgentHandle || !conversationAnchorId || !binding) return null;

  const references = await clients.agents.listReferences();
  if (references.some((reference) => reference.agentHandle === staleAgentHandle)) {
    return null;
  }

  const matches = references.filter(reference => reference.agentBinding === binding);
  if (matches.length !== 1) return null;
  const reference = matches[0]!;
  try {
    const snapshot = await clients.conversation.snapshot({agentHandle: reference.agentHandle, conversationAnchorId});
    if (snapshot.conversationAnchorId !== conversationAnchorId) return null;
  } catch (error) {
    if (isNimiLocalAppAgentSelectorMismatchError(error) || normalizeText(extractNimiErrorFields(error).reasonCode) === 'LOCAL_APP_RECORD_NOT_FOUND') return null;
    throw error;
  }
  return {
    ...target,
    agentHandle: reference.agentHandle,
    agentBinding: reference.agentBinding,
    conversationAnchorId,
    displayName: reference.displayName,
    avatarUrl: reference.avatarUrl,
  };
}
