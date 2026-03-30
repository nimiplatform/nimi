import { useEffect, useMemo, useState } from 'react';
import { Button, ScrollArea, Surface } from '@nimiplatform/nimi-kit/ui';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ReviewRating as ReviewRatingEnum } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
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

type ReviewRating = RealmModel<'ReviewRating'>;
type UnreadNotificationCountDto = RealmModel<'UnreadNotificationCountDto'>;
import {
  invalidateNotificationQueries,
  notificationQueryKeys,
  patchNotificationUnreadCaches,
} from './notification-query.js';
import { RejectGiftDialog } from './notification-reject-gift-dialog.js';
import { getActionLabel, getBadgeDefaultLabel } from './notification-panel-labels.js';

const PAGE_SIZE = 20;
const FILTER_TABS: NotificationFilterTab[] = ['all', 'gift', 'request', 'mention', 'like', 'system'];

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

export function NotificationPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const navigateToGiftInbox = useAppStore((state) => state.navigateToGiftInbox);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<NotificationFilterTab>('all');
  const [rejectingItem, setRejectingItem] = useState<NotificationItemView | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [pendingItemAction, setPendingItemAction] = useState<PendingItemAction | null>(null);
  const [optimisticUnreadCount, setOptimisticUnreadCount] = useState<number | null>(null);
  const [readOverrides, setReadOverrides] = useState<Record<string, true>>({});

  const serverFilter = useMemo(
    () => getNotificationServerFilter(activeFilter),
    [activeFilter],
  );

  const notificationsQuery = useInfiniteQuery({
    queryKey: notificationQueryKeys.page(authStatus, serverFilter),
    initialPageParam: '',
    queryFn: async ({ pageParam }) => dataSync.loadNotifications({
      limit: PAGE_SIZE,
      ...(pageParam ? { cursor: String(pageParam) } : {}),
      ...(serverFilter ? { type: serverFilter } : {}),
    }),
    enabled: authStatus === 'authenticated',
    getNextPageParam: (lastPage) => {
      const parsed = toNotificationListView(
        lastPage,
        t('NotificationPanel.title', { defaultValue: 'Notification' }),
        i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
      );
      return parsed.nextCursor || undefined;
    },
  });
  const unreadCountQuery = useQuery({
    queryKey: notificationQueryKeys.unreadCount(authStatus),
    queryFn: async () => dataSync.loadNotificationUnreadCount(),
    enabled: authStatus === 'authenticated',
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (unreadCountQuery.data) {
      setOptimisticUnreadCount(null);
    }
  }, [unreadCountQuery.data]);

  useEffect(() => {
    setReadOverrides({});
  }, [authStatus, serverFilter]);

  const unreadCount = optimisticUnreadCount ?? parseUnreadCount(unreadCountQuery.data);

  const items = useMemo(() => {
    if (!notificationsQuery.data) {
      return [];
    }

    const byId = new Map<string, NotificationItemView>();
    for (const page of notificationsQuery.data.pages) {
      const parsed = toNotificationListView(
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

    const previousUnreadCount = unreadCount;
    const hadReadOverride = Boolean(readOverrides[notificationId]);

    setReadOverrides((previous) => ({ ...previous, [notificationId]: true }));
    updateUnreadCount(Math.max(0, previousUnreadCount - 1));

    try {
      await dataSync.markNotificationRead(notificationId);
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
      await dataSync.markNotificationsRead({ markAllBefore: new Date().toISOString() });
      await refreshNotifications();
    } catch (error) {
      setReadOverrides(previousReadOverrides);
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
    if (!notificationsQuery.hasNextPage || notificationsQuery.isFetchingNextPage) {
      return;
    }
    try {
      await notificationsQuery.fetchNextPage();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('NotificationPanel.loadMoreError')),
      });
    }
  };

  const renderActionButtons = (item: NotificationItemView) => {
    const itemBusy = isBusyForItem(item.id);

    if (item.type === 'friend_request_received') {
      return (
        <>
          <Button
            tone="primary"
            size="sm"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void acceptFriendRequest(item);
            }}
            leadingIcon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          >
            {getActionLabel(
              pendingItemAction,
              item.id,
              'friend-accept',
              t('Contacts.accept', { defaultValue: 'Accept' }),
              t('NotificationPanel.accepting', { defaultValue: 'Accepting...' }),
            )}
          </Button>
          <Button
            tone="secondary"
            size="sm"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void rejectFriendRequest(item);
            }}
            leadingIcon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          >
            {getActionLabel(
              pendingItemAction,
              item.id,
              'friend-reject',
              t('Contacts.reject', { defaultValue: 'Reject' }),
              t('NotificationPanel.rejecting', { defaultValue: 'Rejecting...' }),
            )}
          </Button>
        </>
      );
    }

    if (item.type === 'gift_received' && item.giftTransactionId) {
      return (
        <>
          <Button
            tone="primary"
            size="sm"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void acceptGift(item);
            }}
            leadingIcon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          >
            {getActionLabel(
              pendingItemAction,
              item.id,
              'gift-accept',
              t('NotificationPanel.accept', { defaultValue: 'Accept' }),
              t('NotificationPanel.accepting', { defaultValue: 'Accepting...' }),
            )}
          </Button>
          <Button
            tone="secondary"
            size="sm"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              setRejectingItem(item);
              setRejectReason('');
            }}
            leadingIcon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          >
            {t('NotificationPanel.reject', { defaultValue: 'Reject' })}
          </Button>
        </>
      );
    }

    if (isGiftReviewable(item)) {
      return (
        <>
          <Button
            tone="primary"
            size="sm"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void createReview(item, ReviewRatingEnum.POSITIVE, 'review-positive');
            }}
            leadingIcon={(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            )}
          >
            {getActionLabel(
              pendingItemAction,
              item.id,
              'review-positive',
              t('NotificationPanel.reviewPositive', { defaultValue: 'Review+' }),
              t('NotificationPanel.submitting', { defaultValue: 'Submitting...' }),
            )}
          </Button>
          <Button
            tone="secondary"
            size="sm"
            disabled={itemBusy}
            onClick={(event) => {
              event.stopPropagation();
              void createReview(item, ReviewRatingEnum.NEGATIVE, 'review-negative');
            }}
          >
            {getActionLabel(
              pendingItemAction,
              item.id,
              'review-negative',
              t('NotificationPanel.reviewNegative', { defaultValue: 'Review-' }),
              t('NotificationPanel.submitting', { defaultValue: 'Submitting...' }),
            )}
          </Button>
        </>
      );
    }

    return null;
  };

  if (authStatus !== 'authenticated') {
    return (
      <div data-testid={E2E_IDS.panel('notification')} className="flex min-h-0 flex-1 items-center justify-center bg-white text-sm text-gray-500">
        {t('NotificationPanel.loginRequired')}
      </div>
    );
  }

  return (
    <div data-testid={E2E_IDS.panel('notification')} className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="flex h-14 shrink-0 items-center justify-between">
          <h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">
            {t('NotificationPanel.title', { defaultValue: 'Notifications' })}
          </h1>
          <Button
            tone="ghost"
            size="sm"
            disabled={markingAllRead || unreadCount <= 0}
            onClick={() => {
              void markAllRead();
            }}
          >
            {markingAllRead
              ? t('NotificationPanel.markingAllRead', { defaultValue: 'Marking...' })
              : t('NotificationPanel.markAllRead', { defaultValue: 'Mark All Read' })}
          </Button>
        </div>

        <div className="flex items-center gap-2 pb-4">
        {FILTER_TABS.map((tab) => (
          <Button
            key={tab}
            onClick={() => setActiveFilter(tab)}
            tone={activeFilter === tab ? 'primary' : 'secondary'}
            size="sm"
          >
            {t(`NotificationPanel.filters.${tab}`, {
              defaultValue: tab,
            })}
          </Button>
        ))}
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1 bg-white"
        viewportClassName="bg-white"
        contentClassName="mx-auto max-w-4xl space-y-3 px-6 py-4"
      >
        {notificationsQuery.isPending && items.length === 0 ? (
          <Surface tone="card" elevation="base" className="rounded-2xl p-8 text-center text-sm text-gray-400">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-mint-200 border-t-mint-500" />
            {t('NotificationPanel.loading', { defaultValue: 'Loading notifications...' })}
          </Surface>
        ) : null}

        {notificationsQuery.isError && items.length === 0 ? (
          <Surface tone="card" elevation="base" className="rounded-2xl border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
            {t('NotificationPanel.loadError', { defaultValue: 'Failed to load notifications' })}
          </Surface>
        ) : null}

        {!notificationsQuery.isPending && !notificationsQuery.isError && filteredItems.length === 0 ? (
          <Surface tone="card" elevation="base" className="rounded-2xl p-8 text-center text-sm text-gray-400">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            {t('NotificationPanel.empty', { defaultValue: 'No notifications' })}
          </Surface>
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
            <Surface
              key={item.id}
              onClick={() => {
                if (!itemBusy) {
                  if (shouldOpenGiftInbox) {
                    navigateToGiftInbox(item.giftTransactionId);
                  }
                  void markOneRead(item.id);
                }
              }}
              tone="card"
              elevation="base"
              padding="none"
              interactive={!itemBusy}
              active={!item.isRead}
              className={`group relative cursor-pointer rounded-2xl p-4 ${itemBusy ? 'pointer-events-none' : ''}`}
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
                    {shouldOpenGiftInbox ? (
                      <span className="inline-flex items-center gap-1 rounded-xl border border-mint-200 bg-mint-50 px-3 py-1.5 text-[12px] font-medium text-mint-700 transition-colors group-hover:border-mint-300 group-hover:bg-mint-100">
                        {t('NotificationPanel.viewGift', { defaultValue: 'View Gift' })}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </Surface>
          );
        })}

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
