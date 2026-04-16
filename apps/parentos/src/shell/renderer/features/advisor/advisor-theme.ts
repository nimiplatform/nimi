/** Advisor page design tokens — bridges ParentOS identity with desktop chat aesthetic. */

export const ADVISOR_SIDEBAR_BG =
  'bg-[linear-gradient(180deg,rgba(250,252,252,0.98),rgba(244,247,248,0.96))]';

export const ADVISOR_EMPTY_GRADIENT =
  'bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(239,247,247,0.88))]';

/** Format an ISO timestamp as Chinese relative time. */
export function formatRelativeTimeCn(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return dateStr.split('T')[0] ?? dateStr;
  }
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  if (diffHour < 24) return `${diffHour}小时前`;
  if (diffDay < 7) return `${diffDay}天前`;
  if (diffWeek < 5) return `${diffWeek}周前`;
  return `${diffMonth}个月前`;
}
