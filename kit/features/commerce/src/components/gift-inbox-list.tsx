import { GiftStatusBadge } from './gift-status-badge.js';
import type { CommerceGiftStatus, CommerceGiftSummary } from '../types.js';

export type GiftInboxListProps = {
  items: readonly CommerceGiftSummary[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onSelect: (giftTransactionId: string) => void;
  formatDate: (value: string | null | undefined) => string;
  getSenderDisplayName: (item: CommerceGiftSummary) => string;
  getStatusLabel: (status: CommerceGiftStatus) => string;
  sparkAmountLabel: (amount: number) => string;
  fromSenderLabel: (name: string) => string;
  unknownGiftLabel?: string;
  loadingLabel?: string;
  emptyLabel?: string;
  refreshLabel?: string;
  className?: string;
};

export function GiftInboxList({
  items,
  loading = false,
  error,
  onRefresh,
  onSelect,
  formatDate,
  getSenderDisplayName,
  getStatusLabel,
  sparkAmountLabel,
  fromSenderLabel,
  unknownGiftLabel = 'Gift',
  loadingLabel = 'Loading received gifts...',
  emptyLabel = 'No received gifts yet',
  refreshLabel = 'Refresh',
  className,
}: GiftInboxListProps) {
  if (loading) {
    return (
      <div className={`rounded-[28px] bg-white p-8 text-center text-sm text-gray-400 ${className || ''}`.trim()}>
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-mint-200 border-t-mint-500" />
        {loadingLabel}
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-[28px] border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 ${className || ''}`.trim()}>
        <p>{error}</p>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-3 inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
          >
            {refreshLabel}
          </button>
        ) : null}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`rounded-[28px] bg-white p-8 text-center text-sm text-gray-400 ${className || ''}`.trim()}>
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className || ''}`.trim()}>
      {items.map((item) => {
        const senderName = getSenderDisplayName(item);
        const giftStatus = item.status || 'PENDING';
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onSelect(item.id);
            }}
            className="flex w-full items-start gap-4 rounded-[28px] bg-white p-5 text-left shadow-sm transition-transform hover:-translate-y-0.5"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-amber-50 text-3xl">
              {item.gift?.emoji || '🎁'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-gray-900">
                  {item.gift?.name || unknownGiftLabel}
                </p>
                <GiftStatusBadge status={giftStatus} label={getStatusLabel(giftStatus)} />
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  {sparkAmountLabel(item.sparkCost)}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-500">{fromSenderLabel(senderName)}</p>
              {item.message ? (
                <p className="mt-2 line-clamp-2 text-sm text-gray-600">{item.message}</p>
              ) : null}
            </div>
            <div className="shrink-0 text-xs text-gray-400">{formatDate(item.createdAt)}</div>
          </button>
        );
      })}
    </div>
  );
}
