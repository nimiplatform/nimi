import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { persistStoredSettingsSelected } from '@renderer/features/settings/settings-storage';

export interface GiftMessagePayload {
  giftTransactionId: string;
  giftId: string;
  giftName: string;
  giftEmoji: string | null;
  sparkCost: string;
  gemToReceiver: string;
  senderMessage: string | null;
}

type GiftStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'REFUNDED';

interface GiftTransactionResult {
  id: string;
  status: GiftStatus;
  senderId: string;
  receiverId: string;
  [key: string]: unknown;
}

interface GiftMessageBubbleProps {
  payload: GiftMessagePayload;
  isMe: boolean;
  currentUserId: string;
}

export function GiftMessageBubble({ payload, isMe, currentUserId }: GiftMessageBubbleProps) {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<'accept' | 'reject' | null>(null);

  const txQuery = useQuery({
    queryKey: ['gift-transaction', payload.giftTransactionId],
    queryFn: async () => {
      const result = await dataSync.loadGiftTransaction(payload.giftTransactionId);
      return result as GiftTransactionResult;
    },
    staleTime: 30_000,
  });

  const tx = txQuery.data;
  const status: GiftStatus = (tx?.status as GiftStatus) ?? 'PENDING';
  const isReceiver = tx ? tx.receiverId === currentUserId : !isMe;
  const isPending = status === 'PENDING';

  const handleAccept = async () => {
    setActionLoading('accept');
    try {
      await dataSync.acceptGift(payload.giftTransactionId);
      await queryClient.invalidateQueries({ queryKey: ['gift-transaction', payload.giftTransactionId] });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : t('GiftBubble.acceptFailed', { defaultValue: 'Failed to accept gift' }),
      });
    } finally {
      setActionLoading(null);
    }
  };

  const openWallet = () => {
    persistStoredSettingsSelected('wallet');
    setActiveTab('settings');
  };

  const handleReject = async () => {
    setActionLoading('reject');
    try {
      await dataSync.rejectGift(payload.giftTransactionId, {});
      await queryClient.invalidateQueries({ queryKey: ['gift-transaction', payload.giftTransactionId] });
    } catch (error) {
      setStatusBanner({
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
    <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-medium text-green-700">
      {t('GiftBubble.accepted', '已接受')}
    </span>
  ) : status === 'REJECTED' ? (
    <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-medium text-red-600">
      {t('GiftBubble.rejected', '已拒绝')}
    </span>
  ) : status === 'EXPIRED' ? (
    <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-500">
      {t('GiftBubble.expired', '已过期')}
    </span>
  ) : null;

  return (
    <div className={`inline-flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm ${isMe ? 'items-end' : 'items-start'}`}>
      {/* Gift info */}
      <div className="flex items-center gap-2">
        {payload.giftEmoji ? (
          <span className="text-2xl leading-none">{payload.giftEmoji}</span>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-100 text-pink-500 text-sm">🎁</span>
        )}
        <div className="flex flex-col">
          <span className="text-[13px] font-semibold text-gray-900">{payload.giftName}</span>
          <span className="text-[11px] text-gray-500">{payload.sparkCost} Spark</span>
        </div>
      </div>

      {/* Sender message */}
      {payload.senderMessage ? (
        <p className="max-w-[200px] text-[12px] text-gray-600 italic">"{payload.senderMessage}"</p>
      ) : null}

      {/* Status / Actions */}
      {txQuery.isPending ? (
        <span className="h-4 w-16 animate-pulse rounded bg-gray-100" />
      ) : isPending && isReceiver ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={actionLoading !== null}
            onClick={handleAccept}
            className="rounded-full bg-[#0066CC] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50 hover:bg-[#0052A3] transition-colors"
          >
            {actionLoading === 'accept' ? '...' : t('GiftBubble.accept', '接受')}
          </button>
          <button
            type="button"
            disabled={actionLoading !== null}
            onClick={handleReject}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[12px] font-medium text-gray-600 disabled:opacity-50 hover:bg-gray-50 transition-colors"
          >
            {actionLoading === 'reject' ? '...' : t('GiftBubble.reject', '拒绝')}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {statusBadge}
          {status === 'ACCEPTED' && isReceiver ? (
            <button
              type="button"
              onClick={openWallet}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              {t('GiftBubble.openWallet', '前往钱包')}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
