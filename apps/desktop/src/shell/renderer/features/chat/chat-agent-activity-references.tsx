import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentActivityReferences } from '@nimiplatform/kit/features/chat/runtime';
import { AgentActivityReferences } from '@nimiplatform/kit/features/chat/ui';
import type { NimiLocalAppActivityClient } from '@nimiplatform/sdk/app';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';

export function ChatAgentActivityReferences({ agentHandle }: { readonly agentHandle: string | null | undefined }) {
  const sdk = useDesktopRendererSdk();
  const { t } = useTranslation();
  const activity = useMemo<Pick<NimiLocalAppActivityClient, 'list' | 'subscribe' | 'open'>>(() => ({
    list: input => sdk.appProduct().activity.list(input),
    subscribe: input => sdk.appProduct().activity.subscribe(input),
    open: input => sdk.appProduct().activity.open(input),
  }), [sdk]);
  const listReferences = useCallback(() => sdk.appProduct().agents.listReferences(), [sdk]);
  const state = useAgentActivityReferences({ agentHandle, listReferences, activity });
  return <AgentActivityReferences {...state} copy={{
    title: t('Chat.appReferences.title'), loading: t('Chat.appReferences.loading'),
    unavailable: t('Chat.appReferences.unavailable'), incomplete: t('Chat.appReferences.incomplete'),
    open: t('Chat.appReferences.open'), opening: t('Chat.appReferences.opening'),
    openFailed: t('Chat.appReferences.openFailed'), retry: t('Chat.appReferences.retry'), more: t('Chat.appReferences.more'),
  }} />;
}
