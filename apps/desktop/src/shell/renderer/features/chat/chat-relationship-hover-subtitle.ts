import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentIntroduction } from '@nimiplatform/kit/features/chat/runtime';
import { agentIntroductionSubtitle, type ConversationTargetSummary } from '@nimiplatform/kit/features/chat/headless';
import type { NimiLocalAppAgentIntroductionClient } from '@nimiplatform/sdk/app';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';

export function useRelationshipHoverCardSubtitle(input: { target: ConversationTargetSummary; enabled: boolean }): string | null {
  const { i18n } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore(state => state.auth.status);
  const handle = input.target.source === 'agent' ? input.target.metadata?.agentHandle : null;
  const getIntroduction = useCallback<NimiLocalAppAgentIntroductionClient['getIntroduction']>(request => bindings.sdk.appProduct().agents.getIntroduction(request), [bindings.sdk]);
  const { introduction } = useAgentIntroduction({ agentHandle: input.enabled && authStatus === 'authenticated' && typeof handle === 'string' ? handle : null, getIntroduction });
  return agentIntroductionSubtitle(introduction, i18n.resolvedLanguage ?? i18n.language);
}
