import { useCallback, useMemo } from 'react';
import { useAgentActivityReferences } from '@nimiplatform/kit/features/chat/runtime';
import { AgentActivityReferences } from '@nimiplatform/kit/features/chat/ui';
import type { NimiLocalAppActivityClient } from '@nimiplatform/sdk/app';
import { getZhiyuLocalAppClient } from '../auth/runtime-platform';

export function ZhiyuAgentActivityReferences({ agentHandle }: { readonly agentHandle: string | null | undefined }) {
  const activity = useMemo<Pick<NimiLocalAppActivityClient, 'list' | 'subscribe' | 'open'>>(() => ({
    list: input => getZhiyuLocalAppClient().activity.list(input),
    subscribe: input => getZhiyuLocalAppClient().activity.subscribe(input),
    open: input => getZhiyuLocalAppClient().activity.open(input),
  }), []);
  const listReferences = useCallback(() => getZhiyuLocalAppClient().agents.listReferences(), []);
  const state = useAgentActivityReferences({ agentHandle, listReferences, activity });
  return <AgentActivityReferences {...state} copy={{
    title: '与这位伙伴相关的应用消息', loading: '正在读取应用消息…',
    unavailable: '应用消息暂时不可用。', incomplete: '当前显示已读取的部分消息。',
    open: '在来源应用中查看', opening: '正在打开…',
    openFailed: '来源应用或对象暂时无法打开，请稍后重试。', retry: '重试', more: '更多应用消息',
  }} />;
}
