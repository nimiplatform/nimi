import { formatLocaleDate, formatRelativeLocaleTime } from '@renderer/i18n';
import type { RealmModel } from '@nimiplatform/sdk/realm';

type UnreadNotificationCountDto = RealmModel<'UnreadNotificationCountDto'>;

export function parseUnreadCount(value: UnreadNotificationCountDto | null | undefined): number {
  const total = Number(value?.total);
  if (!Number.isFinite(total) || total < 0) {
    return 0;
  }
  return Math.floor(total);
}

export function formatNotificationTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return formatRelativeLocaleTime(date);
  }
  return formatLocaleDate(date, { month: 'short', day: 'numeric' });
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) {
      return message;
    }
  }
  return fallback;
}
