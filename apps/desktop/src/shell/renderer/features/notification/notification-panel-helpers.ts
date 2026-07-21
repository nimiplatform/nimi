import { formatLocaleDate, formatRelativeLocaleTime } from '../../i18n';

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
