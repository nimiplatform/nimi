import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { loadNimiRealmNotifications, markNimiRealmNotificationsRead, toNimiRealmNotificationListView, type NimiRealmNotificationListView } from '@nimiplatform/sdk/realm';
import { useAppStore, useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useReceivedFriendRequests } from '../relationship/human-contact-data.js';
import { notificationQueryKeys, resolveNotificationIdentityRef } from '../notification/notification-query.js';
import { projectRealmMessages, realmMessageAccount } from './home-realm-messages-model.js';
import type { HomeRealmMessage } from './home-messages-model.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r035
export function useHomeRealmMessages() {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const client = useQueryClient();
  const auth = useAppStore(state => state.auth);
  const identity = resolveNotificationIdentityRef(auth.status, auth.user);
  const [busy, setBusy] = useState<Record<string, 'read'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const notificationQuery = useInfiniteQuery({
    queryKey: notificationQueryKeys.page(identity ?? 'unavailable', null), initialPageParam: '',
    queryFn: async ({ pageParam }) => toNimiRealmNotificationListView(
      await loadNimiRealmNotifications(sdk.realm(), { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) }), '', ''),
    getNextPageParam: page => page.nextCursor || undefined,
    enabled: auth.status === 'authenticated' && Boolean(identity), staleTime: 15_000, refetchInterval: 30_000,
  });
  const requests = useReceivedFriendRequests();
  const messages = useMemo(() => projectRealmMessages(
    notificationQuery.data?.pages.flatMap(page => page.items) ?? [],
    requests.data?.pages.flatMap(page => page.items) ?? [],
  ), [notificationQuery.data, requests.data]);
  const markRead = async (message: HomeRealmMessage) => {
    const ids = message.notifications.filter(item => !item.isRead).map(item => item.id);
    if (!ids.length || busy[message.key]) return;
    const scope = captureAccountActionScope(store);
    if (!scope) { setErrors(current => ({ ...current, [message.key]: t('Profile.accountUnavailable') })); return; }
    setBusy(current => ({ ...current, [message.key]: 'read' }));
    setErrors(current => { const next = { ...current }; delete next[message.key]; return next; });
    try {
      await markNimiRealmNotificationsRead(sdk.realm(), { ids });
      if (!scope.isCurrent()) return;
      client.setQueriesData<{ pages: NimiRealmNotificationListView[]; pageParams: string[] }>({ queryKey: ['notification-page', identity] }, data => data ? {
        ...data, pages: data.pages.map(page => ({ ...page, items: page.items.map(item => ids.includes(item.id) ? { ...item, isRead: true } : item) })),
      } : data);
      void client.invalidateQueries({ queryKey: notificationQueryKeys.topbarUnreadCount(identity!) });
    } catch { if (scope.isCurrent()) setErrors(current => ({ ...current, [message.key]: t('NotificationPanel.markReadError') })); }
    finally {
      const current = scope.isCurrent(); scope.dispose();
      if (current) setBusy(value => { const next = { ...value }; delete next[message.key]; return next; });
    }
  };
  return {
    messages, busy, errors,
    notifications: { complete: notificationQuery.isSuccess && !notificationQuery.hasNextPage, hasMore: Boolean(notificationQuery.hasNextPage),
      loading: notificationQuery.isPending, failed: notificationQuery.isError, loadingMore: notificationQuery.isFetchingNextPage,
      loadMore: () => void notificationQuery.fetchNextPage(), retry: () => void notificationQuery.refetch() },
    requests: { complete: requests.isSuccess && !requests.hasNextPage, hasMore: Boolean(requests.hasNextPage),
      loading: requests.isPending, failed: requests.isError, loadingMore: requests.isFetchingNextPage,
      loadMore: () => void requests.fetchNextPage(), retry: () => void requests.refetch() },
    markRead: (message: HomeRealmMessage) => { void markRead(message); },
    open(message: HomeRealmMessage) {
      const account = realmMessageAccount(message);
      const chatId = message.notifications[0]?.target?.chatId;
      if (message.request) void navigation.push({ id: 'chat', chat: { mode: 'human', contactsSection: 'received' } });
      else if (chatId) void navigation.push({ id: 'chat', chat: { mode: 'human', threadId: chatId } });
      else if (account.id) void navigation.push({ id: 'profile', profileId: account.id });
    },
  };
}

export type HomeRealmMessages = ReturnType<typeof useHomeRealmMessages>;
