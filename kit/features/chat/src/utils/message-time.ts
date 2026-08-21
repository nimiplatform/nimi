/**
 * Format a chat message timestamp as a 24-hour HH:MM clock time.
 *
 * Shared by canonical and realm chat surfaces so message times render
 * identically regardless of locale `hour12` defaults.
 */
export function formatMessageTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
