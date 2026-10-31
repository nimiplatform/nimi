import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { RealmChatViewDto, RealmListChatsResultDto } from '@nimiplatform/kit/features/chat/realm';
import { useAppStore, type AuthStatus } from '../../app-shell/providers/app-store.js';
import { useRealmHumanChatData } from './data/realm-human-chat-data-context.js';

export function isDeletedChatPeer(peer?: RealmChatViewDto['otherUser'] | null): boolean {
  return peer?.status === 'SUSPENDED' && peer.handle === '';
}

export function useHumanChatList(authStatus: AuthStatus) {
  const { t } = useTranslation();
  const data = useRealmHumanChatData();
  const accountId = useAppStore(state => String(state.auth.user?.id || ''));
  const realm = useAppStore(state => String(state.auth.user?.realmEnvironmentId || ''));
  const query = useInfiniteQuery({
    queryKey: ['chats', realm, accountId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<RealmListChatsResultDto> => {
      const page = pageParam ? await data.loadMoreChatList(pageParam) : await data.loadChatList();
      if (!page) throw new Error('Conversation page unavailable');
      return page;
    },
    getNextPageParam: page => page.nextCursor || undefined,
    enabled: authStatus === 'authenticated' && Boolean(accountId),
    staleTime: 30_000,
  });
  const projected = useMemo(() => {
    if (!query.data) return undefined;
    const items = new Map<string, RealmChatViewDto>();
    for (const page of query.data.pages) for (const item of page.items) {
      if (!items.has(item.id)) items.set(item.id, isDeletedChatPeer(item.otherUser)
        ? { ...item, otherUser: { ...item.otherUser, displayName: t('Relationship.contacts.deletedUser') } } : item);
    }
    return { items: [...items.values()] };
  }, [query.data, t]);
  return { ...query, data: projected };
}
