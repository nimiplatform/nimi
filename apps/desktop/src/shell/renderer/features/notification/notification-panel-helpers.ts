import type { DesktopI18nResource } from '../../i18n/desktop-i18n.js';

export function formatNotificationTime(
  input: string,
  i18n: DesktopI18nResource,
): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  const diffMs = i18n.now() - date.getTime();
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return i18n.formatRelativeTime(date);
  }
  return i18n.formatDate(date, { month: 'short', day: 'numeric' });
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
