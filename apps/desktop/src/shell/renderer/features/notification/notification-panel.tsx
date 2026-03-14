import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { formatLocaleDate, formatRelativeLocaleTime, i18n } from '@renderer/i18n';
import { ReviewRating } from '@nimiplatform/sdk/realm';
import { queryClient } from '@renderer/infra/query-client/query-client';

const PAGE_SIZE = 20;

type NotificationType = 'all' | 'gift' | 'request' | 'mention' | 'like' | 'system';

type NotificationItemView = {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  isRead: boolean;
  actorId: string | null;
  actorName: string;
  actorHandle: string;
  actorAvatarUrl: string | null;
  actorIsAgent: boolean;
  giftTransactionId: string | null;
  giftStatus: string | null;
  reviewId: string | null;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toBooleanValue(value: unknown): boolean {
  return value === true;
}

function parseUnreadCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  const payload = toRecord(value);
  const candidates = [payload?.unreadCount, payload?.count, payload?.total];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return Math.max(0, Math.floor(candidate));
    }
    if (typeof candidate === 'string' && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.floor(parsed));
      }
    }
  }
  return 0;
}

function toNotificationItemView(raw: unknown): NotificationItemView | null {
  const payload = toRecord(raw);
  if (!payload) {
    return null;
  }
  const id = toStringValue(payload.id).trim();
  if (!id) {
    return null;
  }
  const actor = toRecord(payload.actor);
  const target = toRecord(payload.target);
  const data = toRecord(payload.data);
  const actorName = toStringValue(actor?.displayName).trim();
  const actorHandle = toStringValue(actor?.handle).trim();
  const rawActorAvatarUrl = toStringValue(actor?.avatarUrl).trim();
  const targetGiftTransactionId = toStringValue(target?.interactionId).trim();
  const dataGiftTransactionId = toStringValue(data?.giftTransactionId).trim();
  return {
    id,
    type: toStringValue(payload.type, 'unknown'),
    title: toStringValue(payload.title, i18n.t('NotificationPanel.title', { defaultValue: 'Notification' })),
    body: toStringValue(payload.body),
    createdAt: toStringValue(payload.createdAt),
    isRead: toBooleanValue(payload.isRead),
    actorId: toStringValue(actor?.id).trim() || null,
    actorName: actorName || actorHandle || i18n.t('Common.unknown', { defaultValue: 'Unknown' }),
    actorHandle,
    actorAvatarUrl: rawActorAvatarUrl || null,
    actorIsAgent: toBooleanValue(actor?.isAgent),
    giftTransactionId: targetGiftTransactionId || dataGiftTransactionId || null,
    giftStatus: toStringValue(data?.status).trim() || null,
    reviewId: toStringValue(data?.reviewId).trim() || null,
  };
}

function parseNotificationList(value: unknown): {
  items: NotificationItemView[];
  nextCursor: string | null;
  hasNext: boolean;
} {
  const payload = toRecord(value);
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = rawItems
    .map((raw) => toNotificationItemView(raw))
    .filter((item): item is NotificationItemView => item !== null);
  const page = toRecord(payload?.page);
  const nextCursor = toStringValue(page?.nextCursor).trim() || null;
  const hasNext = page?.hasNext === true;
  return { items, nextCursor, hasNext };
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

function getNotificationCategory(type: string): NotificationType {
  const normalized = type.toLowerCase();
  if (normalized.includes('gift')) return 'gift';
  if (normalized.includes('friend_request')) return 'request';
  if (normalized.includes('mention')) return 'mention';
  if (normalized.includes('like')) return 'like';
  if (normalized.includes('system')) return 'system';
  return 'system';
}

function isGiftReviewable(item: NotificationItemView): boolean {
  return (
    item.type === 'gift_status_updated' &&
    Boolean(item.giftTransactionId) &&
    (item.giftStatus === 'accepted' || item.giftStatus === 'rejected') &&
    !item.reviewId
  );
}

const FILTER_TABS: NotificationType[] = ['all', 'gift', 'request', 'mention', 'like', 'system'];

export function NotificationPanel() {
  const authStatus = useAppStore((state) => state.auth.status);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const { t } = useTranslation();
  const [items, setItems] = useState<NotificationItemView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotificationType>('all');
  const [rejectingItem, setRejectingItem] = useState<NotificationItemView | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingGift, setRejectingGift] = useState(false);

  const notificationsQuery = useQuery({
    queryKey: ['notification-page', authStatus],
    queryFn: async () => dataSync.loadNotifications({ limit: PAGE_SIZE }),
    enabled: authStatus === 'authenticated',
  });
  const unreadCountQuery = useQuery({
    queryKey: ['notification-unread-count', authStatus],
    queryFn: async () => dataSync.loadNotificationUnreadCount(),
    enabled: authStatus === 'authenticated',
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!notificationsQuery.data) {
      return;
    }
    const parsed = parseNotificationList(notificationsQuery.data);
    setItems(parsed.items);
    setNextCursor(parsed.nextCursor);
    setHasNext(parsed.hasNext);
  }, [notificationsQuery.data]);

  // Local unread count for optimistic updates
  const [, setLocalUnreadCount] = useState(0);
  
  const unreadCount = useMemo(() => {
    const serverCount = parseUnreadCount(unreadCountQuery.data);
    // Use local count if items have been modified, otherwise use server count
    const calculatedCount = items.filter((item) => !item.isRead).length;
    return calculatedCount > 0 ? calculatedCount : serverCount;
  }, [unreadCountQuery.data, items]);

  // Sync local count when items change
  useEffect(() => {
    setLocalUnreadCount(items.filter((item) => !item.isRead).length);
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeFilter === 'all') return items;
    return items.filter((item) => getNotificationCategory(item.type) === activeFilter);
  }, [items, activeFilter]);

  // Helper to update topbar unread count optimistically
  const updateTopbarUnreadCount = (newCount: number) => {
    queryClient.setQueryData(['topbar-notification-unread-count'], (old: unknown) => {
      if (old && typeof old === 'object') {
        return { ...old, unreadCount: newCount, count: newCount };
      }
      return { unreadCount: newCount, count: newCount };
    });
  };

  const markOneRead = async (id: string) => {
    const notificationId = String(id || '').trim();
    if (!notificationId) return;
    const target = items.find((item) => item.id === notificationId);
    if (target?.isRead) return;
    
    // Optimistic update: immediately mark as read locally
    setItems((previous) => previous.map((item) =>
      item.id === notificationId ? { ...item, isRead: true } : item
    ));
    setLocalUnreadCount((prev) => {
      const newCount = Math.max(0, prev - 1);
      updateTopbarUnreadCount(newCount);
      return newCount;
    });
    
    try {
      await dataSync.markNotificationRead(notificationId);
      // Silently refetch to sync with server
      void unreadCountQuery.refetch();
    } catch (error) {
      // Revert on error
      setItems((previous) => previous.map((item) =>
        item.id === notificationId ? { ...item, isRead: false } : item
      ));
      setLocalUnreadCount((prev) => {
        const newCount = prev + 1;
        updateTopbarUnreadCount(newCount);
        return newCount;
      });
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('NotificationPanel.markReadError'),
      });
    }
  };

  const markAllRead = async () => {
    // Optimistic update: immediately mark all as read
    const previousUnreadCount = items.filter((item) => !item.isRead).length;
    const previousItems = [...items];
    setItems((previous) => previous.map((item) => ({ ...item, isRead: true })));
    setLocalUnreadCount(0);
    updateTopbarUnreadCount(0);
    
    try {
      await dataSync.markNotificationsRead({ markAllBefore: new Date().toISOString() });
      void unreadCountQuery.refetch();
    } catch (error) {
      // Revert on error
      setItems(previousItems);
      setLocalUnreadCount(previousUnreadCount);
      updateTopbarUnreadCount(previousUnreadCount);
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('NotificationPanel.markAllReadError'),
      });
    }
  };

  const reloadNotifications = async () => {
    await Promise.all([notificationsQuery.refetch(), unreadCountQuery.refetch()]);
  };

  const claimGift = async (item: NotificationItemView) => {
    if (!item.giftTransactionId) return;
    try {
      await dataSync.claimGift(item.giftTransactionId);
      await markOneRead(item.id);
      await reloadNotifications();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('NotificationPanel.claimError'),
      });
    }
  };

  const submitRejectGift = async () => {
    if (!rejectingItem?.giftTransactionId) return;
    setRejectingGift(true);
    try {
      await dataSync.rejectGift(rejectingItem.giftTransactionId, {
        reason: rejectReason.trim() || undefined,
      });
      await markOneRead(rejectingItem.id);
      await reloadNotifications();
      setRejectingItem(null);
      setRejectReason('');
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('NotificationPanel.rejectError'),
      });
    } finally {
      setRejectingGift(false);
    }
  };

  const createReview = async (item: NotificationItemView, rating: ReviewRating) => {
    if (!item.giftTransactionId) return;
    try {
      await dataSync.createGiftReview({ giftTransactionId: item.giftTransactionId, rating });
      await markOneRead(item.id);
      await reloadNotifications();
      setStatusBanner({ kind: 'success', message: t('NotificationPanel.reviewSubmitted') });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('NotificationPanel.reviewError'),
      });
    }
  };

  const loadMore = async () => {
    if (!hasNext || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await dataSync.loadNotifications({ limit: PAGE_SIZE, cursor: nextCursor });
      const parsed = parseNotificationList(result);
      setItems((previous) => {
        const byId = new Map<string, NotificationItemView>();
        for (const item of previous) byId.set(item.id, item);
        for (const item of parsed.items) byId.set(item.id, item);
        return Array.from(byId.values());
      });
      setNextCursor(parsed.nextCursor);
      setHasNext(parsed.hasNext);
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('NotificationPanel.loadMoreError'),
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const getActionButtons = (item: NotificationItemView, onClick: (e: React.MouseEvent) => void) => {
    const btnBase = "flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition-all";
    const btnPrimary = `${btnBase} bg-mint-500 text-white hover:bg-mint-600 shadow-sm hover:shadow-md`;
    const btnSecondary = `${btnBase} bg-white text-gray-600 border border-gray-200 hover:bg-gray-50`;

    if (item.type === 'friend_request_received') {
      return (
        <>
          <button type="button" onClick={onClick} className={btnPrimary}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            {t('Contacts.accept', { defaultValue: 'Accept' })}
          </button>
          <button type="button" onClick={onClick} className={btnSecondary}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            {t('Contacts.reject', { defaultValue: 'Reject' })}
          </button>
        </>
      );
    }
    if (item.type === 'gift_received' && item.giftTransactionId) {
      return (
        <>
          <button type="button" onClick={onClick} className={btnPrimary}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" /><line x1="12" y1="2" x2="12" y2="15" /><polyline points="8 11 12 15 16 11" /></svg>
            {t('NotificationPanel.claim', { defaultValue: 'Claim' })}
          </button>
          <button type="button" onClick={onClick} className={btnSecondary}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            {t('NotificationPanel.reject', { defaultValue: 'Reject' })}
          </button>
        </>
      );
    }
    if (isGiftReviewable(item)) {
      return (
        <>
          <button type="button" onClick={onClick} className={btnPrimary}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            {t('NotificationPanel.reviewPositive', { defaultValue: 'Review+' })}
          </button>
          <button type="button" onClick={onClick} className={btnSecondary}>
            {t('NotificationPanel.reviewNegative', { defaultValue: 'Review-' })}
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
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center justify-between bg-white px-6">
        <h1 className={`${APP_PAGE_TITLE_CLASS} flex items-center gap-2`}>
          Notifications
          {unreadCount > 0 ? (
            <span className="rounded-full bg-mint-500 px-2 py-0.5 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          ) : null}
        </h1>
        <button
          type="button"
          onClick={() => { void markAllRead(); }}
          className="text-sm font-medium text-mint-600 hover:text-mint-700 transition-colors"
        >
          {t('NotificationPanel.markAllRead', { defaultValue: 'Mark All Read' })}
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 bg-white px-6 py-3">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveFilter(tab)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
              activeFilter === tab
                ? 'bg-mint-500 text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
            }`}
          >
            {t(`NotificationPanel.filters.${tab}`, {
              defaultValue: tab,
            })}
          </button>
        ))}
      </div>

      {/* Notification List */}
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

          {!notificationsQuery.isPending && filteredItems.length === 0 ? (
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

          {filteredItems.map((item) => (
            <div
              key={item.id}
              onClick={() => { void markOneRead(item.id); }}
              className={`group relative rounded-2xl p-4 transition-all duration-200 cursor-pointer ${
                item.isRead
                  ? 'bg-white'
                  : 'bg-mint-50/60'
              }`}
            >
              {/* Unread Indicator Dot */}
              {!item.isRead && (
                <div className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-mint-500 shadow-sm" />
              )}

              {/* Main Content Row */}
              <div className="flex gap-4">
                {/* Avatar */}
                <div className="relative shrink-0">
                  <EntityAvatar
                    imageUrl={item.actorAvatarUrl}
                    name={item.actorName}
                    kind={item.actorIsAgent ? 'agent' : 'human'}
                    sizeClassName="h-12 w-12"
                    className={item.actorIsAgent ? undefined : 'ring-2 ring-gray-100'}
                    fallbackClassName={item.actorIsAgent ? undefined : (item.isRead ? 'bg-gray-100 text-gray-500 ring-2 ring-gray-100' : 'bg-mint-100 text-mint-700 ring-2 ring-gray-100')}
                    textClassName="text-sm font-semibold"
                  />
                  {/* Status Badge */}
                  {item.type === 'gift_received' && (
                    <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-mint-500 text-white">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M20 12v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" />
                        <line x1="12" y1="2" x2="12" y2="15" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1 pr-6">
                  {/* Title Line */}
                  <p className="text-sm text-gray-800">
                    <span className="font-bold">{item.actorName}</span>
                    {' '}
                    <span className="text-gray-600">{item.title.replace(item.actorName, '').trim()}</span>
                    {' '}
                    <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                      {item.type === 'friend_request_received'
                        ? t('NotificationPanel.typeNotifications.friendRequestReceived', { defaultValue: 'Friend Request' })
                        : item.type === 'gift_received'
                          ? t('NotificationPanel.filters.gift', { defaultValue: 'Gifts' })
                          : t(`NotificationPanel.filters.${getNotificationCategory(item.type)}`, {
                            defaultValue: getNotificationCategory(item.type),
                          })}
                    </span>
                  </p>

                  {/* Time */}
                  <p className="mt-0.5 text-xs text-gray-400">{formatNotificationTime(item.createdAt)}</p>

                  {/* Quote Bubble */}
                  {item.body && (
                    <div className="mt-2 inline-block max-w-full rounded-xl rounded-tl-sm bg-gray-100 px-3 py-2">
                      <p className="text-sm text-gray-600 line-clamp-2">"{item.body}"</p>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="mt-3 flex items-center gap-2">
                    {getActionButtons(item, (e) => {
                      e.stopPropagation();
                      if (item.type === 'friend_request_received') {
                        void markOneRead(item.id);
                      } else if (item.type === 'gift_received' && item.giftTransactionId) {
                        void claimGift(item);
                      } else if (isGiftReviewable(item)) {
                        void createReview(item, ReviewRating.POSITIVE);
                      } else {
                        void markOneRead(item.id);
                      }
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {hasNext ? (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => { void loadMore(); }}
                disabled={loadingMore}
                className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {loadingMore
                  ? t('NotificationPanel.loadingMore', { defaultValue: 'Loading...' })
                  : t('NotificationPanel.loadMore', { defaultValue: 'Load More' })}
              </button>
            </div>
          ) : null}
      </ScrollShell>

      {/* Reject Gift Modal */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-gray-900">{t('NotificationPanel.rejectGiftTitle')}</h2>
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
                onClick={() => { if (!rejectingGift) { setRejectingItem(null); setRejectReason(''); }}}
                disabled={rejectingGift}
                className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {t('Common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={() => { void submitRejectGift(); }}
                disabled={rejectingGift}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 transition-colors shadow-sm"
              >
                {rejectingGift
                  ? t('NotificationPanel.rejecting', { defaultValue: 'Rejecting...' })
                  : t('NotificationPanel.confirmReject', { defaultValue: 'Confirm Reject' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
