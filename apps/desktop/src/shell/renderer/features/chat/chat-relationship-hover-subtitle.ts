import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { agentIntroductionSubtitle, type ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';

// An introduction read can take seconds and shares the serialized App-plane
// commands with Conversation open and send, so hovering reuses one read per
// Agent instead of queueing a new one each time the card appears.
export function useRelationshipHoverCardSubtitle(input: { target: ConversationTargetSummary; enabled: boolean }): string | null {
  const { i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore(state => state.auth.status);
  const ownerUserId = useAppStore(state => String(state.auth.user?.id || '').trim());
  const handle = input.target.source === 'agent' && typeof input.target.metadata?.agentHandle === 'string'
    ? input.target.metadata.agentHandle
    : '';
  const { data: introduction } = useQuery({
    queryKey: ['desktop-agent-introduction', ownerUserId, handle],
    queryFn: () => bindings.sdk.appProduct().agents.getIntroduction({ agentHandle: handle as NimiLocalAppAgentHandle }),
    enabled: input.enabled && authStatus === 'authenticated' && Boolean(ownerUserId) && Boolean(handle),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return agentIntroductionSubtitle(introduction ?? null, i18n.resolvedLanguage ?? i18n.language);
}
