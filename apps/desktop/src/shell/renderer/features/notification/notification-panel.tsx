import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { ReviewRating, UnreadNotificationCountDto } from '@nimiplatform/sdk/realm';
import { ReviewRating as ReviewRatingEnum } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { formatLocaleDate, formatRelativeLocaleTime, i18n } from '@renderer/i18n';
import {
  type NotificationFilterTab,
  type NotificationItemView,
  getNotificationBadgeKey,
  getNotificationCategory,
  getNotificationServerFilter,
  isGiftReviewable,
  toNotificationListView,
} from './notification-model.js';
import {
  invalidateNotificationQueries,
  notificationQueryKeys,
  patchNotificationUnreadCaches,
} from './notification-query.js';

const PAGE_SIZE = 20;
const FILTER_TABS: NotificationFilterTab[] = ['all', 'gift', 'request', 'mention', 'like', 'system'];
const BUTTON_BASE_CLASS =
  'flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60';
const BUTTON_PRIMARY_CLASS =
  `${BUTTON_BASE_CLASS} bg-mint-500 text-white shadow-sm hover:bg-mint-600 hover:shadow-md`;
const BUTTON_SECONDARY_CLASS =
  `${BUTTON_BASE_CLASS} border border-gray-200 bg-white text-gray-600 hover:bg-gray-50`;

type ItemActionKind =
  | 'friend-accept'
  | 'friend-reject'
  | 'gift-accept'
  | 'gift-reject'
  | 'review-positive'
  | 'review-negative';

type PendingItemAction = {
  itemId: string;
  action: ItemActionKind;
};

function parseUnreadCount(value: UnreadNotificationCountDto | null | undefined): number {
  const total = Number(value?.total);
  if (!Number.isFinite(total) || total < 0) {
    return 0;
  }
  return Math.floor(total);
}

function formatNotificationTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return formatRelativeLocaleTime(date);
  }
  return formatLocaleDate(date, { month: 'short', day: 'numeric' });
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}

function getBadgeDefaultLabel(key: string): string {
  switch (key) {
    case 'friendRequestReceived':
      return 'Friend Request';
    case 'friendRequestAccepted':
      return 'Friend Accepted';
    case 'friendRequestRejected':
      return 'Friend Rejected';
    case 'giftReceived':
      return 'Gift Received';
    case 'giftAccepted':
      return 'Gift Accepted';
    case 'giftRejected':
      return 'Gift Rejected';
    case 'giftStatusUpdated':
      return 'Gift Updated';
    case 'reviewReceived':
      return 'Review Received';
    default:
      return 'System';
  }
}

function getActionLabel(
  t: ReturnType<typeof useTranslation>['t'],
  pendingAction: PendingItemAction | null,
  itemId: string,
  action: ItemActionKind,
  fallback: string,
  pendingFallback: string,
): string {
  return pendingAction?.itemId === itemId && pendingAction.action === action
    ? pendingFallback
    : fallback;
}

export function NotificationPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToGiftInbox = useAppStore((state) => state.navigateToGiftInbox);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItemView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotificationFilterTab>('all');
  const [rejectingItem, setRejectingItem] = useState<NotificationItemView | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [pendingItemAction, setPendingItemAction] = useState<PendingItemAction | null>(null);
  const [optimisticUnreadCount, setOptimisticUnreadCount] = useState<number | null>(null);

  const serverFilter = useMemo(
    () => getNotificationServerFilter(activeFilter),
    [activeFilter],
  );

  const notificationsQuery = useQuery({
    queryKey: notificationQueryKeys.page(authStatus, serverFilter),
    queryFn: async () => dataSync.loadNotifications({
      limit: PAGE_SIZE,
      ...(serverFilter ? { type: serverFilter } : {}),
    }),
    enabled: authStatus === 'authenticated',
  });
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.unreadCount(authStatus),
    queryFn: async () => dataSync.loadNotificationUnreadCount(),
    enabled: authStatus === 'authenticated',
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const parsed = toNotificationListView(
      notificationsQuery.data,
      t('NotificationPanel.title', { defaultValue: 'Notification' }),
      i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
    );
    setItems(parsed.items);
    setNextCursor(parsed.nextCursor);
    setHasNext(parsed.hasNext);
  }, [notificationsQuery.data, t]);

  useEffect(() => {
    if (unreadCountQuery.data) {
      setOptimisticUnreadCount(null);
    }
  }, [unreadCountQuery.data]);

  const unreadCount = optimisticUnreadCount ?? parseUnreadCount(unreadCountQuery.data);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') {
      return items;
    }
    return items.filter((item) => getNotificationCategory(item.type) === activeFilter);
  }, [activeFilter, items]);

  const updateUnreadCount = (nextUnreadCount: number) => {
    setOptimisticUnreadCount(nextUnreadCount);
    patchNotificationUnreadCaches(nextUnreadCount);
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

    const previousItems = items;
    const previousUnreadCount = unreadCount;

    setItems((previous) => previous.map((item) => (
      item.id === notificationId ? { ...item, isRead: true } : item
    )));
    updateUnreadCount(Math.max(0, previousUnreadCount - 1));

    try {
      await dataSync.markNotificationRead(notificationId);
      await refreshNotifications();
    } catch (error) {
      setItems(previousItems);
      updateUnreadCount(previousUnreadCount);
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('NotificationPanel.markReadError')),
      });
    }
  };

  const markAllRead = async () => {
    if (markingAllRead || unreadCount <= 0) {
      return;
    }

    const previousItems = items;
    const previousUnreadCount = unreadCount;

    setMarkingAllRead(true);
    setItems((previous) => previous.map((item) => ({ ...item, isRead: true })));
    updateUnreadCount(0);

    try {
      await dataSync.markNotificationsRead({ markAllBefore: new Date().toISOString() });
      await refreshNotifications();
    } catch (error) {
      setItems(previousItems);
      updateUnreadCount(previousUnreadCount);
      setStatusBanner({
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
        setStatusBanner({
          kind: 'success',
          message: input.successMessage,
        });
      }
    } catch (error) {
      setStatusBanner({
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
      setStatusBanner({
        kind: 'error',
        message: t('Contacts.acceptRequestFailed', { defaultValue: 'Failed to accept friend request' }),
      });
      return;
    }
    const actorId = item.actorId;

    await runItemAction({
      item,
      action: 'friend-accept',
      task: async () => {
        await dataSync.requestOrAcceptFriend(actorId);
      },
      successMessage: t('Contacts.requestAccepted', {
        name: item.actorName,
        defaultValue: 'Accepted request from {{name}}.',
      }),
      errorMessage: t('Contacts.acceptRequestFailed', { defaultValue: 'Failed to accept friend request' }),
    });
  };

  const rejectFriendRequest = async (item: NotificationItemView) => {
    if (!item.actorId) {
      setStatusBanner({
        kind: 'error',
        message: t('Contacts.rejectRequestFailed', { defaultValue: 'Failed to reject friend request' }),
      });
      return;
    }
    const actorId = item.actorId;

    await runItemAction({
      item,
      action: 'friend-reject',
      task: async () => {
        await dataSync.rejectOrRemoveFriend(actorId);
      },
      successMessage: t('Contacts.requestRejected', {
        name: item.actorName,
        defaultValue: 'Rejected request from {{name}}.',
      }),
      errorMessage: t('Contacts.rejectRequestFailed', { defaultValue: 'Failed to reject friend request' }),
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
        await dataSync.acceptGift(item.giftTransactionId as string);
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
        await dataSync.rejectGift(rejectingItem.giftTransactionId as string, {
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
        await dataSync.createGiftReview({
          giftTransactionId: item.giftTransactionId as string,
          rating,
        });
      },
      successMessage: t('NotificationPanel.reviewSubmitted'),
      errorMessage: t('NotificationPanel.reviewError'),
    });
  };

  const loadMore = async () => {
    if (!hasNext || !nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const result = await dataSync.loadNotifications({
        limit: PAGE_SIZE,
        cursor: nextCursor,
        ...(serverFilter ? { type: serverFilter } : {}),
      });
      const parsed = toNotificationListView(
        result,
        t('NotificationPanel.title', { defaultValue: 'Notification' }),
        i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      );
      setItems((previous) => {
        const byId = new Map<string, NotificationItemView>();
        for (const item of previous) {
          byId.set(item.id, item);
        }
        for (const item of parsed.items) {
          byId.set(item.id, item);
        }
        return Array.from(byId.values());
      });
      setNextCursor(parsed.nextCursor);
      setHasNext(parsed.hasNext);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('NotificationPanel.loadMoreError')),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const renderActionButtons = (item: NotificationItemView) => {
    const itemBusy = isBusyForItem(item.id);

    if (item.type === 'friend_request_received') {
      return (
        <>
          <button
            type="button"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void acceptFriendRequest(item);
            }}
            className={BUTTON_PRIMARY_CLASS}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {getActionLabel(
              t,
              pendingItemAction,
              item.id,
              'friend-accept',
              t('Contacts.accept', { defaultValue: 'Accept' }),
              t('NotificationPanel.accepting', { defaultValue: 'Accepting...' }),
            )}
          </button>
          <button
            type="button"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void rejectFriendRequest(item);
            }}
            className={BUTTON_SECONDARY_CLASS}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {getActionLabel(
              t,
              pendingItemAction,
              item.id,
              'friend-reject',
              t('Contacts.reject', { defaultValue: 'Reject' }),
              t('NotificationPanel.rejecting', { defaultValue: 'Rejecting...' }),
            )}
          </button>
        </>
      );
    }

    if (item.type === 'gift_received' && item.giftTransactionId) {
      return (
        <>
          <button
            type="button"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void acceptGift(item);
            }}
            className={BUTTON_PRIMARY_CLASS}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {getActionLabel(
              t,
              pendingItemAction,
              item.id,
              'gift-accept',
              t('NotificationPanel.accept', { defaultValue: 'Accept' }),
              t('NotificationPanel.accepting', { defaultValue: 'Accepting...' }),
            )}
          </button>
          <button
            type="button"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              setRejectingItem(item);
              setRejectReason('');
            }}
            className={BUTTON_SECONDARY_CLASS}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            {t('NotificationPanel.reject', { defaultValue: 'Reject' })}
          </button>
        </>
      );
    }

    if (isGiftReviewable(item)) {
      return (
        <>
          <button
            type="button"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void createReview(item, ReviewRatingEnum.POSITIVE, 'review-positive');
            }}
            className={BUTTON_PRIMARY_CLASS}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            {getActionLabel(
              t,
              pendingItemAction,
              item.id,
              'review-positive',
              t('NotificationPanel.reviewPositive', { defaultValue: 'Review+' }),
              t('NotificationPanel.submitting', { defaultValue: 'Submitting...' }),
            )}
          </button>
          <button
            type="button"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void createReview(item, ReviewRatingEnum.NEGATIVE, 'review-negative');
            }}
            className={BUTTON_SECONDARY_CLASS}
          >
            {getActionLabel(
              t,
              pendingItemAction,
              item.id,
              'review-negative',
              t('NotificationPanel.reviewNegative', { defaultValue: 'Review-' }),
              t('NotificationPanel.submitting', { defaultValue: 'Submitting...' }),
            )}
          </button>
        </>
      );
    }

    return null;
  };

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#F5F7FA] text-sm text-gray-500">
        {t('NotificationPanel.loginRequired')}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F5F7FA]">
      <div className="flex h-16 shrink-0 items-center justify-between bg-white px-6">
        <h1 className={`${APP_PAGE_TITLE_CLASS} flex items-center gap-2`}>
          {t('NotificationPanel.title', { defaultValue: 'Notifications' })}
          {unreadCount > 0 ? (
            <span className="rounded-full bg-mint-500 px-2 py-0.5 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          ) : null}
        </h1>
        <button
          type="button"
          disabled={markingAllRead || unreadCount <= 0}
          onClick={() => {
            void markAllRead();
          }}
          className="text-sm font-medium text-mint-600 transition-colors hover:text-mint-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {markingAllRead
            ? t('NotificationPanel.markingAllRead', { defaultValue: 'Marking...' })
            : t('NotificationPanel.markAllRead', { defaultValue: 'Mark All Read' })}
        </button>
      </div>

      <div className="flex items-center gap-2 bg-white px-6 py-3">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveFilter(tab)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              activeFilter === tab
                ? 'bg-mint-500 text-white shadow-sm'
                : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t(`NotificationPanel.filters.${tab}`, {
              defaultValue: tab,
            })}
          </button>
        ))}
      </div>

      <ScrollShell
        className="min-h-0 flex-1"
        contentClassName="mx-auto max-w-2xl space-y-3 px-6 py-4"
      >
        {notificationsQuery.isPending && items.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-400">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-mint-200 border-t-mint-500" />
            {t('NotificationPanel.loading', { defaultValue: 'Loading notifications...' })}
          </div>
        ) : null}

        {notificationsQuery.isError && items.length === 0 ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
            {t('NotificationPanel.loadError', { defaultValue: 'Failed to load notifications' })}
          </div>
        ) : null}

        {!notificationsQuery.isPending && !notificationsQuery.isError && filteredItems.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-400">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            {t('NotificationPanel.empty', { defaultValue: 'No notifications' })}
          </div>
        ) : null}

        {filteredItems.map((item) => {
          const badgeKey = getNotificationBadgeKey(item);
          const itemBusy = isBusyForItem(item.id);
          const giftMessage = item.giftMessage?.trim() || '';
          const body = item.body.trim();
          const showGiftMessage = Boolean(giftMessage);
          const showBody = Boolean(body) && (!showGiftMessage || body !== giftMessage);
          const shouldOpenGiftInbox = (
            (item.type === 'gift_received' || item.type === 'gift_status_updated')
            && Boolean(item.giftTransactionId)
          );

          return (
            <div
              key={item.id}
              onClick={() => {
                if (!itemBusy) {
                  if (shouldOpenGiftInbox) {
                    navigateToGiftInbox(item.giftTransactionId);
                  }
                  void markOneRead(item.id);
                }
              }}
              className={`group relative cursor-pointer rounded-2xl p-4 transition-all duration-200 ${
                item.isRead ? 'bg-white' : 'bg-mint-50/60'
              } ${itemBusy ? 'pointer-events-none' : ''}`}
            >
              {!item.isRead ? (
                <div className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-mint-500 shadow-sm" />
              ) : null}

              <div className="flex gap-4">
                <div className="relative shrink-0">
                  <EntityAvatar
                    imageUrl={item.actorAvatarUrl}
                    name={item.actorName}
                    kind={item.actorIsAgent ? 'agent' : 'human'}
                    sizeClassName="h-12 w-12"
                    className={item.actorIsAgent ? undefined : 'ring-2 ring-gray-100'}
                    fallbackClassName={
                      item.actorIsAgent
                        ? undefined
                        : (item.isRead
                          ? 'bg-gray-100 text-gray-500 ring-2 ring-gray-100'
                          : 'bg-mint-100 text-mint-700 ring-2 ring-gray-100')
                    }
                    textClassName="text-sm font-semibold"
                  />
                </div>

                <div className="min-w-0 flex-1 pr-6">
                  <p className="text-sm text-gray-800">
                    <span className="font-bold">{item.actorName}</span>{' '}
                    <span className="text-gray-600">{item.title.replace(item.actorName, '').trim()}</span>{' '}
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                      {t(`NotificationPanel.typeNotifications.${badgeKey}`, {
                        defaultValue: getBadgeDefaultLabel(badgeKey),
                      })}
                    </span>
                  </p>

                  <p className="mt-0.5 text-xs text-gray-400">{formatNotificationTime(item.createdAt)}</p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {item.giftSparkCost ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                        {t('NotificationPanel.sparkAmount', {
                          amount: item.giftSparkCost,
                          defaultValue: '{{amount}} Spark',
                        })}
                      </span>
                    ) : null}
                    {shouldOpenGiftInbox ? (
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                        {t('NotificationPanel.viewGift', { defaultValue: 'View Gift' })}
                      </span>
                    ) : null}
                  </div>

                  {showBody ? (
                    <div className="mt-2 inline-block max-w-full rounded-xl rounded-tl-sm bg-gray-100 px-3 py-2">
                      <p className="line-clamp-2 text-sm text-gray-600">"{body}"</p>
                    </div>
                  ) : null}

                  {showGiftMessage ? (
                    <div className="mt-2 inline-block max-w-full rounded-xl rounded-tl-sm bg-mint-50 px-3 py-2">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-mint-700">
                        {t('NotificationPanel.senderMessage', { defaultValue: 'Sender message' })}
                      </p>
                      <p className="line-clamp-3 text-sm text-mint-900">"{giftMessage}"</p>
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center gap-2">
                    {renderActionButtons(item)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {hasNext ? (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => {
                void loadMore();
              }}
              disabled={loadingMore}
              className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {loadingMore
                ? t('NotificationPanel.loadingMore', { defaultValue: 'Loading...' })
                : t('NotificationPanel.loadMore', { defaultValue: 'Load More' })}
            </button>
          </div>
        ) : null}
      </ScrollShell>

      {rejectingItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">
              {t('NotificationPanel.rejectGiftTitle')}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {t('NotificationPanel.rejectGiftDescription', {
                defaultValue: 'You are rejecting gift from {{name}}.',
                name: rejectingItem.actorName,
              })}
            </p>
            <label className="mt-4 block text-xs font-medium text-gray-600" htmlFor="gift-reject-reason">
              {t('NotificationPanel.rejectReason', { defaultValue: 'Reason (optional)' })}
            </label>
            <textarea
              id="gift-reject-reason"
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              maxLength={160}
              placeholder={t('NotificationPanel.rejectGiftReasonPlaceholder', {
                defaultValue: "Tell them why you're rejecting...",
              })}
              className="mt-1 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 outline-none focus:border-mint-300 focus:ring-2 focus:ring-mint-100"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!pendingItemAction) {
                    resetRejectDialog();
                  }
                }}
                disabled={pendingItemAction?.action === 'gift-reject'}
                className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t('Common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={() => {
                  void submitRejectGift();
                }}
                disabled={pendingItemAction?.action === 'gift-reject'}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingItemAction?.action === 'gift-reject'
                  ? t('NotificationPanel.rejecting', { defaultValue: 'Rejecting...' })
                  : t('NotificationPanel.confirmReject', { defaultValue: 'Confirm Reject' })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
