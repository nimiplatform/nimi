import { Button, StatusBadge, Surface, cn } from '@nimiplatform/nimi-kit/ui';
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
      <Surface tone="card" className={cn('rounded-[28px] p-8 text-center text-sm text-[var(--nimi-text-muted)]', className)}>
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_20%,transparent)] border-t-[var(--nimi-action-primary-bg)]" />
        {loadingLabel}
      </Surface>
    );
  }

  if (error) {
    return (
      <Surface
        tone="card"
        className={cn(
          'rounded-[28px] border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] p-8 text-center text-sm text-[var(--nimi-status-danger)]',
          className,
        )}
      >
        <p>{error}</p>
        {onRefresh ? (
          <Button tone="secondary" size="sm" onClick={onRefresh} className="mt-3 rounded-full">
            {refreshLabel}
          </Button>
        ) : null}
      </Surface>
    );
  }

  if (items.length === 0) {
    return (
      <Surface tone="card" className={cn('rounded-[28px] p-8 text-center text-sm text-[var(--nimi-text-muted)]', className)}>
        {emptyLabel}
      </Surface>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {items.map((item) => {
        const senderName = getSenderDisplayName(item);
        const giftStatus = item.status || 'PENDING';
        return (
          <Surface
            key={item.id}
            as="button"
            type="button"
            tone="card"
            padding="none"
            onClick={() => {
              onSelect(item.id);
            }}
            className="flex w-full items-start gap-4 rounded-[28px] p-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-3xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-3xl">
              {item.gift?.emoji || '🎁'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold text-[var(--nimi-text-primary)]">
                  {item.gift?.name || unknownGiftLabel}
                </p>
                <GiftStatusBadge status={giftStatus} label={getStatusLabel(giftStatus)} />
                <StatusBadge tone="warning">
                  {sparkAmountLabel(item.sparkCost)}
                </StatusBadge>
              </div>
              <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">{fromSenderLabel(senderName)}</p>
              {item.message ? (
                <p className="mt-2 line-clamp-2 text-sm text-[var(--nimi-text-secondary)]">{item.message}</p>
              ) : null}
            </div>
            <div className="shrink-0 text-xs text-[var(--nimi-text-muted)]">{formatDate(item.createdAt)}</div>
          </Surface>
        );
      })}
    </div>
  );
}
