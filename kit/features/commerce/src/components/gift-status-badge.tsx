import { StatusBadge, type StatusTone } from '@nimiplatform/nimi-kit/ui';
import type { CommerceGiftStatus } from '../types.js';

function getStatusTone(status: CommerceGiftStatus): StatusTone {
  switch (status) {
    case 'ACCEPTED':
      return 'success';
    case 'REJECTED':
      return 'danger';
    case 'EXPIRED':
      return 'neutral';
    case 'REFUNDED':
      return 'warning';
    default:
      return 'info';
  }
}

export type GiftStatusBadgeProps = {
  status: CommerceGiftStatus;
  label: string;
  className?: string;
};

export function GiftStatusBadge({ status, label, className }: GiftStatusBadgeProps) {
  return (
    <StatusBadge tone={getStatusTone(status)} className={className}>
      {label}
    </StatusBadge>
  );
}
