const EPOCH_PLACEHOLDER_MS = 24 * 60 * 60 * 1000;

/**
 * Formats a Runtime/SDK observedAt timestamp as product-facing Chinese copy.
 * Raw ISO strings stay in data attributes; visible copy uses 今天/昨天/短日期.
 * Epoch placeholders (1970) mean the upstream projection never observed a real
 * time, so they render as 尚未观测 instead of a misleading date.
 */
export function formatZhiyuObservedAtLabel(
  value: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) {
    return '尚未观测';
  }
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time) || time < EPOCH_PLACEHOLDER_MS) {
    return '尚未观测';
  }
  const timeLabel = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  const dayStart = (input: Date) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const diffDays = Math.round((dayStart(now) - dayStart(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) {
    return `今天 ${timeLabel}`;
  }
  if (diffDays === 1) {
    return `昨天 ${timeLabel}`;
  }
  const dateLabel = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(date);
  return `${dateLabel} ${timeLabel}`;
}
