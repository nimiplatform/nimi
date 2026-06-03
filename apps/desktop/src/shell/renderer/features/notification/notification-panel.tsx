import { realmSocialData } from '@renderer/features/social/data/realm-social-data';
import { useEffect, useMemo, useState } from 'react';
import { AppCardSurface, Button, ScrollArea } from '@nimiplatform/kit/ui';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  loadRealmNotifications,
  loadRealmNotificationUnreadCount,
  markRealmNotificationRead,
  markRealmNotificationsRead,
  toRealmNotificationListProjection,
  type RealmModel,
} from '@nimiplatform/sdk/realm';
import {
  getNimiNotificationCategory,
  getNimiNotificationServerFilter,
} from '@nimiplatform/kit/core/notifications';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  acceptRealmGift,
  createRealmGiftReview,
  rejectRealmGift,
} from '@nimiplatform/kit/features/commerce/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { i18n } from '@renderer/i18n';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';
import {
  invalidateNotificationQueries,
  notificationQueryKeys,
  patchNotificationUnreadCaches,
  resolveNotificationIdentityRef,
} from './notification-query.js';
import { toErrorMessage } from './notification-panel-helpers.js';
import { RejectGiftDialog } from './notification-reject-gift-dialog.js';
import { NotificationPanelItemCard } from './notification-panel-item-card.js';
import { NotificationPanelHeader } from './notification-panel-header.js';
import {
  PAGE_SIZE,
  type ItemActionKind,
  type NotificationFilterTab,
  type NotificationItemView,
  type PendingItemAction,
} from './notification-panel-types.js';

type ReviewRating = RealmModel<'ReviewRating'>;

export function NotificationPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const authUser = useAppStore((state) => state.auth.user);
  const navigateToGiftInbox = useAppStore((state) => state.navigateToGiftInbox);
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const [activeFilter, setActiveFilter] = useState<NotificationFilterTab>('all');
  const [rejectingItem, setRejectingItem] = useState<NotificationItemView | null>(null);
  const [rejectReason, setRejectReason] = useState('');
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
    queryFn: async ({ pageParam }) => loadRealmNotifications(
      getPlatformClient().realm,
      {
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: String(pageParam) } : {}),
        ...(serverFilter ? { type: serverFilter } : {}),
      },
    ),
    enabled: authStatus === 'authenticated' && Boolean(notificationIdentityRef),
    getNextPageParam: (lastPage) => {
      const parsed = toRealmNotificationListProjection(
        lastPage,
        t('NotificationPanel.title', { defaultValue: 'Notification' }),
        i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      );
      return parsed.nextCursor || undefined;
    },
  });
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.topbarUnreadCount(notificationQueryIdentityRef),
    queryFn: async () => loadRealmNotificationUnreadCount(getPlatformClient().realm),
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
      const parsed = toRealmNotificationListProjection(
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
    patchNotificationUnreadCaches(nextUnreadCount, notificationIdentityRef);
  };

  const resetRejectDialog = () => {
    setRejectingItem(null);
    setRejectReason('');
  };

  const refreshNotifications = async () => {
    await invalidateNotificationQueries();
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
      await markRealmNotificationRead(getPlatformClient().realm, notificationId);
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
      await markRealmNotificationsRead(
        getPlatformClient().realm,
        { markAllBefore: new Date().toISOString() },
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
        current?.itemId === input.item.id && current.action === input.action
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

  const acceptGift = async (item: NotificationItemView) => {
    if (!item.giftTransactionId) {
      return;
    }

    await runItemAction({
      item,
      action: 'gift-accept',
      task: async () => {
        await acceptRealmGift(item.giftTransactionId as string);
      },
      errorMessage: t('NotificationPanel.acceptError', { defaultValue: 'Failed to accept gift' }),
    });
  };

  const submitRejectGift = async () => {
    if (!rejectingItem?.giftTransactionId) {
      return;
    }

    await runItemAction({
      item: rejectingItem,
      action: 'gift-reject',
      task: async () => {
        await rejectRealmGift(rejectingItem.giftTransactionId as string, {
          reason: rejectReason.trim() || undefined,
        });
      },
      errorMessage: t('NotificationPanel.rejectError'),
      onSuccess: () => {
        resetRejectDialog();
      },
    });
  };

  const createReview = async (item: NotificationItemView, rating: ReviewRating, action: ItemActionKind) => {
    if (!item.giftTransactionId) {
      return;
    }

    await runItemAction({
      item,
      action,
      task: async () => {
        await createRealmGiftReview({
          giftTransactionId: item.giftTransactionId as string,
          rating,
        });
      },
      errorMessage: t('NotificationPanel.reviewError'),
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
          feedback={feedback}
          markingAllRead={markingAllRead}
          unreadCount={unreadCount}
          onDismissFeedback={() => setFeedback(null)}
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
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-mint-200 border-t-mint-500" />
            {t('NotificationPanel.loading', { defaultValue: 'Loading notifications...' })}
          </AppCardSurface>
        ) : null}

        {notificationsQuery.isError && items.length === 0 ? (
          <AppCardSurface kind="promoted-glass" className="border-red-200/70 p-8 text-center text-sm text-red-700">
            {t('NotificationPanel.loadError', { defaultValue: 'Failed to load notifications' })}
          </AppCardSurface>
        ) : null}

        {!notificationsQuery.isPending && !notificationsQuery.isError && filteredItems.length === 0 ? (
          <AppCardSurface kind="promoted-glass" className="p-8 text-center text-sm text-[var(--nimi-text-secondary)]">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,white)] text-[var(--nimi-action-primary-bg)]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            {t('NotificationPanel.empty', { defaultValue: 'No notifications' })}
          </AppCardSurface>
        ) : null}

        {filteredItems.map((item) => (
          <NotificationPanelItemCard
            key={item.id}
            item={item}
            itemBusy={isBusyForItem(item.id)}
            pendingItemAction={pendingItemAction}
            t={t}
            navigateToGiftInbox={navigateToGiftInbox}
            markOneRead={(id) => {
              void markOneRead(id);
            }}
            onAcceptFriendRequest={(target) => {
              void acceptFriendRequest(target);
            }}
            onRejectFriendRequest={(target) => {
              void rejectFriendRequest(target);
            }}
            onAcceptGift={(target) => {
              void acceptGift(target);
            }}
            onStartRejectGift={(target) => {
              setRejectingItem(target);
              setRejectReason('');
            }}
            onCreateReview={(target, rating, action) => {
              void createReview(target, rating, action);
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

      {rejectingItem ? (
        <RejectGiftDialog
          actorName={rejectingItem.actorName}
          rejectReason={rejectReason}
          pending={pendingItemAction?.action === 'gift-reject'}
          title={t('NotificationPanel.rejectGiftTitle')}
          description={t('NotificationPanel.rejectGiftDescription', {
            defaultValue: 'You are rejecting gift from {{name}}.',
            name: rejectingItem.actorName,
          })}
          reasonLabel={t('NotificationPanel.rejectReason', { defaultValue: 'Reason (optional)' })}
          reasonPlaceholder={t('NotificationPanel.rejectGiftReasonPlaceholder', {
            defaultValue: "Tell them why you're rejecting...",
          })}
          cancelLabel={t('Common.cancel', { defaultValue: 'Cancel' })}
          confirmLabel={t('NotificationPanel.confirmReject', { defaultValue: 'Confirm Reject' })}
          pendingLabel={t('NotificationPanel.rejecting', { defaultValue: 'Rejecting...' })}
          onReasonChange={setRejectReason}
          onCancel={() => {
            if (!pendingItemAction) {
              resetRejectDialog();
            }
          }}
          onSubmit={() => {
            void submitRejectGift();
          }}
        />
      ) : null}
    </div>
  );
}
