import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { dataSync } from '@runtime/data-sync';

export interface GiftMessagePayload {
  giftTransactionId: string;
  giftId: string;
  giftName: string;
  giftEmoji: string | null;
  sparkCost: string;
  gemToReceiver: string;
  senderMessage: string | null;
}

type GiftStatus = 'PENDING' | 'CLAIMED' | 'REJECTED' | 'EXPIRED';

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
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<'claim' | 'reject' | null>(null);

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

  const handleClaim = async () => {
    setActionLoading('claim');
    try {
      await dataSync.claimGift(payload.giftTransactionId);
      await queryClient.invalidateQueries({ queryKey: ['gift-transaction', payload.giftTransactionId] });
    } catch {
      // silently ignore
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    setActionLoading('reject');
    try {
      await dataSync.rejectGift(payload.giftTransactionId, {});
      await queryClient.invalidateQueries({ queryKey: ['gift-transaction', payload.giftTransactionId] });
    } catch {
      // silently ignore
    } finally {
      setActionLoading(null);
    }
  };

  const statusBadge = status === 'CLAIMED' ? (
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
            onClick={handleClaim}
            className="rounded-full bg-[#0066CC] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-50 hover:bg-[#0052A3] transition-colors"
          >
            {actionLoading === 'claim' ? '...' : t('GiftBubble.accept', '接受')}
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
      ) : statusBadge}
    </div>
  );
}
