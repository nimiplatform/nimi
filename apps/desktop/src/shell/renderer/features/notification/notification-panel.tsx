import { useDesktopI18nResource } from '../../i18n/i18n-context';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { useEffect, useMemo, useState } from 'react';
import { AppCardSurface, Button, EmptyState, ScrollArea } from '@nimiplatform/kit/ui';
import { loadNimiRealmNotifications, loadNimiRealmNotificationUnreadCount, markNimiRealmNotificationRead, markNimiRealmNotificationsRead, toNimiRealmNotificationListView } from '@nimiplatform/sdk/realm';
import {
  getNimiNotificationCategory,
  getNimiNotificationServerFilter,
} from '@nimiplatform/kit/core/notifications';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../app-shell/providers/app-store';
import { E2E_IDS } from '../../testability/e2e-ids';

import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';
import {
  invalidateNotificationQueries,
  notificationQueryKeys,
  patchNotificationUnreadCaches,
  resolveNotificationIdentityRef,
} from './notification-query.js';
import { toErrorMessage } from './notification-panel-helpers.js';
import { NotificationPanelItemCard } from './notification-panel-item-card.js';
import { NotificationPanelHeader } from './notification-panel-header.js';
import {
  PAGE_SIZE,
  type ItemActionKind,
  type NotificationFilterTab,
  type NotificationItemView,
  type PendingItemAction,
} from './notification-panel-types.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function NotificationPanel() {
  const realmSocialData = useRealmSocialData();
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource().instance;
  const queryClient = useQueryClient();
  const authStatus = useAppStore((state) => state.auth.status);
  const authUser = useAppStore((state) => state.auth.user);
  const { t } = useTranslation();
  const setFeedback = emitFeedbackToast;
  const [activeFilter, setActiveFilter] = useState<NotificationFilterTab>('all');
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [pendingItemAction, setPendingItemAction] = useState<PendingItemAction | null>(null);
  const [optimisticUnreadCount, setOptimisticUnreadCount] = useState<number | null>(null);
  const [readOverrides, setReadOverrides] = useState<Record<string, true>>({});

  const serverFilter = useMemo(
    () => getNimiNotificationServerFilter(activeFilter),
    [activeFilter],
  );
  const notificationIdentityRef = useMemo(
    () => resolveNotificationIdentityRef(authStatus, authUser),
    [authStatus, authUser],
  );
  const notificationQueryIdentityRef = notificationIdentityRef ?? 'missing-auth-identity';

  const notificationsQuery = useInfiniteQuery({
    queryKey: notificationQueryKeys.page(notificationQueryIdentityRef, serverFilter),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => loadNimiRealmNotifications(
      bindings.sdk.realm(),
      {
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: String(pageParam) } : {}),
        ...(serverFilter ? { type: serverFilter } : {}),
      },
    ),
    enabled: authStatus === 'authenticated' && Boolean(notificationIdentityRef),
    getNextPageParam: (lastPage) => {
      const parsed = toNimiRealmNotificationListView(
        lastPage,
        t('NotificationPanel.title', { defaultValue: 'Notification' }),
        i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      );
      return parsed.nextCursor || undefined;
    },
  });
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.topbarUnreadCount(notificationQueryIdentityRef),
    queryFn: async () => loadNimiRealmNotificationUnreadCount(bindings.sdk.realm()),
    enabled: authStatus === 'authenticated' && Boolean(notificationIdentityRef),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (unreadCountQuery.data !== undefined) {
      setOptimisticUnreadCount(null);
    }
  }, [unreadCountQuery.data]);

  useEffect(() => {
    setReadOverrides({});
  }, [authStatus, notificationIdentityRef, serverFilter]);

  const unreadCount = optimisticUnreadCount ?? unreadCountQuery.data?.total ?? 0;

  const items = useMemo(() => {
    if (!notificationsQuery.data) {
      return [];
    }

    const byId = new Map<string, NotificationItemView>();
    for (const page of notificationsQuery.data.pages) {
      const parsed = toNimiRealmNotificationListView(
        page,
        t('NotificationPanel.title', { defaultValue: 'Notification' }),
        i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      );
      for (const item of parsed.items) {
        byId.set(item.id, item);
      }
    }

    return Array.from(byId.values()).map((item) => (
      readOverrides[item.id] ? { ...item, isRead: true } : item
    ));
  }, [notificationsQuery.data, readOverrides, t]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') {
      return items;
    }
    return items.filter((item) => getNimiNotificationCategory(item.type) === activeFilter);
  }, [activeFilter, items]);

  const updateUnreadCount = (nextUnreadCount: number) => {
    if (!notificationIdentityRef) {
      return;
    }
    setOptimisticUnreadCount(nextUnreadCount);
    patchNotificationUnreadCaches(nextUnreadCount, notificationIdentityRef, queryClient);
  };

  const refreshNotifications = async () => {
    await invalidateNotificationQueries(queryClient);
  };

  const isBusyForItem = (itemId: string): boolean =>
    pendingItemAction?.itemId === itemId;

  const markOneRead = async (id: string) => {
    const notificationId = String(id || '').trim();
    if (!notificationId) {
      return;
    }

    const target = items.find((item) => item.id === notificationId);
    if (!target || target.isRead || isBusyForItem(notificationId)) {
      return;
    }

    const previousUnreadCount = unreadCount;
    const hadReadOverride = Boolean(readOverrides[notificationId]);

    setReadOverrides((previous) => ({ ...previous, [notificationId]: true }));
    updateUnreadCount(Math.max(0, previousUnreadCount - 1));

    try {
      await markNimiRealmNotificationRead(bindings.sdk.realm(), notificationId);
      await refreshNotifications();
    } catch (error) {
      setReadOverrides((previous) => {
        if (hadReadOverride) {
          return previous;
        }
        const next = { ...previous };
        delete next[notificationId];
        return next;
      });
      updateUnreadCount(previousUnreadCount);
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('NotificationPanel.markReadError')),
      });
    }
  };

  const markAllRead = async () => {
    if (markingAllRead || unreadCount <= 0) {
      return;
    }

    const previousReadOverrides = readOverrides;
    const previousUnreadCount = unreadCount;

    setMarkingAllRead(true);
    setReadOverrides((previous) => {
      const next = { ...previous };
      for (const item of items) {
        next[item.id] = true;
      }
      return next;
    });
    updateUnreadCount(0);

    try {
      await markNimiRealmNotificationsRead(
        bindings.sdk.realm(),
        { markAllBefore: new Date(bindings.clock.now()).toISOString() },
      );
      await refreshNotifications();
    } catch (error) {
      setReadOverrides(previousReadOverrides);
      updateUnreadCount(previousUnreadCount);
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('NotificationPanel.markAllReadError')),
      });
    } finally {
      setMarkingAllRead(false);
    }
  };

  const runItemAction = async (input: {
    item: NotificationItemView;
    action: ItemActionKind;
    task: () => Promise<void>;
    successMessage?: string;
    errorMessage: string;
    onSuccess?: () => void;
  }) => {
    if (pendingItemAction || markingAllRead) {
      return;
    }

    setPendingItemAction({
      itemId: input.item.id,
      action: input.action,
    });

    try {
      await input.task();
      await refreshNotifications();
      input.onSuccess?.();
      if (input.successMessage) {
        setFeedback({
          kind: 'success',
          message: input.successMessage,
        });
      } else {
        setFeedback(null);
      }
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, input.errorMessage),
      });
    } finally {
      setPendingItemAction((current) => (
        current !== null && current.itemId === input.item.id && current.action === input.action
          ? null
          : current
      ));
    }
  };

  const acceptFriendRequest = async (item: NotificationItemView) => {
    if (!item.actorId) {
      setFeedback({
        kind: 'error',
        message: t('Relationship.acceptRequestFailed', { defaultValue: 'Failed to accept friend request' }),
      });
      return;
    }
    const actorId = item.actorId;

    await runItemAction({
      item,
      action: 'friend-accept',
      task: async () => {
        await realmSocialData.requestOrAcceptFriend(actorId);
      },
      errorMessage: t('Relationship.acceptRequestFailed', { defaultValue: 'Failed to accept friend request' }),
    });
  };

  const rejectFriendRequest = async (item: NotificationItemView) => {
    if (!item.actorId) {
      setFeedback({
        kind: 'error',
        message: t('Relationship.rejectRequestFailed', { defaultValue: 'Failed to reject friend request' }),
      });
      return;
    }
    const actorId = item.actorId;

    await runItemAction({
      item,
      action: 'friend-reject',
      task: async () => {
        await realmSocialData.rejectOrRemoveFriend(actorId);
      },
      errorMessage: t('Relationship.rejectRequestFailed', { defaultValue: 'Failed to reject friend request' }),
    });
  };

  const loadMore = async () => {
    if (!notificationsQuery.hasNextPage || notificationsQuery.isFetchingNextPage) {
      return;
    }
    try {
      await notificationsQuery.fetchNextPage();
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: toErrorMessage(error, t('NotificationPanel.loadMoreError')),
      });
    }
  };

  if (authStatus !== 'authenticated') {
    return (
      <div data-testid={E2E_IDS.panel('notification')} className="flex min-h-0 flex-1 px-5 pb-5 pt-4">
        <AppCardSurface
          kind="promoted-glass"
          className="flex flex-1 items-center justify-center rounded-[2rem] border-white/60 text-sm text-[var(--nimi-text-secondary)] shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
        >
          {t('NotificationPanel.loginRequired')}
        </AppCardSurface>
      </div>
    );
  }

  return (
    <div data-testid={E2E_IDS.panel('notification')} className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-4">
      <div className="mx-auto w-full max-w-4xl">
        <NotificationPanelHeader
          activeFilter={activeFilter}
          markingAllRead={markingAllRead}
          unreadCount={unreadCount}
          onFilterChange={setActiveFilter}
          onMarkAllRead={() => {
            void markAllRead();
          }}
        />
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        viewportClassName="bg-transparent"
        contentClassName="mx-auto w-full max-w-4xl space-y-3 px-1 py-5"
      >
        {notificationsQuery.isPending && items.length === 0 ? (
          <AppCardSurface kind="promoted-glass" className="p-8 text-center text-sm text-[var(--nimi-text-secondary)]">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[var(--nimi-border-subtle)] border-t-[var(--nimi-action-primary-bg)]" />
            {t('NotificationPanel.loading', { defaultValue: 'Loading notifications...' })}
          </AppCardSurface>
        ) : null}

        {notificationsQuery.isError && items.length === 0 ? (
          <AppCardSurface kind="promoted-glass" className="border-[var(--nimi-status-danger-soft-border)] p-8 text-center text-sm text-[var(--nimi-status-danger-soft-text)]">
            {t('NotificationPanel.loadError', { defaultValue: 'Failed to load notifications' })}
          </AppCardSurface>
        ) : null}

        {!notificationsQuery.isPending && !notificationsQuery.isError && filteredItems.length === 0 ? (
          <EmptyState
            icon={(
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            )}
            title={t('NotificationPanel.empty', { defaultValue: 'No notifications' })}
          />
        ) : null}

        {filteredItems.map((item) => (
          <NotificationPanelItemCard
            key={item.id}
            item={item}
            itemBusy={isBusyForItem(item.id)}
            pendingItemAction={pendingItemAction}
            t={t}
            markOneRead={(id) => {
              void markOneRead(id);
            }}
            onAcceptFriendRequest={(target) => {
              void acceptFriendRequest(target);
            }}
            onRejectFriendRequest={(target) => {
              void rejectFriendRequest(target);
            }}
          />
        ))}

        {notificationsQuery.hasNextPage ? (
          <div className="flex justify-center pt-2">
            <Button
              tone="secondary"
              onClick={() => {
                void loadMore();
              }}
              disabled={notificationsQuery.isFetchingNextPage}
            >
              {notificationsQuery.isFetchingNextPage
                ? t('NotificationPanel.loadingMore', { defaultValue: 'Loading...' })
                : t('NotificationPanel.loadMore', { defaultValue: 'Load More' })}
            </Button>
          </div>
        ) : null}
      </ScrollArea>

    </div>
  );
}
