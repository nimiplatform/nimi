import { useMemo, useState } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { formatLocaleDate } from '@renderer/i18n';
import { invalidateNotificationQueries } from '@renderer/features/notification/notification-query.js';
import { persistStoredSettingsSelected } from '@renderer/features/settings/settings-storage';
import { useTranslation } from 'react-i18next';

type GiftTransactionRichDto = RealmModel<'GiftTransactionRichDto'>;
type ReceivedGiftsResponseDto = RealmModel<'ReceivedGiftsResponseDto'>;

type GiftStatusView = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'REFUNDED';
type GiftAction = 'accept' | 'reject' | null;

const giftInboxQueryKeys = {
  received: ['gift-inbox', 'received'] as const,
  detail: (giftTransactionId: string) => ['gift-inbox', 'detail', giftTransactionId] as const,
};

function formatGiftDate(input: string | null | undefined): string {
  const value = String(input || '').trim();
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return formatLocaleDate(date, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getUserDisplayName(user: { displayName?: string | null; handle?: string | null } | null | undefined): string {
  const displayName = String(user?.displayName || '').trim();
  if (displayName) {
    return displayName;
  }
  const handle = String(user?.handle || '').trim();
  if (handle) {
    return handle;
  }
  return 'Unknown';
}

function getStatusTone(status: GiftStatusView): string {
  switch (status) {
    case 'ACCEPTED':
      return 'bg-emerald-50 text-emerald-700';
    case 'REJECTED':
      return 'bg-rose-50 text-rose-700';
    case 'EXPIRED':
      return 'bg-gray-100 text-gray-500';
    case 'REFUNDED':
      return 'bg-amber-50 text-amber-700';
    default:
      return 'bg-blue-50 text-blue-700';
  }
}

function getStatusLabel(t: ReturnType<typeof useTranslation>['t'], status: GiftStatusView): string {
  switch (status) {
    case 'ACCEPTED':
      return t('GiftInbox.status.accepted', { defaultValue: 'Accepted' });
    case 'REJECTED':
      return t('GiftInbox.status.rejected', { defaultValue: 'Rejected' });
    case 'EXPIRED':
      return t('GiftInbox.status.expired', { defaultValue: 'Expired' });
    case 'REFUNDED':
      return t('GiftInbox.status.refunded', { defaultValue: 'Refunded' });
    default:
      return t('GiftInbox.status.pending', { defaultValue: 'Pending' });
  }
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

function GiftStatusBadge({
  status,
  t,
}: {
  status: GiftStatusView;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(status)}`}>
      {getStatusLabel(t, status)}
    </span>
  );
}

export function GiftInboxPanel() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const selectedGiftTransactionId = useAppStore((state) => state.selectedGiftTransactionId);
  const setSelectedGiftTransactionId = useAppStore((state) => state.setSelectedGiftTransactionId);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<GiftAction>(null);
  const [rejectReason, setRejectReason] = useState('');

  const currentUserId = String(currentUser?.id || '').trim();

  const receivedQuery = useQuery({
    queryKey: giftInboxQueryKeys.received,
    queryFn: async () => dataSync.loadReceivedGifts(50) as Promise<ReceivedGiftsResponseDto>,
    enabled: authStatus === 'authenticated',
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: selectedGiftTransactionId ? giftInboxQueryKeys.detail(selectedGiftTransactionId) : ['gift-inbox', 'detail', 'empty'],
    queryFn: async () => dataSync.loadGiftTransaction(selectedGiftTransactionId as string) as Promise<GiftTransactionRichDto>,
    enabled: authStatus === 'authenticated' && Boolean(selectedGiftTransactionId),
    staleTime: 15_000,
  });

  const giftItems = useMemo(
    () => (Array.isArray(receivedQuery.data?.items) ? receivedQuery.data.items : []),
    [receivedQuery.data],
  );
  const selectedGift = detailQuery.data || null;
  const selectedGiftStatus = (selectedGift?.status || 'PENDING') as GiftStatusView;
  const isReceiver = Boolean(selectedGift && currentUserId && selectedGift.receiverId === currentUserId);

  const refreshGiftInbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gift-inbox'] }),
      invalidateNotificationQueries(),
    ]);
  };

  const openWallet = () => {
    persistStoredSettingsSelected('wallet');
    setSelectedGiftTransactionId(null);
    setActiveTab('settings');
  };

  const handleAccept = async () => {
    if (!selectedGiftTransactionId || pendingAction) {
      return;
    }
    setPendingAction('accept');
    try {
      await dataSync.acceptGift(selectedGiftTransactionId);
      await refreshGiftInbox();
      setStatusBanner({
        kind: 'success',
        message: t('GiftInbox.acceptedSuccess', { defaultValue: 'Gift accepted and credited to your wallet.' }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('GiftInbox.acceptError', { defaultValue: 'Failed to accept gift' })),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async () => {
    if (!selectedGiftTransactionId || pendingAction) {
      return;
    }
    setPendingAction('reject');
    try {
      await dataSync.rejectGift(selectedGiftTransactionId, {
        reason: rejectReason.trim() || undefined,
      });
      setRejectReason('');
      await refreshGiftInbox();
      setStatusBanner({
        kind: 'success',
        message: t('GiftInbox.rejectedSuccess', { defaultValue: 'Gift rejected.' }),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: toErrorMessage(error, t('GiftInbox.rejectError', { defaultValue: 'Failed to reject gift' })),
      });
    } finally {
      setPendingAction(null);
    }
  };

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#F5F7FA] text-sm text-gray-500">
        {t('GiftInbox.loginRequired', { defaultValue: 'Please log in to view gifts' })}
      </div>
    );
  }

  if (selectedGiftTransactionId) {
    if (detailQuery.isPending) {
      return (
        <div className="flex min-h-0 flex-1 flex-col bg-[#F5F7FA]">
          <div className="flex h-16 shrink-0 items-center gap-3 bg-white px-6">
            <button
              type="button"
              onClick={navigateBack}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {t('Common.back', { defaultValue: 'Back' })}
            </button>
            <h1 className={APP_PAGE_TITLE_CLASS}>
              {t('GiftInbox.title', { defaultValue: 'Gifts' })}
            </h1>
          </div>
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {t('GiftInbox.loadingDetail', { defaultValue: 'Loading gift details...' })}
          </div>
        </div>
      );
    }

    if (detailQuery.isError || !selectedGift) {
      return (
        <div className="flex min-h-0 flex-1 flex-col bg-[#F5F7FA]">
          <div className="flex h-16 shrink-0 items-center gap-3 bg-white px-6">
            <button
              type="button"
              onClick={navigateBack}
              className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              {t('Common.back', { defaultValue: 'Back' })}
            </button>
            <h1 className={APP_PAGE_TITLE_CLASS}>
              {t('GiftInbox.title', { defaultValue: 'Gifts' })}
            </h1>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-red-600">
            <span>{t('GiftInbox.detailError', { defaultValue: 'Failed to load gift details' })}</span>
            <button
              type="button"
              onClick={() => {
                void detailQuery.refetch();
              }}
              className="rounded-xl bg-white px-4 py-2 font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              {t('NotificationPanel.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
        </div>
      );
    }

    const senderName = getUserDisplayName(selectedGift.sender);
    const receiverName = getUserDisplayName(selectedGift.receiver);

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-[#F5F7FA]">
        <div className="flex h-16 shrink-0 items-center gap-3 bg-white px-6">
          <button
            type="button"
            onClick={navigateBack}
            className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
          >
            {t('Common.back', { defaultValue: 'Back' })}
          </button>
          <div>
            <h1 className={APP_PAGE_TITLE_CLASS}>
              {t('GiftInbox.title', { defaultValue: 'Gifts' })}
            </h1>
            <p className="text-xs text-gray-400">
              {t('GiftInbox.detailSubtitle', { defaultValue: 'Transaction detail' })}
            </p>
          </div>
        </div>

        <ScrollShell className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-3xl space-y-4 px-6 py-5">
          <section className="rounded-[28px] bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 text-3xl">
                  {selectedGift.gift?.emoji || '🎁'}
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold text-gray-900">
                      {selectedGift.gift?.name || t('GiftInbox.unknownGift', { defaultValue: 'Gift' })}
                    </h2>
                    <GiftStatusBadge status={selectedGiftStatus} t={t} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
                    <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">
                      {t('GiftInbox.sparkAmount', {
                        amount: selectedGift.sparkCost,
                        defaultValue: '{{amount}} Spark',
                      })}
                    </span>
                    <span>
                      {t('GiftInbox.gemAmount', {
                        amount: selectedGift.gemToReceiver,
                        defaultValue: '{{amount}} Gem',
                      })}
                    </span>
                    <span>{formatGiftDate(selectedGift.createdAt)}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <div className="font-medium text-gray-900">
                  {t('GiftInbox.transactionLabel', { defaultValue: 'Transaction' })}
                </div>
                <div className="mt-1 break-all text-xs text-gray-500">{selectedGift.id}</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {t('GiftInbox.sender', { defaultValue: 'Sender' })}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <EntityAvatar
                    imageUrl={selectedGift.sender?.avatarUrl || null}
                    name={senderName}
                    kind={selectedGift.sender?.isAgent ? 'agent' : 'human'}
                    sizeClassName="h-11 w-11"
                    className={selectedGift.sender?.isAgent ? undefined : 'ring-2 ring-white'}
                    textClassName="text-sm font-semibold"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{senderName}</p>
                    <p className="truncate text-xs text-gray-500">{selectedGift.sender?.handle || ''}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {t('GiftInbox.receiver', { defaultValue: 'Receiver' })}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <EntityAvatar
                    imageUrl={selectedGift.receiver?.avatarUrl || null}
                    name={receiverName}
                    kind={selectedGift.receiver?.isAgent ? 'agent' : 'human'}
                    sizeClassName="h-11 w-11"
                    className={selectedGift.receiver?.isAgent ? undefined : 'ring-2 ring-white'}
                    textClassName="text-sm font-semibold"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{receiverName}</p>
                    <p className="truncate text-xs text-gray-500">{selectedGift.receiver?.handle || ''}</p>
                  </div>
                </div>
              </div>
            </div>

            {selectedGift.message ? (
              <div className="mt-5 rounded-2xl bg-mint-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-mint-700">
                  {t('GiftInbox.senderMessage', { defaultValue: 'Sender message' })}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-mint-950">{selectedGift.message}</p>
              </div>
            ) : null}

            {selectedGift.rejectReason ? (
              <div className="mt-4 rounded-2xl bg-rose-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-700">
                  {t('GiftInbox.rejectReason', { defaultValue: 'Reject reason' })}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-rose-950">{selectedGift.rejectReason}</p>
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 text-sm text-gray-600 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {t('GiftInbox.expiresAt', { defaultValue: 'Expires' })}
                </div>
                <div className="mt-2 font-medium text-gray-900">{formatGiftDate(selectedGift.expiresAt)}</div>
              </div>
              <div className="rounded-2xl border border-gray-100 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {t('GiftInbox.acceptedAt', { defaultValue: 'Accepted' })}
                </div>
                <div className="mt-2 font-medium text-gray-900">{formatGiftDate(selectedGift.acceptedAt || null)}</div>
              </div>
              <div className="rounded-2xl border border-gray-100 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">
                  {t('GiftInbox.rejectedAt', { defaultValue: 'Rejected' })}
                </div>
                <div className="mt-2 font-medium text-gray-900">{formatGiftDate(selectedGift.rejectedAt || null)}</div>
              </div>
            </div>

            {selectedGiftStatus === 'PENDING' && isReceiver ? (
              <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <div className="text-sm font-semibold text-gray-900">
                  {t('GiftInbox.pendingTitle', { defaultValue: 'Respond to this gift' })}
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {t('GiftInbox.pendingDescription', {
                    defaultValue: 'Accepting credits Gem to your internal wallet. Withdrawal stays in Wallet.',
                  })}
                </p>
                <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-400" htmlFor="gift-inbox-reject-reason">
                  {t('GiftInbox.rejectReasonOptional', { defaultValue: 'Reject reason (optional)' })}
                </label>
                <textarea
                  id="gift-inbox-reject-reason"
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={3}
                  maxLength={160}
                  placeholder={t('GiftInbox.rejectReasonPlaceholder', {
                    defaultValue: 'Tell the sender why you rejected this gift',
                  })}
                  className="mt-2 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none focus:border-mint-300 focus:ring-2 focus:ring-mint-100"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      void handleAccept();
                    }}
                    className="rounded-2xl bg-mint-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-mint-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingAction === 'accept'
                      ? t('GiftInbox.accepting', { defaultValue: 'Accepting...' })
                      : t('GiftInbox.accept', { defaultValue: 'Accept' })}
                  </button>
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => {
                      void handleReject();
                    }}
                    className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingAction === 'reject'
                      ? t('GiftInbox.rejecting', { defaultValue: 'Rejecting...' })
                      : t('GiftInbox.reject', { defaultValue: 'Reject' })}
                  </button>
                </div>
              </div>
            ) : null}

            {selectedGiftStatus === 'ACCEPTED' && isReceiver ? (
              <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                <div className="text-sm font-semibold text-emerald-900">
                  {t('GiftInbox.withdrawTitle', { defaultValue: 'Accepted gifts are now in your wallet' })}
                </div>
                <p className="mt-1 text-sm text-emerald-800">
                  {t('GiftInbox.withdrawDescription', {
                    defaultValue: 'Use Wallet to review your Gem balance and withdraw when eligible.',
                  })}
                </p>
                <button
                  type="button"
                  onClick={openWallet}
                  className="mt-4 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  {t('GiftInbox.openWallet', { defaultValue: 'Open Wallet' })}
                </button>
              </div>
            ) : null}

            {!isReceiver ? (
              <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
                {t('GiftInbox.senderReadonly', {
                  defaultValue: 'You are viewing this gift as the sender. Status changes happen on the receiver side.',
                })}
              </div>
            ) : null}
          </section>
        </ScrollShell>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F5F7FA]">
      <div className="flex h-16 shrink-0 items-center gap-3 bg-white px-6">
        <button
          type="button"
          onClick={navigateBack}
          className="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
        >
          {t('Common.back', { defaultValue: 'Back' })}
        </button>
        <div>
          <h1 className={APP_PAGE_TITLE_CLASS}>
            {t('GiftInbox.title', { defaultValue: 'Gifts' })}
          </h1>
          <p className="text-xs text-gray-400">
            {t('GiftInbox.listSubtitle', { defaultValue: 'Received gift history' })}
          </p>
        </div>
      </div>

      <ScrollShell className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-3xl space-y-3 px-6 py-5">
        {receivedQuery.isPending ? (
          <div className="rounded-[28px] bg-white p-8 text-center text-sm text-gray-400">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-mint-200 border-t-mint-500" />
            {t('GiftInbox.loadingList', { defaultValue: 'Loading received gifts...' })}
          </div>
        ) : null}

        {receivedQuery.isError ? (
          <div className="rounded-[28px] border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700">
            {t('GiftInbox.listError', { defaultValue: 'Failed to load received gifts' })}
          </div>
        ) : null}

        {!receivedQuery.isPending && !receivedQuery.isError && giftItems.length === 0 ? (
          <div className="rounded-[28px] bg-white p-8 text-center text-sm text-gray-400">
            {t('GiftInbox.empty', { defaultValue: 'No received gifts yet' })}
          </div>
        ) : null}

        {giftItems.map((item) => {
          const senderName = getUserDisplayName(item.sender);
          const giftStatus = (item.status || 'PENDING') as GiftStatusView;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSelectedGiftTransactionId(item.id);
              }}
              className="flex w-full items-start gap-4 rounded-[28px] bg-white p-5 text-left shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-amber-50 text-3xl">
                {item.gift?.emoji || '🎁'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-gray-900">
                    {item.gift?.name || t('GiftInbox.unknownGift', { defaultValue: 'Gift' })}
                  </p>
                  <GiftStatusBadge status={giftStatus} t={t} />
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    {t('GiftInbox.sparkAmount', {
                      amount: item.sparkCost,
                      defaultValue: '{{amount}} Spark',
                    })}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {t('GiftInbox.fromSender', {
                    name: senderName,
                    defaultValue: 'From {{name}}',
                  })}
                </p>
                {item.message ? (
                  <p className="mt-2 line-clamp-2 text-sm text-gray-600">{item.message}</p>
                ) : null}
              </div>
              <div className="shrink-0 text-xs text-gray-400">
                {formatGiftDate(item.createdAt)}
              </div>
            </button>
          );
        })}
      </ScrollShell>
    </div>
  );
}
