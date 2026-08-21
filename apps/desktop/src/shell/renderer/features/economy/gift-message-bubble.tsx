import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommerceGiftTransaction } from '@nimiplatform/kit/features/commerce';
import {
  acceptRealmGift,
  createRealmCommerceGiftService,
  loadRealmGiftTransaction,
  rejectRealmGift,
} from '@nimiplatform/kit/features/commerce/realm';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast';

export interface GiftMessagePayload {
  giftTransactionId: string;
  giftId: string;
  giftName: string;
  giftEmoji: string | null;
  sparkCost: string;
  gemToReceiver: string;
  senderMessage: string | null;
}

interface GiftMessageBubbleProps {
  payload: GiftMessagePayload;
  isMe: boolean;
  currentUserId: string;
}

export function GiftMessageBubble({ payload, isMe, currentUserId }: GiftMessageBubbleProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const sdk = useDesktopRendererSdk();
  const giftService = useMemo(
    () => createRealmCommerceGiftService({ generated: sdk.realm().generated }),
    [sdk],
  );
  const [actionLoading, setActionLoading] = useState<'accept' | 'reject' | null>(null);
  const setFeedback = emitFeedbackToast;

  const txQuery = useQuery({
    queryKey: ['gift-transaction', payload.giftTransactionId],
    queryFn: async (): Promise<CommerceGiftTransaction> =>
      loadRealmGiftTransaction({
        service: giftService,
        giftTransactionId: payload.giftTransactionId,
      }),
    staleTime: 30_000,
  });

  const tx = txQuery.data;
  const hasRealmTransactionEvidence = Boolean(tx?.id);
  const status = hasRealmTransactionEvidence ? tx?.status ?? null : null;
  const isReceiver = Boolean(tx?.receiver?.id && tx.receiver.id === currentUserId);
  const isPending = status === 'PENDING';

  const handleAccept = async () => {
    setActionLoading('accept');
    try {
      await acceptRealmGift({
        service: giftService,
        giftTransactionId: payload.giftTransactionId,
      });
      await queryClient.invalidateQueries({ queryKey: ['gift-transaction', payload.giftTransactionId] });
      setFeedback({
        kind: 'success',
        message: t('GiftBubble.acceptedSuccess', { defaultValue: 'Gift accepted.' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : t('GiftBubble.acceptFailed', { defaultValue: 'Failed to accept gift' }),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    setActionLoading('reject');
    try {
      await rejectRealmGift({
        service: giftService,
        giftTransactionId: payload.giftTransactionId,
        input: {},
      });
      await queryClient.invalidateQueries({ queryKey: ['gift-transaction', payload.giftTransactionId] });
      setFeedback({
        kind: 'success',
        message: t('GiftBubble.rejectedSuccess', { defaultValue: 'Gift rejected.' }),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : t('GiftBubble.rejectFailed', { defaultValue: 'Failed to reject gift' }),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = status === 'ACCEPTED' ? (
    <span className="inline-block rounded-full bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,var(--nimi-surface-card))] px-2.5 py-0.5 text-[11px] font-medium text-[var(--nimi-status-success)]">
      {t('GiftBubble.accepted', { defaultValue: 'Accepted' })}
    </span>
  ) : status === 'REJECTED' ? (
    <span className="inline-block rounded-full bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,var(--nimi-surface-card))] px-2.5 py-0.5 text-[11px] font-medium text-[var(--nimi-status-danger)]">
      {t('GiftBubble.rejected', { defaultValue: 'Rejected' })}
    </span>
  ) : status === 'EXPIRED' ? (
    <span className="inline-block rounded-full bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,var(--nimi-surface-card))] px-2.5 py-0.5 text-[11px] font-medium text-[var(--nimi-text-muted)]">
      {t('GiftBubble.expired', { defaultValue: 'Expired' })}
    </span>
  ) : null;

  return (
    <div className={`inline-flex flex-col gap-2 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 shadow-sm ${isMe ? 'items-end' : 'items-start'}`}>
      {/* Gift info */}
      <div className="flex items-center gap-2">
        {payload.giftEmoji ? (
          <span className="text-2xl leading-none">{payload.giftEmoji}</span>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)] text-sm">🎁</span>
        )}
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{payload.giftName}</span>
          <span className="text-[11px] text-[var(--nimi-text-muted)]">{payload.sparkCost} Spark</span>
        </div>
      </div>

      {/* Sender message */}
      {payload.senderMessage ? (
        <p className="max-w-[200px] text-[12px] text-[var(--nimi-text-secondary)] italic">"{payload.senderMessage}"</p>
      ) : null}

      {/* Status / Actions */}
      {txQuery.isPending ? (
        <span className="h-4 w-16 animate-pulse rounded bg-[color-mix(in_srgb,var(--nimi-surface-active)_64%,transparent)]" />
      ) : txQuery.isError || !hasRealmTransactionEvidence ? (
        <InlineFeedback
          feedback={{
            kind: 'error',
            message: t('GiftBubble.realmEvidenceRequired', { defaultValue: 'Gift actions require Realm transaction evidence' }),
          }}
          onDismiss={() => undefined}
        />
      ) : isPending && isReceiver ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={actionLoading !== null}
            onClick={handleAccept}
            className="rounded-full bg-[var(--nimi-action-primary-bg)] px-3 py-1 text-[12px] font-medium text-[var(--nimi-action-primary-text)] disabled:opacity-50 hover:bg-[var(--nimi-action-primary-bg-hover)] transition-colors"
          >
            {actionLoading === 'accept' ? '...' : t('GiftBubble.accept', { defaultValue: 'Accept' })}
          </button>
          <button
            type="button"
            disabled={actionLoading !== null}
            onClick={handleReject}
            className="rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-1 text-[12px] font-medium text-[var(--nimi-text-secondary)] disabled:opacity-50 hover:bg-[var(--nimi-action-ghost-hover)] transition-colors"
          >
            {actionLoading === 'reject' ? '...' : t('GiftBubble.reject', { defaultValue: 'Reject' })}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {statusBadge}
        </div>
      )}
    </div>
  );
}
