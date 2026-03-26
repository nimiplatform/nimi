import {
  type CommerceGiftStatus,
} from '@nimiplatform/nimi-kit/features/commerce/headless';
import {
  GiftInboxDetail,
  GiftInboxList,
} from '@nimiplatform/nimi-kit/features/commerce/ui';
import { useRealmGiftInbox } from '@nimiplatform/nimi-kit/features/commerce/realm';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { formatLocaleDate } from '@renderer/i18n';
import { invalidateNotificationQueries } from '@renderer/features/notification/notification-query.js';
import { persistStoredSettingsSelected } from '@renderer/features/settings/settings-storage';
import { useTranslation } from 'react-i18next';

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

function getStatusLabel(t: ReturnType<typeof useTranslation>['t'], status: CommerceGiftStatus): string {
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


export function GiftInboxPanel() {
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const selectedGiftTransactionId = useAppStore((state) => state.selectedGiftTransactionId);
  const setSelectedGiftTransactionId = useAppStore((state) => state.setSelectedGiftTransactionId);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const currentUserId = String(currentUser?.id || '').trim();
  const {
    items: giftItems,
    selectedGift,
    selectedGiftStatus,
    isReceiver,
    listLoading,
    detailLoading,
    listError,
    detailError,
    pendingAction,
    rejectReason,
    setRejectReason,
    refreshDetail,
    refreshList,
    handleAccept,
    handleReject,
  } = useRealmGiftInbox({
    enabled: authStatus === 'authenticated',
    currentUserId,
    selectedGiftTransactionId,
    onActionSuccess: async (kind) => {
      await invalidateNotificationQueries();
      setStatusBanner({
        kind: 'success',
        message: kind === 'accept'
          ? t('GiftInbox.acceptedSuccess', { defaultValue: 'Gift accepted and credited to your wallet.' })
          : t('GiftInbox.rejectedSuccess', { defaultValue: 'Gift rejected.' }),
      });
    },
    onError: (error, kind) => {
      if (kind === 'accept') {
        setStatusBanner({
          kind: 'error',
          message: toErrorMessage(error, t('GiftInbox.acceptError', { defaultValue: 'Failed to accept gift' })),
        });
      }
      if (kind === 'reject') {
        setStatusBanner({
          kind: 'error',
          message: toErrorMessage(error, t('GiftInbox.rejectError', { defaultValue: 'Failed to reject gift' })),
        });
      }
    },
  });

  const openWallet = () => {
    persistStoredSettingsSelected('wallet');
    setSelectedGiftTransactionId(null);
    setActiveTab('settings');
  };

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#F5F7FA] text-sm text-gray-500">
        {t('GiftInbox.loginRequired', { defaultValue: 'Please log in to view gifts' })}
      </div>
    );
  }

  if (selectedGiftTransactionId) {
    if (detailLoading) {
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
            <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>
              {t('GiftInbox.title', { defaultValue: 'Gifts' })}
            </h1>
          </div>
          <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
            {t('GiftInbox.loadingDetail', { defaultValue: 'Loading gift details...' })}
          </div>
        </div>
      );
    }

    if (detailError || !selectedGift) {
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
            <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>
              {t('GiftInbox.title', { defaultValue: 'Gifts' })}
            </h1>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-red-600">
            <span>{detailError || t('GiftInbox.detailError', { defaultValue: 'Failed to load gift details' })}</span>
            <button
              type="button"
              onClick={() => {
                void refreshDetail();
              }}
              className="rounded-xl bg-white px-4 py-2 font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              {t('NotificationPanel.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
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
            <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>
              {t('GiftInbox.title', { defaultValue: 'Gifts' })}
            </h1>
            <p className="text-xs text-gray-400">
              {t('GiftInbox.detailSubtitle', { defaultValue: 'Transaction detail' })}
            </p>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-3xl space-y-4 px-6 py-5">
          <GiftInboxDetail
            gift={selectedGift}
            status={selectedGiftStatus}
            isReceiver={isReceiver}
            rejectReason={rejectReason}
            pendingAction={pendingAction}
            onRejectReasonChange={setRejectReason}
            onAccept={() => {
              void handleAccept();
            }}
            onReject={() => {
              void handleReject();
            }}
            onOpenWallet={openWallet}
            renderPartyAvatar={(party) => (
              <EntityAvatar
                imageUrl={party?.avatarUrl || null}
                name={getUserDisplayName(party)}
                kind={party?.isAgent ? 'agent' : 'human'}
                sizeClassName="h-11 w-11"
                className={party?.isAgent ? undefined : 'ring-2 ring-white'}
                textClassName="text-sm font-semibold"
              />
            )}
            formatDate={formatGiftDate}
            getPartyDisplayName={getUserDisplayName}
            getStatusLabel={(status) => getStatusLabel(t, status)}
            sparkAmountLabel={(amount) => t('GiftInbox.sparkAmount', {
              amount,
              defaultValue: '{{amount}} Spark',
            })}
            gemAmountLabel={(amount) => t('GiftInbox.gemAmount', {
              amount,
              defaultValue: '{{amount}} Gem',
            })}
            unknownGiftLabel={t('GiftInbox.unknownGift', { defaultValue: 'Gift' })}
            transactionLabel={t('GiftInbox.transactionLabel', { defaultValue: 'Transaction' })}
            senderLabel={t('GiftInbox.sender', { defaultValue: 'Sender' })}
            receiverLabel={t('GiftInbox.receiver', { defaultValue: 'Receiver' })}
            senderMessageLabel={t('GiftInbox.senderMessage', { defaultValue: 'Sender message' })}
            rejectReasonLabel={t('GiftInbox.rejectReason', { defaultValue: 'Reject reason' })}
            expiresAtLabel={t('GiftInbox.expiresAt', { defaultValue: 'Expires' })}
            acceptedAtLabel={t('GiftInbox.acceptedAt', { defaultValue: 'Accepted' })}
            rejectedAtLabel={t('GiftInbox.rejectedAt', { defaultValue: 'Rejected' })}
            pendingTitle={t('GiftInbox.pendingTitle', { defaultValue: 'Respond to this gift' })}
            pendingDescription={t('GiftInbox.pendingDescription', {
              defaultValue: 'Accepting credits Gem to your internal wallet. Withdrawal stays in Wallet.',
            })}
            rejectReasonOptionalLabel={t('GiftInbox.rejectReasonOptional', { defaultValue: 'Reject reason (optional)' })}
            rejectReasonPlaceholder={t('GiftInbox.rejectReasonPlaceholder', {
              defaultValue: 'Tell the sender why you rejected this gift',
            })}
            acceptLabel={t('GiftInbox.accept', { defaultValue: 'Accept' })}
            acceptingLabel={t('GiftInbox.accepting', { defaultValue: 'Accepting...' })}
            rejectLabel={t('GiftInbox.reject', { defaultValue: 'Reject' })}
            rejectingLabel={t('GiftInbox.rejecting', { defaultValue: 'Rejecting...' })}
            withdrawTitle={t('GiftInbox.withdrawTitle', { defaultValue: 'Accepted gifts are now in your wallet' })}
            withdrawDescription={t('GiftInbox.withdrawDescription', {
              defaultValue: 'Use Wallet to review your Gem balance and withdraw when eligible.',
            })}
            openWalletLabel={t('GiftInbox.openWallet', { defaultValue: 'Open Wallet' })}
            senderReadonlyLabel={t('GiftInbox.senderReadonly', {
              defaultValue: 'You are viewing this gift as the sender. Status changes happen on the receiver side.',
            })}
          />
        </ScrollArea>
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
          <h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>
            {t('GiftInbox.title', { defaultValue: 'Gifts' })}
          </h1>
          <p className="text-xs text-gray-400">
            {t('GiftInbox.listSubtitle', { defaultValue: 'Received gift history' })}
          </p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1" contentClassName="mx-auto w-full max-w-3xl space-y-3 px-6 py-5">
        <GiftInboxList
          items={giftItems}
          loading={listLoading}
          error={listError}
          onRefresh={() => {
            void refreshList();
          }}
          onSelect={(giftTransactionId) => {
            setSelectedGiftTransactionId(giftTransactionId);
          }}
          formatDate={formatGiftDate}
          getSenderDisplayName={(item) => getUserDisplayName(item.sender)}
          getStatusLabel={(status) => getStatusLabel(t, status)}
          sparkAmountLabel={(amount) => t('GiftInbox.sparkAmount', {
            amount,
            defaultValue: '{{amount}} Spark',
          })}
          fromSenderLabel={(name) => t('GiftInbox.fromSender', {
            name,
            defaultValue: 'From {{name}}',
          })}
          unknownGiftLabel={t('GiftInbox.unknownGift', { defaultValue: 'Gift' })}
          loadingLabel={t('GiftInbox.loadingList', { defaultValue: 'Loading received gifts...' })}
          emptyLabel={t('GiftInbox.empty', { defaultValue: 'No received gifts yet' })}
          refreshLabel={t('NotificationPanel.refresh', { defaultValue: 'Refresh' })}
        />
      </ScrollArea>
    </div>
  );
}
