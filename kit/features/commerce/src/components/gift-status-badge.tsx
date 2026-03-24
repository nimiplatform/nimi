import type { CommerceGiftStatus } from '../types.js';

function getStatusTone(status: CommerceGiftStatus): string {
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

export type GiftStatusBadgeProps = {
  status: CommerceGiftStatus;
  label: string;
  className?: string;
};

export function GiftStatusBadge({ status, label, className }: GiftStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(status)} ${className || ''}`.trim()}
    >
      {label}
    </span>
  );
}
