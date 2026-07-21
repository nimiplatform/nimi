import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type CommerceGiftStatus,
} from '@nimiplatform/kit/features/commerce/headless';
import {
  GiftInboxDetail,
  GiftInboxList,
} from '@nimiplatform/kit/features/commerce/ui';
import { useRealmGiftInbox } from '@nimiplatform/kit/features/commerce/realm';
import { useAppStore } from '../../app-shell/providers/app-store';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { ScrollArea } from '@nimiplatform/kit/ui';
import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { invalidateNotificationQueries } from '../notification/notification-query.js';
import { useTranslation } from 'react-i18next';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { getDesktopRealmCommerceGiftService } from '../../infra/realm/realm-commerce-service';

function formatGiftDate(input: string | null | undefined, i18n: DesktopI18nResource): string {
  const value = String(input || '').trim();
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return i18n.formatDate(date, {
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
  const i18n = useDesktopI18nResource();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const authStatus = useAppStore((state) => state.auth.status);
  const currentUser = useAppStore((state) => state.auth.user);
  const navigateBack = useAppStore((state) => state.navigateBack);
  const selectedGiftTransactionId = useAppStore((state) => state.selectedGiftTransactionId);
  const setSelectedGiftTransactionId = useAppStore((state) => state.setSelectedGiftTransactionId);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);
  const giftService = useMemo(() => getDesktopRealmCommerceGiftService(), []);

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
    service: giftService,
    enabled: authStatus === 'authenticated',
    currentUserId,
    selectedGiftTransactionId,
    onActionSuccess: async (kind) => {
      await invalidateNotificationQueries(queryClient);
      setFeedback({
        kind: 'success',
        message: kind === 'accept'
          ? t('GiftInbox.acceptedSuccess', { defaultValue: 'Gift accepted and recorded.' })
          : t('GiftInbox.rejectedSuccess', { defaultValue: 'Gift rejected.' }),
      });
    },
    onError: (error, kind) => {
      if (kind === 'accept') {
        setFeedback({
          kind: 'error',
          message: toErrorMessage(error, t('GiftInbox.acceptError', { defaultValue: 'Failed to accept gift' })),
        });
      }
      if (kind === 'reject') {
        setFeedback({
          kind: 'error',
          message: toErrorMessage(error, t('GiftInbox.rejectError', { defaultValue: 'Failed to reject gift' })),
        });
      }
    },
  });

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
          {feedback ? (
            <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
          ) : null}
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
            onOpenWallet={() => undefined}
            walletActionVisible={false}
            renderPartyAvatar={(party) => (
              <EntityAvatar
                imageUrl={party?.avatarUrl || null}
                name={getUserDisplayName(party)}
                kind={party?.isSource ? 'source' : 'human'}
                sizeClassName="h-11 w-11"
                className={party?.isSource ? undefined : 'ring-2 ring-white'}
                textClassName="text-sm font-semibold"
              />
            )}
            formatDate={(value) => formatGiftDate(value, i18n)}
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
              defaultValue: 'Accepting records the gift transaction and updates the receiver benefit after Realm confirmation.',
            })}
            rejectReasonOptionalLabel={t('GiftInbox.rejectReasonOptional', { defaultValue: 'Reject reason (optional)' })}
            rejectReasonPlaceholder={t('GiftInbox.rejectReasonPlaceholder', {
              defaultValue: 'Tell the sender why you rejected this gift',
            })}
            acceptLabel={t('GiftInbox.accept', { defaultValue: 'Accept' })}
            acceptingLabel={t('GiftInbox.accepting', { defaultValue: 'Accepting...' })}
            rejectLabel={t('GiftInbox.reject', { defaultValue: 'Reject' })}
            rejectingLabel={t('GiftInbox.rejecting', { defaultValue: 'Rejecting...' })}
            withdrawTitle={t('GiftInbox.withdrawTitle', { defaultValue: 'Accepted gift recorded' })}
            withdrawDescription={t('GiftInbox.withdrawDescription', {
              defaultValue: 'Realm has confirmed this accepted gift. Wallet controls are hidden in this desktop build.',
            })}
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
        {feedback ? (
          <InlineFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />
        ) : null}
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
          formatDate={(value) => formatGiftDate(value, i18n)}
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
